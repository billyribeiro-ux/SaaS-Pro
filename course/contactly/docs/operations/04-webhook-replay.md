# Lesson 10.4 — Webhook replay tool

> **Module 10 — Webhooks resilience & operational hygiene**
> Previous: [03 — Webhook backlog health](./03-webhook-health.md)
> Next: [05 — Operational runbook](./05-runbook.md)

## Goal

A recovery primitive that re-runs the webhook dispatcher against a
previously-stored `stripe_events` row whose `processed_at` is still
`NULL`. Two surfaces, one service:

- **`POST /api/admin/webhooks/replay`** — JSON, machine-friendly.
  Accepts a single event id (`{ "eventId": "evt_..." }`) or a
  batch filter (`{ "olderThanMs": 600000, "limit": 10 }`), with an
  optional `"dryRun": true` to preview what _would_ fire.
- **Admin dashboard form actions** — per-row `Replay` button on the
  stuck-events table at `/admin/webhooks`, plus a "Replay all
  (≤ 25)" header button. Both use SvelteKit's progressive
  `enhance` so the UX stays no-JS-friendly while the JS path
  shows a per-button "Replaying…" spinner.

The intended use case is **recovery, not re-delivery**: Stripe is
the source of truth for what happened; replay only re-applies the
side effects we missed.

## Module map

| File                                                             | Layer               | Role                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/billing/webhook-replay.ts` _(new)_               | Service             | `replayStripeEvent(eventId, log, { dryRun })`, `replayStuckEvents({ olderThanMs, limit, dryRun }, log)`, `MAX_BATCH_REPLAY = 25`. Wraps `dispatchStripeEvent` + `markStripeEventProcessed`. |
| `src/lib/server/billing/webhook-replay.test.ts` _(new)_          | Tests               | 8 cases: fresh dispatch + mark, idempotent skip, not-found, dispatch throw, read error, dryRun, "unhandled" type as success, batch cap + listing-failure.                                   |
| `src/lib/server/billing/webhook-health.ts` _(extended)_          | Service             | New `stuckEvents: StuckEvent[]` field on the snapshot (capped at `MAX_STUCK_EVENTS = 50`) so the dashboard can render a per-row replay button without a second roundtrip.                   |
| `src/routes/api/admin/webhooks/replay/+server.ts` _(new)_        | HTTP                | `POST` body parser → calls `replayStripeEvent` or `replayStuckEvents`. Validates `eventId` shape (`/^evt_[A-Za-z0-9_]+$/`). Returns mixed-outcome batch as 200, never 5xx.                  |
| `src/routes/(admin)/admin/webhooks/+page.server.ts` _(extended)_ | Page load + actions | Adds `actions.replay` (single) and `actions.replayBatch` (batch) for the form-driven path; both share the same service layer.                                                               |
| `src/routes/(admin)/admin/webhooks/+page.svelte` _(extended)_    | Page UI             | Stuck-events table with per-row Replay buttons + a header batch button, both `use:enhance`'d so progressive enhancement stays intact.                                                       |

## Why a separate module instead of "just re-call the dispatcher"

The dispatcher (`dispatchStripeEvent`) is the routing brain;
plugging it directly into a route handler would mean every replay
call has to:

1. Read the row from `stripe_events`.
2. Cast the JSON payload to `Stripe.Event`.
3. Decide what "already processed" should mean.
4. Stamp `processed_at` on success.

Doing that inline in two places (the JSON endpoint + the form
action) is exactly the duplicated-side-effect surface that produces
"the API behaves differently from the UI" bugs in code review. The
service layer collapses them into one function with a structured
result so the HTTP and form layers only differ in serialisation.

## The result shape

```ts
type ReplayOutcome =
	| { eventId: string; status: 'replayed'; type: string }
	| { eventId: string; status: 'already-processed'; type: string }
	| { eventId: string; status: 'not-found' }
	| { eventId: string; status: 'failed'; type?: string; error: string }
	| { eventId: string; status: 'dry-run'; type: string };
