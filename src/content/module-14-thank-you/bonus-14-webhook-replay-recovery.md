---
title: 'Bonus: Webhook Replay & Recovery'
module: 14
lesson: 14
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-14-webhook-replay-recovery'
description: 'A recovery primitive that re-runs the dispatcher against stored stripe_events rows whose processed_at is NULL. Single or batch, dry-run preview, idempotent. Two surfaces — JSON endpoint for ops scripts and per-row admin form actions.'
duration: 25
preview: false
---

# Bonus: Webhook replay & recovery

Bonus 13 gave you the dashboard. You see 4 stuck events at 2 a.m. Now what?

The wrong answer is to manually run a SQL UPDATE on `stripe_events.processed_at`. That marks the row "done" without running the side effects (creating the subscription row, mirroring the invoice, updating entitlements). The state of your DB drifts further from Stripe's source of truth, and the user whose checkout was stuck is _still_ stuck.

The right answer is **replay** — re-run the dispatcher against the stored payload. This lesson builds the primitive: a service that loads `stripe_events` rows where `processed_at IS NULL`, re-dispatches them through the same handlers the receiver uses, and marks them processed on success. Two surfaces over the same service: a JSON endpoint for ops scripts and per-row form actions on the admin dashboard.

By the end of this lesson you will:

- Understand the difference between replay (re-apply local side effects) and re-delivery (Stripe sending the event again).
- Build `replayStripeEvent(eventId, log, { dryRun })` and `replayStuckEvents({ olderThanMs, limit, dryRun })`.
- Return a discriminated `ReplayOutcome` union with five terminal states (`replayed`, `already-processed`, `not-found`, `failed`, `dry-run`).
- Cap batch replay at `MAX_BATCH_REPLAY = 25` and replay sequentially in `received_at` order.
- Wire the same service into a `POST /api/admin/webhooks/replay` JSON endpoint and per-row form actions.
- Use SvelteKit's `use:enhance` so progressive enhancement stays intact.
- Test the idempotent-skip path so a double click never re-runs side effects.

## 1. Replay vs re-delivery

A vocabulary check before code:

- **Re-delivery** is asking _Stripe_ to send the event again. Stripe Dashboard → Developers → Webhooks → click an event → "Resend". This is the right tool when the row is _missing_ from `stripe_events` entirely (your endpoint was 503 and Stripe gave up after 3 days).
- **Replay** is asking _your server_ to re-run the dispatcher against the row already in `stripe_events`. The signature was already verified, the payload is canonical, only the side effects are missing. This is the common case — your receiver wrote the row but the handler crashed.

This lesson builds replay. Re-delivery you do in the Stripe dashboard.

## 2. The result shape

Five terminal states, one discriminated union:

```ts
export type ReplayOutcome =
	| { eventId: string; status: 'replayed'; type: string }
	| { eventId: string; status: 'already-processed'; type: string }
	| { eventId: string; status: 'not-found' }
	| { eventId: string; status: 'failed'; type?: string; error: string }
	| { eventId: string; status: 'dry-run'; type: string };
```

`'already-processed'` is the **idempotency contract**: the same guarantee the receiver gives Stripe on a duplicate delivery. A human operator clicking Replay twice in a row sees the second click resolve to `already-processed` rather than re-running side effects.

## 3. The service

`src/lib/server/billing/webhook-replay.ts`:

