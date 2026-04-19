# Lesson 10.2 — Sentry server + client + release tagging

> **Module 10 — Webhooks resilience & operational hygiene**
> Previous: [01 — Structured logger](./01-structured-logger.md)
> Next: [03 — Webhook backlog health + admin dashboard](./03-webhook-health.md)

## Goal

Wire Sentry into both runtimes (server hooks + client hooks) with:

- A **single source of truth** for init options (`src/lib/sentry-shared.ts`)
  so the two `Sentry.init({ ... })` calls don't drift.
- **Release tagging** from the Vercel-provided git SHA (with an
  explicit `PUBLIC_SENTRY_RELEASE` override for CI-pinned releases).
- **Environment tagging** off `VERCEL_ENV` → `NODE_ENV` so previews
  show up as `preview` and never fire production alerts.
- **Cross-system correlation** via `req_id` — the same id our
  structured logger stamps on every line is a Sentry tag, so a
  log-to-Sentry jump is one click and a Sentry-to-log jump is one
  grep.
- **Webhook context** via `stripe_event_id` / `stripe_event_type`
  Sentry tags, so a failing `invoice.payment_failed` shows up
  pre-tagged for triage.
- **A real `handleError` hook** that reports to Sentry, logs through
  the structured logger with the same `req_id`, and lets
  `+error.svelte` render a friendly message.
- **Local-dev no-op** when `PUBLIC_SENTRY_DSN` is empty — zero noise
  hitting the production project from a `pnpm run dev` exception.

## Module map

