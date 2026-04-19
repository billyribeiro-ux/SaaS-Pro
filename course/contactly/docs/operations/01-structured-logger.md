# Lesson 10.1 — Structured logger foundation

> **Module 10 — Webhooks resilience & operational hygiene**
> Previous: [Module 9 — Checkout & billing portal](../billing/10-invoice-mirror-and-history.md)
> Next: 02 — Sentry server + client wiring (Lesson 10.2)

## Goal

Replace ad-hoc `console.*` with a structured, per-request logger
that:

- Writes **JSON to stdout in production** (so the Vercel runtime
  captures it and it ships verbatim to the log aggregator we
  eventually point at it — Datadog, Better Stack, etc.).
- Writes **single-line pretty output in development** (because
  reading raw JSON in a terminal is its own punishment).
- Stays **silent under `NODE_ENV=test`** so unit-test runs aren't
  drowned in production-shaped log lines.
- Carries **per-request context** (`req_id`, `route_id`,
  `user_id`, plus webhook context like `event_id` / `event_type`)
  on every line, automatically.
- **Redacts** secret-bearing fields (`Authorization`, `Cookie`,
  `Stripe-Signature`, `*.password`, `*.token`, the obvious env
  names) at the logger layer so a sloppy call site can't ship
  credentials to logs.

This lesson is the foundation for the rest of Module 10. Sentry
(10.2) will piggy-back on `req_id` for cross-system correlation; the
admin webhook surfaces (10.3 / 10.4) read structured fields off log
lines for triage.

## Module map

