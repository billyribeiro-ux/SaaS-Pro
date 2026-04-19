/**
 * Webhook replay (Module 10.4).
 *
 * Re-runs `dispatchStripeEvent` against a previously-stored event
 * row in `stripe_events`. The intended use case is *recovery*, not
 * re-delivery: Stripe is the source of truth for "what happened",
 * and our replay only re-applies the side effects we missed.
 *
 * The shape of the operation:
 *
 *   1. Read the row from `stripe_events` by id (service-role,
 *      bypasses RLS — webhook events are never user-owned).
 *   2. Cast the stored JSON payload back to `Stripe.Event`. The
 *      payload was inserted from a *verified* webhook, so we trust
 *      its shape; the cast is a runtime no-op.
 *   3. If the row already has `processed_at`, skip (idempotency).
 *   4. Run `dispatchStripeEvent`. Throws on handler failure → we
 *      DON'T mark processed, the row stays stuck for the next
 *      operator attempt.
 *   5. On success, stamp `processed_at = now()`. The same write
 *      `markStripeEventProcessed` does after a fresh delivery.
 *
 * The `dryRun` switch lets the operator preview what *would* be
 * replayed without touching anything — useful when a Postgres
 * backup is being copied and you want to check the stuck list
 * before deciding whether to fire.
 *
 * Result shape is structured (`replayed | already-processed |
 * not-found | failed`) so the JSON endpoint and the form-action
 * page can both consume the same call.
 */
import type Stripe from 'stripe';
import { withAdmin } from '$lib/server/supabase-admin';
import { logger as rootLogger, type Logger } from '$lib/server/logger';
import { dispatchStripeEvent } from '$lib/server/stripe-events';
import { markStripeEventProcessed } from '$lib/server/stripe-events-store';

/** A bound on batch replay so an `{}`-bodied request can't sweep the world. */
export const MAX_BATCH_REPLAY = 25;

export type ReplayOutcome =
	| { eventId: string; status: 'replayed'; type: string }
	| { eventId: string; status: 'already-processed'; type: string }
	| { eventId: string; status: 'not-found' }
	| { eventId: string; status: 'failed'; type?: string; error: string }
	| { eventId: string; status: 'dry-run'; type: string };

export interface BatchReplayInput {
	/**
	 * Replay only events older than this. Default: 0 (everything
	 * stuck). Useful to pin replays to "the backlog as of when the
	 * outage ended" without racing in-flight events.
	 */
	olderThanMs?: number;
	/** Hard cap on the number of events to touch. Defaults to `MAX_BATCH_REPLAY`. */
	limit?: number;
	/** Preview-only — no dispatch, no `markProcessed`. */
	dryRun?: boolean;
}

export interface BatchReplayResult {
	requested: number;
	outcomes: ReplayOutcome[];
}

/**
 * Re-dispatch a single event. The pure unit of replay.
 */
export async function replayStripeEvent(
	eventId: string,
	logger: Logger = rootLogger,
	options: { dryRun?: boolean } = {}
): Promise<ReplayOutcome> {
	const log = logger.child({ replay_event_id: eventId, dry_run: options.dryRun ?? false });

	const { data, error } = await withAdmin('webhook-replay.read', 'system', async (admin) =>
		admin
			.from('stripe_events')
			.select('id, type, payload, processed_at')
			.eq('id', eventId)
			.maybeSingle()
	);

	if (error) {
		log.error({ pg_code: error.code, err: error.message }, 'webhook-replay: read failed');
		return { eventId, status: 'failed', error: error.message };
	}
	if (!data) {
		log.warn('webhook-replay: event not found');
		return { eventId, status: 'not-found' };
	}
	if (data.processed_at) {
		// Idempotent skip — exactly the contract the receiver
		// guarantees on a duplicate delivery.
		log.info({ event_type: data.type }, 'webhook-replay: already processed; skipping');
		return { eventId, status: 'already-processed', type: data.type };
	}
	if (options.dryRun) {
		log.info({ event_type: data.type }, 'webhook-replay: dry-run');
		return { eventId, status: 'dry-run', type: data.type };
	}

	// Stored payload is a verified Stripe.Event JSON snapshot. The
	// cast is the runtime no-op the dispatcher already accepts.
	const event = data.payload as unknown as Stripe.Event;

	try {
		const result = await dispatchStripeEvent(event);
		// `unhandled` is not a failure — the receiver returns 200
		// for events we don't care about. Replaying one of those
		// reaches the same conclusion.
		if (result.kind === 'unhandled') {
			await markStripeEventProcessed(eventId, log);
			log.info({ event_type: data.type }, 'webhook-replay: dispatched (unhandled type)');
			return { eventId, status: 'replayed', type: data.type };
		}
		await markStripeEventProcessed(eventId, log);
		log.info({ event_type: data.type }, 'webhook-replay: dispatched');
		return { eventId, status: 'replayed', type: data.type };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error({ event_type: data.type, err: message }, 'webhook-replay: dispatch threw');
		return { eventId, status: 'failed', type: data.type, error: message };
	}
}

/**
 * Replay every stuck event matching the filter, capped at
 * `MAX_BATCH_REPLAY`. Each event is replayed sequentially; webhook
 * dispatchers can have ordering side-effects (a subscription update
 * before its parent customer create would surface a foreign-key
 * mismatch) so we don't parallelise.
 */
export async function replayStuckEvents(
	input: BatchReplayInput = {},
	logger: Logger = rootLogger,
	now: number = Date.now()
): Promise<BatchReplayResult> {
	const olderThanMs = Math.max(0, Math.trunc(input.olderThanMs ?? 0));
	const limit = Math.max(
		1,
		Math.min(MAX_BATCH_REPLAY, Math.trunc(input.limit ?? MAX_BATCH_REPLAY))
	);
	const cutoffIso = new Date(now - olderThanMs).toISOString();

	const log = logger.child({
		replay_batch: true,
		older_than_ms: olderThanMs,
		limit,
		dry_run: input.dryRun ?? false
	});

	const { data, error } = await withAdmin('webhook-replay.list-stuck', 'system', async (admin) =>
		admin
			.from('stripe_events')
			.select('id')
			.is('processed_at', null)
			.lte('received_at', cutoffIso)
			.order('received_at', { ascending: true })
			.limit(limit)
	);
	if (error) {
		log.error(
			{ pg_code: error.code, err: error.message },
			'webhook-replay: stuck-events list failed'
		);
		return { requested: 0, outcomes: [] };
	}
	const ids = (data ?? []).map((row) => row.id);
	log.info({ matched: ids.length }, 'webhook-replay: batch starting');

	const outcomes: ReplayOutcome[] = [];
	for (const id of ids) {
		outcomes.push(await replayStripeEvent(id, log, { dryRun: input.dryRun }));
	}
	log.info(
		{
			matched: ids.length,
			replayed: outcomes.filter((o) => o.status === 'replayed').length,
			failed: outcomes.filter((o) => o.status === 'failed').length,
			already_processed: outcomes.filter((o) => o.status === 'already-processed').length
		},
		'webhook-replay: batch complete'
	);
	return { requested: ids.length, outcomes };
}