| File                                                         | Layer    | Role                                                                                                                                                                        |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/sentry-shared.ts` _(new)_                           | Service  | `resolveRelease()`, `resolveEnvironment()`, `baseInitOptions(dsn)` — the shared init payload both runtimes spread into `Sentry.init`.                                       |
| `src/lib/sentry-shared.test.ts` _(new)_                      | Tests    | Env-precedence tables for release / environment / tracesSampleRate / enabled, plus the empty-DSN no-op contract.                                                            |
| `src/lib/env.public.ts` _(modified)_                         | Env      | Adds optional `PUBLIC_SENTRY_DSN` with strict shape validation (DSN-or-empty). Empty string is the canonical "Sentry off" value.                                            |
| `src/hooks.client.ts` _(new)_                                | Hook     | `Sentry.init` for the browser SDK + `handleError = handleErrorWithSentry()`.                                                                                                |
| `src/hooks.server.ts` _(modified)_                           | Hook     | Module-load `Sentry.init` for Node, `sentryHandle()` first in the `sequence(...)`, `req_id` / `route_id` tags onto Sentry scope, `handleErrorWithSentry` for `handleError`. |
| `src/routes/api/webhooks/stripe/+server.ts` _(modified)_     | Endpoint | Adds `stripe_event_id` / `stripe_event_type` Sentry tags right after signature verification.                                                                                |
| `src/routes/api/webhooks/stripe/server.test.ts` _(modified)_ | Tests    | Mocks `@sentry/sveltekit` so unit tests don't pull the SDK's transport.                                                                                                     |
| `src/routes/(app)/account/billing/+page.server.ts` _(fixed)_ | Bugfix   | Renames the exported helper to `_toBillingHistoryRow` (SvelteKit's allow-list for `+page.server.ts` exports). Pre-existing bug surfaced by a `pnpm run build`.              |

## Why one shared init helper

Sentry needs init in two places (`hooks.client.ts` and
`hooks.server.ts`) because the SDK's runtime detection uses the file
name as the dispatch key. If those two files keep their own copies
of the init options, the day someone bumps `tracesSampleRate` for
prod, they bump it on the server hook and forget the client. We've
all seen that PR.

`baseInitOptions(dsn)` returns a `Record<string, unknown>` (kept
loose so `sentry-shared` doesn't transitively pull in heavy SDK
types) with the five fields both runtimes care about:

| Field              | Value                                | Notes                                                                                          |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `dsn`              | passed in                            | The only signal for "is Sentry on?".                                                           |
| `enabled`          | `dsn.length > 0`                     | Empty DSN ⇒ true no-op; SDK won't start the transport.                                         |
| `release`          | `resolveRelease()`                   | `PUBLIC_SENTRY_RELEASE` → `contactly@<sha-12>` from `VERCEL_GIT_COMMIT_SHA` → `contactly@dev`. |
| `environment`      | `resolveEnvironment()`               | `VERCEL_ENV` → `NODE_ENV` → `'development'`.                                                   |
| `tracesSampleRate` | `0.1` in production, `1.0` otherwise | Spot regressions in prod cheaply; capture everything in dev.                                   |
| `sendDefaultPii`   | `false`                              | We attach `user_id` ourselves where it's relevant; the implicit IP-address capture stays off.  |

The release helper truncates the SHA to 12 chars for ergonomic
display in the Sentry UI ("contactly@a1b2c3d4e5f6") while keeping
the full SHA available as a tag (the Sentry SDK adds it
automatically when it sees `VERCEL_GIT_COMMIT_SHA`).

## Server wiring (`src/hooks.server.ts`)

Three mutually-reinforcing changes:

1. **Module-load `Sentry.init`.** Runs once per Node process, not
   per request. The DSN comes from `publicEnv.PUBLIC_SENTRY_DSN`
   (which falls back to `''` ⇒ no-op).

2. **`sentryHandle()` outermost in the sequence.** The SDK's docs
   are explicit about ordering: it has to wrap the rest of the
   request lifecycle to instrument the span. We compose with
   `@sveltejs/kit/hooks`'s `sequence(...)`:

   ```ts
   export const handle: Handle = sequence(sentryHandle(), handleApp);
   ```

3. **Tag the Sentry scope with `req_id` + `route_id`.** Done from
   inside `handleApp`, right after the structured logger gets
   stamped on `event.locals.logger`:

   ```ts
   const reqId = event.locals.logger.bindings().req_id;
   if (typeof reqId === 'string') setTag('req_id', reqId);
   if (event.route.id) setTag('route_id', event.route.id);
   ```

   This is the cross-system correlation. A Sentry event now carries
   the same `req_id` value our structured logger writes on every
   line. Pick whichever side of the system you noticed the problem
   from; the other side is one search away.

`handleError` is wired via `handleErrorWithSentry` with an inner
handler that mirrors the Sentry-side capture into our structured
logger using the same `req_id` (because the per-request logger is
on `event.locals`):

```ts
export const handleError: HandleServerError = handleErrorWithSentry(
	({ error, event, status, message }) => {
		const log = event.locals.logger ?? rootLogger;
		log.error(
			{
				err: error instanceof Error ? error.message : String(error),
				status,
				route_id: event.route.id ?? null
			},
			message ?? 'Uncaught server error'
		);
	}
);
```

The fallback to `rootLogger` is for the ultra-rare path where
SvelteKit invokes `handleError` _before_ `event.locals` is set
(crashes inside the hook chain itself). It's belt-and-braces — in
practice the per-request logger is always there.

## Client wiring (`src/hooks.client.ts`)

This is the leaner of the two:

```ts
sentryInit({
	...baseInitOptions(publicEnv.PUBLIC_SENTRY_DSN ?? '')
});

export const handleError = handleErrorWithSentry();
```

We don't add anything beyond the SDK defaults today. Future
breadcrumbs (Web Vitals, PII redaction filters, custom integrations)
land here as additive options — never moved out into a separate
file.

## Webhook tagging

The Stripe webhook receiver adds two more tags right after
signature verification:

```ts
sentrySetTag('stripe_event_id', event.id);
sentrySetTag('stripe_event_type', event.type);
```

A failing `invoice.payment_failed` now surfaces in Sentry with:

- `route_id: '/api/webhooks/stripe'` (from the server hook)
- `req_id: …` (from the server hook)
- `stripe_event_id: 'evt_…'` (from the receiver)
- `stripe_event_type: 'invoice.payment_failed'` (from the receiver)
- `release: 'contactly@<sha-12>'` (from the shared init)
- `environment: 'production'` (from the shared init)

That's everything an on-call engineer needs to triage in one glance.

## Env handling

`PUBLIC_SENTRY_DSN` is **optional** in the public env schema. The
refine:

```ts
.refine((v) => v === '' || /^https:\/\/[^@]+@[^/]+\/\d+$/.test(v))
```

Allows three states:

- Empty (the default in `.env.example`) → Sentry disabled. Local
  dev never reports to the production project.
- A real DSN (`https://<key>@<host>/<project>`) → Sentry enabled.
- Anything else → boot fails loudly with a precise validator error.