| File                                                         | Layer    | Role                                                                                                                                             |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/server/logger.ts` _(new)_                           | Service  | Thin pino wrapper: base bindings, dev/prod transports, redaction list, `requestLogger(event)` builder for per-request scope.                     |
| `src/lib/server/logger.test.ts` _(new)_                      | Tests    | Surface-shape contract + per-request bindings (`req_id`, `route_id`, header-fallback chain).                                                     |
| `src/app.d.ts` _(modified)_                                  | Types    | Adds `App.Locals.logger` so every server `load`, action, and `+server.ts` gets the per-request logger off `event.locals` with full autocomplete. |
| `src/hooks.server.ts` _(modified)_                           | Hook     | Wires `event.locals.logger = requestLogger(event)` before any other locals are populated.                                                        |
| `src/routes/api/webhooks/stripe/+server.ts` _(modified)_     | Endpoint | Migrated off `console.*`; binds `event_id` / `event_type` via `child()` on signature verification.                                               |
| `src/lib/server/stripe-events-store.ts` _(modified)_         | Service  | `recordStripeEvent` / `markStripeEventProcessed` now take an optional `Logger` so the per-request logger flows through the storage layer.        |
| `src/lib/server/stripe-events-store.test.ts` _(modified)_    | Tests    | Asserts on a fake-`Logger` test double (no `console` spying).                                                                                    |
| `src/routes/api/webhooks/stripe/server.test.ts` _(modified)_ | Tests    | Updated `callPost` stub to pass a silent `event.locals.logger`.                                                                                  |

## Why pino

ADR-004 fixes the choice; the rationale:

- **Lowest overhead Node logger**, by a wide margin, in any benchmark
  you trust. The webhook receiver runs on the hot path of every
  Stripe delivery; we don't want to pay 5–10× the per-call cost just
  to write a JSON line.
- **JSON-by-default.** Machine-parseable from minute one. The pretty
  dev transport (`pino-pretty`) is one config flag away.
- **Transport ecosystem.** Today: stdout. Tomorrow: Datadog, Better
  Stack, Logtail, Loki — all have a pino transport. The call sites
  don't change.
- **Child loggers** are zero-allocation context carriers. Bind
  `req_id` once, every subsequent `info()` inherits it.
- **Redaction is built in.** The `redact: { paths, censor }` option
  blacks out a deep set of paths cheaply; we use it as the last line
  of defense against accidental secret leaks.

## What `console.*` got wrong

Every site we replaced was variants of:

```ts
console.warn('[stripe-webhook] signature verification failed:', message);
```

The pain points:

1. **Format drift.** Some lines pass an object, some a string, some
   both. Nothing can grep across them reliably.
2. **No correlation.** Two concurrent webhook deliveries interleave
   with no `req_id`; debugging "why did this one fail" turns into
   archaeology.
3. **No level threshold.** `info` and `warn` look identical in
   `vercel logs`; the human has to grep prefixes.
4. **No redaction.** A future, sloppy `console.error('signed body:',
rawBody)` would happily ship the entire (signed) payload to logs.
   Pino's redact config fails closed.

The structured logger fixes all four in ~150 lines including the
redaction config.

## The wrapper

`src/lib/server/logger.ts` is intentionally tiny. The decisions it
locks in:

| Decision      | Choice                                                                   | Why                                                                                                            |
| ------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Default level | `info` in prod, `debug` in dev, `silent` in test (`LOG_LEVEL` overrides) | Test silence by default keeps unit-test output clean; ops can dial up verbosity without redeploy.              |
| Time format   | `pino.stdTimeFunctions.isoTime`                                          | ISO-8601 grep-friendly across timezones; epoch ms is faster but unreadable.                                    |
| Base bindings | `service: 'contactly', env: NODE_ENV`                                    | Multi-app log aggregator filtering ("show me only Contactly errors").                                          |
| Dev transport | `pino-pretty`, single line, ISO clock, hide noise (`pid,hostname,…`)     | Single-line output stays readable when interleaved with Vite/HMR output.                                       |
| Redact        | Auth headers + cookie + `*.password` / `*.token` / `*.api_key` family    | Failsafe for sloppy call sites; runs at ~no cost per log call.                                                 |
| Request id    | `x-request-id` → `x-vercel-id` → 96-bit random hex                       | Use the platform's id when present (Vercel sets `x-vercel-id`); synthesize otherwise so every line correlates. |

`requestLogger(event, bindings?)` builds a child logger from the
`RequestEvent`, stamping `req_id`, `route_id`, and (if the platform
supplied one) `vercel_id`. Caller bindings merge on top so e.g. the
auth hook can later add `user_id` once it knows who's calling.

## Per-request wiring

`src/hooks.server.ts` runs first on every request and assigns the
logger to `event.locals.logger`:

```ts
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.logger = requestLogger(event);
	// ...rest of the hook (Supabase client, safeGetSession, …)
};
```

`App.Locals` is updated in `src/app.d.ts` so every consumer gets full
type autocomplete:

```ts
interface Locals {
  supabase: SupabaseClient<Database>;
  safeGetSession: () => Promise<…>;
  logger: Logger; // Module 10.1
}
```

That's it for the framework integration. The rest of the migration
is per-call-site.

## Migrating the webhook receiver

Before:

```ts
console.warn('[stripe-webhook] signature verification failed:', message);
```

After:

```ts
const log = locals.logger; // req_id + route_id already bound
log.warn({ err: message }, 'webhook signature verification failed');
```

Once the event is verified, we re-bind for the rest of the path:

```ts
const eventLog = log.child({ event_id: event.id, event_type: event.type });
```

Every line below — the dispatch result, the `markProcessed` failure
case, the duplicate-detection branch — inherits `event_id` +
`event_type`. **"Find every log line for that one stuck event" is now
a one-grep operation in production.**

The store layer (`recordStripeEvent` / `markStripeEventProcessed`)
takes an optional `Logger` parameter and falls back to the
module-level `logger` when called from a non-request context (which
nothing does today, but the option is cheap to keep open).

## Testing strategy

Three principles:

1. **Don't assert on log output in business-logic tests.** Logging
   is a side-effect; the test should care about the return value or
   the persisted state, not the log line.
2. **Pass a fake `Logger`** when a test specifically wants to assert
   on what was logged (e.g. "did we log the pg_code on a failed
   write?"). Spying on `console.*` doesn't work — the structured
   logger doesn't go through `console`.
3. **Keep the wrapper itself trivially testable.** `logger.test.ts`
   asserts the surface (level methods, child binding) and the
   `requestLogger` header-fallback chain. The "is pino actually
   emitting" coverage is in pino's own tests.

The fake-logger pattern in `stripe-events-store.test.ts`:

```ts
function fakeLogger(): Logger & { __calls: { warn: unknown[][]; error: unknown[][] } } {
	const calls = { warn: [] as unknown[][], error: [] as unknown[][] };
	const log = {
		warn: (...a: unknown[]) => calls.warn.push(a),
		error: (...a: unknown[]) => calls.error.push(a),
		// … no-op trace/debug/info/fatal
		child: () => log,
		__calls: calls
	};
	return log as unknown as Logger & { __calls: typeof calls };
}
```

This double is intentionally hand-rolled (rather than `vi.fn()` for
each method) because it lets the test assert on the structured
_payload_ shape, not just on whether `warn` was called. That's the
property we actually care about: every error line should carry
`pg_code`, `err`, etc., not just human-readable text.

## What's still using `console.*`

This lesson migrated:

- `src/routes/api/webhooks/stripe/+server.ts`
- `src/lib/server/stripe-events-store.ts`

What's still on `console.*` and will migrate in follow-on lessons of
Module 10:

- `src/lib/server/billing/*.ts` (subscriptions, customers, invoices,
  products, portal, checkout) — these all run inside the webhook
  dispatcher today, so they get a logger via constructor injection
  in Lesson 10.4 when the replay tool gives us a clean place to
  thread it through.
- The CRUD `+page.server.ts` files — non-critical for the resilience
  story; migrated in Lesson 10.5 as part of the operational-hygiene
  sweep.
- `src/lib/server/supabase-admin.ts` audit logs — migrated in
  Lesson 10.5.

Each of those will be a small, targeted change. The webhook path
gets it first because it's the one that actually has paging-worthy
incidents.

## Field conventions

| Field        | Meaning                                                       | Set by                                                        |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `service`    | Always `contactly`                                            | base binding                                                  |
| `env`        | `NODE_ENV` snapshot at boot                                   | base binding                                                  |
| `req_id`     | Per-request id (`x-request-id` → `x-vercel-id` → random)      | `requestLogger`                                               |
| `route_id`   | SvelteKit `event.route.id` (e.g. `/api/webhooks/stripe`)      | `requestLogger`                                               |
| `vercel_id`  | Vercel function instance id, when present                     | `requestLogger`                                               |
| `user_id`    | uuid of the authenticated user                                | the auth hook (Lesson 10.5 wires this onto the locals logger) |
| `event_id`   | Stripe event id (`evt_…`)                                     | Webhook receiver `child()`                                    |
| `event_type` | Stripe event type (`invoice.paid`)                            | Webhook receiver `child()`                                    |
| `pg_code`    | Postgres `SQLSTATE` code on a Supabase error                  | Service-layer error branches                                  |
| `err`        | Human-readable error message, never the `Error` object itself | Every catch                                                   |

`err` is a **string**, not the `Error` object. Pino can serialize an
`Error` if we let it (with `pino.stdSerializers.err`), but we
deliberately keep the field stringy so log volume / cost is
predictable and stack traces don't leak into operational dashboards
that index every field. Stack traces for _real_ errors land in
Sentry (Lesson 10.2); the log line carries the message + correlating
context, and Sentry has the rest.

## Redaction list

The full list lives in `src/lib/server/logger.ts`; the rationale for
each entry:

- `req.headers.authorization` / `headers.authorization` /
  `cookie` / `headers["stripe-signature"]` — the obvious
  request-header secrets.
- `*.password` / `*.password_hash` / `*.api_key` / `*.secret` /
  `*.token` / `*.access_token` / `*.refresh_token` — common
  field-name patterns. The wildcard is one level deep, which is
  enough for our object shapes; if we ever log a deeply nested
  user payload, we'll add a deeper pattern.
- `*.SUPABASE_SERVICE_ROLE_KEY` / `*.STRIPE_SECRET_KEY` /
  `*.STRIPE_WEBHOOK_SECRET` — explicit, by-name protection in
  case a config dump ever shows up in a log call.

The redaction censor is `'[REDACTED]'` (not the pino default of
`***`) because it's a search-friendly string — grepping logs for
`[REDACTED]` instantly surfaces every place a secret would have
leaked, which is its own audit signal.

## Acceptance checklist

- [x] `pnpm run lint` and `pnpm run check` are green.
- [x] `pnpm run test:unit` is green; logger has its own tests; the
      stripe-events store and webhook receiver tests assert on the
      logger contract instead of `console.*` spying.
- [x] Webhook receiver no longer references `console.*`.
- [x] `src/lib/server/stripe-events-store.ts` no longer references
      `console.*`.
- [x] `pnpm run dev` shows pretty single-line logs; bare
      `NODE_ENV=production node …` would emit JSON (verified by the
      transport selection branch).
- [x] `LOG_LEVEL=trace` env var raises log verbosity without code
      change.

## What changed since Lesson 9.5

- **Deps:** added `pino` (runtime) and `pino-pretty` (dev).
- **New module:** `src/lib/server/logger.ts` + tests.
- **Hook:** `event.locals.logger` populated on every request.
- **Types:** `App.Locals.logger` typed as `Logger`.
- **Webhook path:** receiver + storage layer migrated off
  `console.*`; per-request and per-event log context bound via
  `child()`.