```ts
import type Stripe from 'stripe';
import type { Logger } from '$lib/server/logger';
import { withAdmin } from '$lib/server/supabase-admin';
import { dispatchStripeEvent } from './dispatch';
import { markStripeEventProcessed } from '$lib/server/stripe-events-store';

export const MAX_BATCH_REPLAY = 25;

export async function replayStripeEvent(
	eventId: string,
	log: Logger,
	opts: { dryRun?: boolean } = {}
): Promise<ReplayOutcome> {
	const sb = withAdmin();
	const { data: row, error: readErr } = await sb
		.from('stripe_events')
		.select('event_id, event_type, payload, processed_at')
		.eq('event_id', eventId)
		.maybeSingle();

	if (readErr) return { eventId, status: 'failed', error: readErr.message };
	if (!row) return { eventId, status: 'not-found' };
	if (row.processed_at) return { eventId, status: 'already-processed', type: row.event_type };

	if (opts.dryRun) return { eventId, status: 'dry-run', type: row.event_type };

	const replayLog = log.child({ event_id: eventId, event_type: row.event_type, replay: true });
	try {
		const event = row.payload as unknown as Stripe.Event;
		const result = await dispatchStripeEvent(event, replayLog);
		if (result === 'unhandled') {
			replayLog.info('replay dispatched (unhandled type)');
		}
		await markStripeEventProcessed({ id: eventId }, sb, replayLog);
		return { eventId, status: 'replayed', type: row.event_type };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		replayLog.error({ err: message }, 'replay dispatch failed');
		return { eventId, status: 'failed', type: row.event_type, error: message };
	}
}

export async function replayStuckEvents(
	opts: { olderThanMs?: number; limit?: number; dryRun?: boolean },
	log: Logger
): Promise<ReplayOutcome[]> {
	const limit = Math.min(Math.max(1, opts.limit ?? MAX_BATCH_REPLAY), MAX_BATCH_REPLAY);
	const olderThanMs = Math.max(0, opts.olderThanMs ?? 0);
	const cutoff = new Date(Date.now() - olderThanMs).toISOString();

	const sb = withAdmin();
	const { data: rows, error } = await sb
		.from('stripe_events')
		.select('event_id')
		.is('processed_at', null)
		.lte('received_at', cutoff)
		.order('received_at', { ascending: true })
		.limit(limit);

	if (error) {
		log.error({ err: error.message }, 'replay batch listing failed');
		throw new Error(`replay batch listing failed: ${error.message}`);
	}

	const outcomes: ReplayOutcome[] = [];
	for (const row of rows ?? []) {
		outcomes.push(await replayStripeEvent(row.event_id, log, { dryRun: opts.dryRun }));
	}
	return outcomes;
}
```

## 4. Why batch replay is sequential

`for (const id of ids) { await replayStripeEvent(...) }` — not `Promise.all`.

Webhook dispatchers can have ordering side effects. The classic trip-wire: `customer.subscription.updated` arrives before its parent `customer.created` (because the receiver crashed on the `customer.created` row). Replaying both in parallel reproduces the foreign-key mismatch that put us here in the first place. Replaying them in `received_at` order gives the dispatcher a chance to repair the chain.

## 5. Caps + safety belts

- `MAX_BATCH_REPLAY = 25`. An `{}`-bodied request can't sweep the world; if the operator wants more, they paginate via `olderThanMs`.
- `MAX_STUCK_EVENTS = 50` on the snapshot. The dashboard never shows more than 50 rows at once; for "thousands stuck" the workflow is a script against the JSON endpoint.
- Validate `eventId` shape (`/^evt_[A-Za-z0-9_]+$/`) before touching the service. Rejection is a `fail(400)` with a stable error key.

## 6. The JSON endpoint

`src/routes/api/admin/webhooks/replay/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdminOrToken } from '$lib/server/auth/admin';
import { replayStripeEvent, replayStuckEvents } from '$lib/server/billing/webhook-replay';

const SingleSchema = z.object({
	eventId: z.string().regex(/^evt_[A-Za-z0-9_]+$/),
	dryRun: z.boolean().optional()
});

const BatchSchema = z.object({
	olderThanMs: z.number().int().nonnegative().optional(),
	limit: z.number().int().positive().max(25).optional(),
	dryRun: z.boolean().optional()
});

export async function POST(event) {
	await requireAdminOrToken(event);
	const body = await event.request.json().catch(() => ({}));

	const single = SingleSchema.safeParse(body);
	if (single.success) {
		const outcome = await replayStripeEvent(single.data.eventId, event.locals.logger, {
			dryRun: single.data.dryRun
		});
		return json({ outcomes: [outcome] });
	}

	const batch = BatchSchema.safeParse(body);
	if (batch.success) {
		const outcomes = await replayStuckEvents(batch.data, event.locals.logger);
		return json({ outcomes });
	}

	return json({ error: 'Invalid body' }, { status: 400 });
}
```

