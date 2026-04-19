/**
 * Storage-layer idempotency for Stripe webhook events.
 *
 * The pair of functions in this module is deliberately tiny:
 *
 *   - `recordStripeEvent(event)` — insert the event into
 *     `stripe_events`. Returns `'fresh'` on a successful insert,
 *     `'duplicate'` if the PK already exists, `'failed'` on any
 *     other DB error. The +server.ts handler routes:
 *         - `'duplicate'` → return 200 immediately, skip dispatch
 *         - `'fresh'`     → run dispatch, then `markProcessed`
 *         - `'failed'`    → return 500 (Stripe retries with backoff)
 *
 *   - `markStripeEventProcessed(eventId)` — set `processed_at = now()`.
 *     Failure here is non-fatal (we already did the side effect; the
 *     audit column is best-effort) but we log it loudly so a stuck
 *     `processed_at IS NULL` row in production can be traced.
 *
 * Why a separate module instead of inline in +server.ts?
 *  - Testable. The +server.ts test would otherwise need a real
 *    Supabase, or a fragile mock of the SDK chain. Here we mock one
 *    function.
 *  - Symmetric with `dispatchStripeEvent` — HTTP layer in +server.ts,
 *    routing logic in `stripe-events.ts`, persistence here.
 */
import type Stripe from 'stripe';
import type { Json } from '$lib/database.types';
import { withAdmin } from '$lib/server/supabase-admin';
import { logger as rootLogger, type Logger } from '$lib/server/logger';

/**
 * Result of attempting to persist a webhook event.
 *
 *   - `fresh`            — first time we've seen this event-id; the
 *                          handler must dispatch.
 *   - `retry`            — we've seen this event-id before, but the
 *                          previous dispatch attempt did not reach
 *                          `markStripeEventProcessed` (DB row exists,
 *                          `processed_at IS NULL`). Treat as a retry
 *                          opportunity and dispatch again.
 *   - `already-processed`— event was fully processed in a prior
 *                          delivery. Skip dispatch, return 200.
 *   - `failed`           — the DB write itself failed. Caller should
 *                          return 5xx so Stripe retries.
 */
export type RecordResult = 'fresh' | 'retry' | 'already-processed' | 'failed';

/**
 * Insert (or recognize an existing) Stripe event row.
 *
 * We `upsert(... { ignoreDuplicates: true })` then SELECT to learn
 * whether the row we have was just created OR was already there from
 * a previous delivery. The PK collision is still atomic — Postgres
 * arbitrates between two concurrent inserts. The follow-up SELECT is
 * a separate round-trip, but for webhook traffic (single-digit per
 * second at the high end) the latency cost is negligible compared to
 * the correctness win: we never silently skip dispatch for an event
 * whose previous attempt failed mid-way.
 *
 * Postgres unique-violation code (`23505`) is treated as "duplicate"
 * for legacy clients that bypass the upsert path. The new path
 * shouldn't hit it.
 */
export async function recordStripeEvent(
	event: Stripe.Event,
	logger: Logger = rootLogger
): Promise<RecordResult> {
	try {
		const { data: inserted, error: insertError } = await withAdmin(
			'stripe-webhook.record',
			'system',
			async (admin) =>
				admin
					.from('stripe_events')
					.upsert(
						{
							id: event.id,
							type: event.type,
							payload: event as unknown as Json,
							livemode: event.livemode,
							api_version: event.api_version
						},
						{ onConflict: 'id', ignoreDuplicates: true }
					)
					.select('id')
		);

		if (insertError) {
			logger.error(
				{ pg_code: insertError.code, err: insertError.message },
				'recordStripeEvent failed'
			);
			return 'failed';
		}

		// `inserted` is non-empty iff the upsert actually wrote a new
		// row. An empty array means the conflict path fired and the
		// row was already present.
		if (inserted && inserted.length > 0) return 'fresh';

		// Existing row — check whether the previous delivery's
		// dispatch finished. Service-role bypasses RLS so this read
		// can't be blocked.
		const { data: existing, error: readError } = await withAdmin(
			'stripe-webhook.read',
			'system',
			async (admin) =>
				admin.from('stripe_events').select('processed_at').eq('id', event.id).maybeSingle()
		);

		if (readError) {
			logger.error(
				{ pg_code: readError.code, err: readError.message },
				'recordStripeEvent read-back failed'
			);
			return 'failed';
		}

		return existing?.processed_at ? 'already-processed' : 'retry';
	} catch (err) {
		logger.error(
			{ err: err instanceof Error ? err.message : String(err) },
			'recordStripeEvent threw'
		);
		return 'failed';
	}
}

/**
 * Stamp `processed_at = now()` on a previously-recorded event.
 *
 * Failures are logged but never thrown — the side effect already
 * happened, so refusing to ack the webhook would cause Stripe to
 * retry and (correctly) hit the duplicate path next time. Better:
 * log the audit-column miss and move on.
 */
export async function markStripeEventProcessed(
	eventId: string,
	logger: Logger = rootLogger
): Promise<void> {
	try {
		const { error } = await withAdmin('stripe-webhook.mark-processed', 'system', async (admin) =>
			admin
				.from('stripe_events')
				.update({ processed_at: new Date().toISOString() })
				.eq('id', eventId)
				.is('processed_at', null)
		);
		if (error) {
			logger.warn({ pg_code: error.code, err: error.message }, 'markStripeEventProcessed failed');
		}
	} catch (err) {
		logger.warn(
			{ err: err instanceof Error ? err.message : String(err) },
			'markStripeEventProcessed threw'
		);
	}
}