That last case is the value of validation at all: a typo'd DSN that
silently disables Sentry would only be discovered the day you
needed Sentry the most.

`PUBLIC_SENTRY_DSN` is treated as public because that's exactly what
it is — a write-only ingestion URL the browser SDK sends events to.
The tightening happens server-side in the Sentry project (allowed
domains, rate limits).

`SENTRY_AUTH_TOKEN` (server-only, for source-map uploads) stays out
of the validator schema for now; it lands when we add the Vite
plugin in Lesson 10.5.

## Tests

`src/lib/sentry-shared.test.ts` exercises:

- `resolveRelease`: `PUBLIC_SENTRY_RELEASE` precedence → SHA
  truncation → `'contactly@dev'` fallback (3 cases).
- `resolveEnvironment`: `VERCEL_ENV` precedence → `NODE_ENV`
  → `'development'` fallback (3 cases). The "no env" case
  exercises the `node || 'development'` short-circuit because
  Node's `delete process.env.X` collapses to `''`, not `undefined`.
- `baseInitOptions`: enabled/disabled gate on DSN, prod vs.
  non-prod sample rate, PII off-by-default (5 cases).

Total: 11 cases, all in 35 ms; pino + Sentry stay untouched in CI
because the helpers don't import them.

The webhook server test mocks `@sentry/sveltekit` to keep the suite
free of the SDK's import side-effects:

```ts
vi.mock('@sentry/sveltekit', () => ({
	setTag: vi.fn()
}));
```

End-to-end coverage of "an unhandled error reaches Sentry" lands in
Module 12 with the recorded-cassette harness; it requires a real
Sentry project ingestion stub.

## How to verify locally

1. Set `PUBLIC_SENTRY_DSN` to a project DSN in `.env`.
2. `pnpm run dev` and visit a route that throws (or the webhook
   endpoint with a deliberately broken handler).
3. Sentry's "Issues" tab should show the event within seconds, with
   `req_id`, `route_id`, `release`, `environment`, and any Stripe
   tags attached.
4. Cross-check the structured-log output for the same `req_id` —
   the lines line up exactly.

Leaving the DSN empty is the right local default; the SDK warns
once at startup that it's disabled and then never speaks again.

## Operational checklist

- [x] `pnpm run lint` / `pnpm run check` / `pnpm run test:unit`
      green.
- [x] `pnpm run build` green (caught and fixed a pre-existing
      `+page.server.ts` export-allow-list bug from Lesson 9.5 in
      the process).
- [x] No DSN ⇒ true no-op (asserted in `sentry-shared.test.ts`).
- [x] Real DSN ⇒ `enabled: true`, `release` + `environment`
      resolved, sample rate honored (asserted).
- [x] Webhook errors carry `stripe_event_id` / `stripe_event_type`
      (manual verification — covered E2E in Module 12).

## What changed since Lesson 10.1

- **Deps:** added `@sentry/sveltekit` (10.49+).
- **New modules:** `src/lib/sentry-shared.ts`, `src/lib/sentry-shared.test.ts`, `src/hooks.client.ts`.
- **Server hooks:** Sentry init at module load, `sentryHandle()` in
  the request sequence, `req_id`/`route_id` Sentry tags,
  `handleErrorWithSentry` for the `handleError` export.
- **Webhook receiver:** `stripe_event_id`/`stripe_event_type` Sentry tags.
- **Env:** `PUBLIC_SENTRY_DSN` optional with strict shape check.
- **Bugfix:** `_toBillingHistoryRow` rename in
  `/account/billing/+page.server.ts` so the production build
  succeeds (SvelteKit's `+page.server.ts` export allow-list).