The endpoint **never returns 5xx for mixed-outcome batches**. A batch where 23 succeed and 2 fail is still HTTP 200 — the failure is in the `outcomes` array. This is what makes the endpoint scriptable: a wrapper script can iterate `outcomes`, retry the `failed` ones with backoff, and report cleanly.

## 7. The form actions

In `/admin/webhooks/+page.server.ts`:

```ts
export const actions = {
	replay: async (event) => {
		await requireAdminOrToken(event);
		const data = await event.request.formData();
		const eventId = String(data.get('eventId') ?? '');
		if (!/^evt_[A-Za-z0-9_]+$/.test(eventId)) {
			return fail(400, { error: 'invalid_event_id' });
		}
		const outcome = await replayStripeEvent(eventId, event.locals.logger);
		return { outcomes: [outcome] };
	},
	replayBatch: async (event) => {
		await requireAdminOrToken(event);
		const outcomes = await replayStuckEvents(
			{ olderThanMs: 0, limit: MAX_BATCH_REPLAY },
			event.locals.logger
		);
		return { outcomes };
	}
};
```

In the page component:

```svelte
<form method="POST" action="?/replay" use:enhance>
	<input type="hidden" name="eventId" value={event.eventId} />
	<button type="submit" disabled={pending}>
		{pending ? 'Replaying…' : 'Replay'}
	</button>
</form>
```

`use:enhance` keeps the form working with JS disabled (full page reload on submit) and gives you a per-button "Replaying…" spinner when JS is enabled. Best of both worlds.

## 8. Tests

Eight cases cover the contract:

```ts
it('replays a fresh event and marks it processed', async () => {
	/* … */
});
it('skips an already-processed event without dispatching', async () => {
	/* … */
});
it('returns not-found for an unknown event id', async () => {
	/* … */
});
it('reports a dispatcher throw as failed without marking processed', async () => {
	/* … */
});
it('reports a read error as failed', async () => {
	/* … */
});
it('does not mark processed in dryRun mode', async () => {
	/* … */
});
it('treats unhandled types as success', async () => {
	/* … */
});
it('caps batch replay at MAX_BATCH_REPLAY', async () => {
	/* … */
});
```

## 9. The runbook

```bash
# Replay a single stuck event:
curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
  -H "Authorization: Bearer ${OPS_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"eventId":"evt_1abc..."}' | jq

# Dry-run preview before pulling the trigger:
curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
  -H "Authorization: Bearer ${OPS_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"eventId":"evt_1abc...","dryRun":true}' | jq

# Replay everything older than 10 minutes (capped at 25):
curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
  -H "Authorization: Bearer ${OPS_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"olderThanMs":600000,"limit":25}' | jq
```

## 10. Acceptance checklist

- [ ] `replayStripeEvent` returns one of `{replayed, already-processed, not-found, failed, dry-run}`.
- [ ] `replayStuckEvents` is sequential (no `Promise.all`) and ordered by `received_at`.
- [ ] `MAX_BATCH_REPLAY = 25` cap enforced server-side.
- [ ] `dryRun` never marks processed (asserted).
- [ ] Dispatch failures keep `processed_at = NULL` so the next operator attempt can retry.
- [ ] JSON endpoint validates `eventId` shape via Zod and returns 400 on malformed bodies.
- [ ] Form actions use `use:enhance` and degrade gracefully without JS.
- [ ] Mixed-outcome batches return HTTP 200 with per-event status.

## What's next

Bonus 15 turns the dashboard + replay tool into a written **runbook** — the document on-call engineers actually consult at 2 a.m. A health endpoint plus a replay button is the tooling; the runbook is the muscle memory.