```

Five terminal states, all on the same discriminated union. The
dashboard renders each with a different colored pill; the JSON
endpoint returns the same shape; the operator-runbook (Lesson
10.5) reads them.

`'already-processed'` is the **idempotency contract**: the same
guarantee the receiver gives Stripe on a duplicate delivery. A
human operator clicking Replay twice in a row sees the second
click resolve to `already-processed` rather than re-running side
effects.

`'unhandled'` is folded into `'replayed'` (with a "dispatched
(unhandled type)" log line). This handles the edge case of an
event row stored historically with a type we no longer subscribe
to — the receiver returns 200 for those today, so replay matches.

## Why batch replay is sequential

`for (const id of ids) { await replayStripeEvent(...) }` — not
`Promise.all`. Webhook dispatchers can have ordering
side-effects. The classic trip-wire:
`customer.subscription.updated` arrives before its parent
`customer.created` (because the receiver crashed on the
`customer.created` row). Replaying both in parallel reproduces the
foreign-key mismatch that put us here in the first place.
Replaying them in `received_at` order gives the dispatcher a
chance to repair the chain.

## Caps + safety belts

- `MAX_BATCH_REPLAY = 25`. An `{}`-bodied request can't sweep the
  world; if the operator wants more, they paginate via
  `olderThanMs`.
- `MAX_STUCK_EVENTS = 50` on the snapshot. The dashboard never
  shows more than 50 rows at once; for "thousands stuck" the
  workflow is to call the JSON endpoint with a script.
- The form action validates `eventId` shape before touching the
  service (the endpoint does the same check). Rejection is a
  `fail(400)` with a stable error key the page renders into the
  result footer.

## Authentication

`requireAdminOrToken` from Lesson 10.3 gates both surfaces. The
JSON endpoint accepts the bearer token (so monitoring / on-call
scripts can replay without a session); the page lives behind the
human-only `(admin)` layout guard.

## Tests

| Suite                    | Cases | Notes                                                                                                                          |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `webhook-replay.test.ts` | 8     | Fresh dispatch, idempotent skip, not-found, dispatch throw, read error, dryRun, unhandled-as-success, batch cap, listing fail. |

171/171 unit tests pass; build + lint + svelte-check clean.

## How to use it

### Single event from the dashboard

1. Visit `/admin/webhooks`.
2. Find the stuck event in the "Stuck events" table.
3. Click "Replay". The page reloads with the outcome pill at the
   bottom of the section.

### Single event via cURL (for the runbook)

```bash
curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
  -H "Authorization: Bearer ${OPS_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"eventId":"evt_1abc..."}' | jq
```

### Batch replay (everything in the current backlog)

From the dashboard: click "Replay all (≤ 25)" in the stuck-events
header.

From the CLI:

```bash
curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
  -H "Authorization: Bearer ${OPS_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"olderThanMs":600000,"limit":25}' | jq
```

### Preview-only (dry run)

Add `"dryRun": true` to either body. The service emits `"dry-run"`
outcomes for every matched event without dispatching or marking
processed — useful when the `stripe_events` payload looks
suspicious and you want to confirm what _would_ fire before
firing.

## Operational checklist

- [x] `pnpm run lint` / `pnpm run check` / `pnpm run test:unit` green.
- [x] `pnpm run build` green.
- [x] Unauthorised callers see 404 on the endpoint and the page.
- [x] `MAX_BATCH_REPLAY = 25` cap enforced; covered by the
      `seenLimits` assertion in the unit tests.
- [x] Idempotent-skip path: replaying an event with `processed_at`
      set returns `already-processed` without running dispatch
      (asserted).
- [x] dryRun never marks processed (asserted).
- [x] Dispatch failures land as `failed` with the exception
      message — `processed_at` stays NULL so the next operator
      attempt has something to work on (asserted).
