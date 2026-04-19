# Lesson 10.3 — Webhook backlog health endpoint + admin dashboard

> **Module 10 — Webhooks resilience & operational hygiene**
> Previous: [02 — Sentry server + client](./02-sentry.md)
> Next: [04 — Webhook replay tool](./04-webhook-replay.md)

## Goal

Two surfaces over the same `getWebhookHealth` snapshot:

- **A monitor-friendly JSON endpoint** at
  `/api/admin/webhooks/health` that returns the snapshot and the
  HTTP status the classifier picked (`200` for healthy/degraded,
  `503` for unhealthy). UptimeRobot / Datadog / Pingdom can poll
  it with `Authorization: Bearer <OPS_API_TOKEN>` and fire alerts
  off the status code alone.
- **A human dashboard** at `/admin/webhooks` for triage when an
  alert does fire. Shows the same numbers + a per-event-type
  breakdown so you can tell at a glance whether the problem is
  scoped (only `invoice.payment_failed` is stuck) or systemic
  (everything is).

Plus the supporting infrastructure:

- A **`profiles.is_platform_admin` schema flag** with an RLS-safe
  trigger guard so a malicious user can't self-promote.
- An **`OPS_API_TOKEN` server-only env var** for the bearer-token
  branch, with a length-floor refine and a constant-time
  comparison.
- A **dual-principal admin gate** that 404s every unauthorised
  caller (the existence of `/admin/*` is invisible to outsiders).

## Module map

| File                                                            | Layer        | Role                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260419000007_platform_admin.sql` _(new)_ | Schema       | Adds `is_platform_admin boolean default false`, the partial index, and the `profiles_protect_admin_flag` BEFORE-UPDATE trigger that pins the column for non-service-role updates. |
| `src/lib/database.types.ts` _(modified)_                        | Types        | Mirrors the new column on `profiles.Row`/`Insert`/`Update`.                                                                                                                       |
| `src/lib/server/env.ts` _(modified)_                            | Env          | Adds optional `OPS_API_TOKEN` with a 32-char floor and a base64url-friendly mint hint in the validator error.                                                                     |
| `src/lib/server/auth/admin.ts` _(new)_                          | Service      | `requireAdminOrToken(event)` — bearer-token branch first, then signed-in `is_platform_admin`; throws `error(404)` on every other path.                                            |
| `src/lib/server/auth/admin.test.ts` _(new)_                     | Tests        | 9 cases: valid token, wrong token, empty token disables branch, whitespace tolerance, scheme case-insensitivity, admin user, non-admin user, profile-read failure, no session.    |
| `src/lib/server/billing/webhook-health.ts` _(new)_              | Service      | `classifyHealth` (pure), `getWebhookHealth` (3 parallel reads against `stripe_events_unprocessed_idx`), `WARN_AGE_MS` / `CRITICAL_AGE_MS` constants.                              |
| `src/lib/server/billing/webhook-health.test.ts` _(new)_         | Tests        | Boundary sweep over the classifier (9 cases) including the empty/null defensive branches and the threshold lock-in.                                                               |
| `src/routes/api/admin/webhooks/health/+server.ts` _(new)_       | HTTP         | `GET` returns the JSON snapshot with the classifier-picked status, gated by `requireAdminOrToken`, `Cache-Control: no-store`.                                                     |
| `src/routes/(admin)/+layout.server.ts` _(new)_                  | Layout guard | Bouncer for the human surface. 404s anyone who isn't a signed-in `is_platform_admin`.                                                                                             |
| `src/routes/(admin)/+layout.svelte` _(new)_                     | Layout       | Minimal admin chrome — `noindex` meta, "internal" pill, no AppNav (visual mode-shift).                                                                                            |
| `src/routes/(admin)/admin/+page.svelte` _(new)_                 | Page         | Directory of admin tools. Today it's a single card for /admin/webhooks; future lessons append.                                                                                    |
| `src/routes/(admin)/admin/webhooks/+page.server.ts` _(new)_     | Page load    | `getWebhookHealth(log)` with a soft-fail `loadError` field.                                                                                                                       |
| `src/routes/(admin)/admin/webhooks/+page.svelte` _(new)_        | Page         | Status pill, three headline cards (status / count / oldest), per-type table, `/api/admin/webhooks/health` deep link.                                                              |
| `.env.example` _(modified)_                                     | Docs         | Documents `OPS_API_TOKEN` with the mint command + the "empty disables" semantics.                                                                                                 |

## Why a schema flag (and a trigger), not an env-var allow-list

ADR-006 (the long form lives in `supabase/migrations/20260419000007_platform_admin.sql`'s
header) — the short version:

- **Rotation.** `ADMIN_EMAILS=a@x.com,b@y.com` has the same
  operational footprint as a hard-coded constant: a redeploy is
  required to add or remove anyone. A schema flag is one row's
  UPDATE, instantly auditable, identical in dev/preview/prod.
- **Audit.** RLS policies and SQL queries can reference
  `is_platform_admin` directly. There is no comparable trick for
  a hard-coded list of emails.
- **Separation.** Admin elevation is a database-only operation;
  the application has no way to express it. A compromised app
  pod cannot escalate.

The trigger is the catch:

```sql
create or replace function public.profiles_protect_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user in ('service_role', 'postgres') then
        return new;
    end if;
    new.is_platform_admin = old.is_platform_admin;
    return new;
end;
$$;
```

`profiles_update_self` lets a signed-in user PATCH their own row.
Without this trigger, that policy would let them ship
`{ "is_platform_admin": true }` and walk in. With the trigger, that
field gets pinned to its OLD value for every role except
service-role / postgres — silently, no error, no leakage. Promotion
becomes a service-role-only operation: a DBA UPDATE, a migration,
or a server-side admin tool using `withAdmin(...)`.

## The dual-principal admin gate

`requireAdminOrToken(event)` is the single-source gate for both
the JSON endpoint and (a thinner version of) the human-page layout.

```ts
export type AdminPrincipal =
	| { kind: 'token'; reason: 'ops_api_token' }
	| { kind: 'user'; userId: string };

export async function requireAdminOrToken(event: RequestEvent): Promise<AdminPrincipal> {
	const tokenPrincipal = tryBearerToken(event);
	if (tokenPrincipal) return tokenPrincipal;

	const userPrincipal = await tryAdminUser(event);
	if (userPrincipal) return userPrincipal;

	throw error(404, 'Not Found');
}
```

Three properties to call out:

1. **Discriminated principal.** Routes that need to record "who
   did this admin action" branch on `kind`; the audit shape for
   an automated monitor (no user id) is meaningfully different
   from a human admin (user id known).

2. **404, never 401/403.** We deliberately don't differentiate the
   failure paths — a 401 from `/admin/webhooks/health` would tell
   a scraper "there's something here, brute-force the auth";
   a 404 says "nothing here, move on". Defense-in-depth.

3. **Constant-time bearer comparison.** `timingSafeEqual` requires
   equal-length buffers; mismatched lengths throw synchronously,
   which is itself a timing leak. We pad to the longer of the
   two and AND the length-equality bit at the end. The result is
   constant-time for any pair of inputs.

The `OPS_API_TOKEN` env var is **optional**. When empty (the
local-dev default), the bearer branch is fully disabled — _any_
incoming bearer token short-circuits to `null` without comparison.
The flag only opens for traffic when an operator deliberately
provisions one.

## The classifier

`classifyHealth` is the policy. It maps two numbers (count of
unprocessed rows, age of the oldest one) to a label + an HTTP
status:

| Inputs                                                    | Verdict       | HTTP |
| --------------------------------------------------------- | ------------- | ---- |
| `count == 0` (or `oldest == null`)                        | `'healthy'`   | 200  |
| `oldest_age < WARN_AGE_MS` (2 minutes)                    | `'healthy'`   | 200  |
| `WARN_AGE_MS ≤ oldest_age < CRITICAL_AGE_MS` (10 minutes) | `'degraded'`  | 200  |
| `oldest_age ≥ CRITICAL_AGE_MS`                            | `'unhealthy'` | 503  |

Thresholds chosen against Stripe's documented retry cadence:

- Stripe retries with exponential backoff. The first three retries
  fire within a minute, so a one-minute-old stuck row is **expected**
  during a real, recoverable Stripe outage.
- After 10 minutes Stripe is well past the early-retry window; if
  we're still stuck, the issue is not transient and the on-call
  needs paging.

`'degraded'` is the visible-but-not-paging zone: the dashboard goes
amber, the JSON endpoint stays 200, the monitor doesn't fire. This
is the right shape — paging at every Stripe blip would burn the
on-call's pager credibility.

The classifier is exported and unit-tested independently of
`getWebhookHealth` so the boundary cases never regress under a
"clever" rewrite.

## The reads

`getWebhookHealth` runs three parallel queries — count, oldest,
per-type buckets — every one of which rides
`stripe_events_unprocessed_idx` (the partial index from Module 6.4
that ONLY contains `processed_at IS NULL` rows). Even at
100k+ events of history the whole call is well under 10 ms in
practice because the index is `O(stuck rows)`, not `O(total events)`.

The per-type bucket scan is `LIMIT 500` and aggregated in JS rather
than via SQL `group by`; for the small unprocessed set this is the
faster path (one round-trip, no materialized aggregate) and lets us
keep the query a single `select` against the partial index.

`MAX_PER_TYPE_BUCKETS = 25` is the safety belt: a runaway test
environment with thousands of distinct event types can never blow
the response payload up.

## The JSON endpoint

The shape:

```json
{
	"status": "degraded",
	"httpStatus": 200,
	"unprocessedCount": 4,
	"oldestUnprocessedAt": "2026-04-19T13:51:42.123Z",
	"oldestUnprocessedAgeMs": 372451,
	"byEventType": [
		{ "type": "invoice.payment_failed", "count": 3 },
		{ "type": "customer.subscription.updated", "count": 1 }
	],
	"thresholds": { "warnAgeMs": 120000, "criticalAgeMs": 600000 },
	"measuredAt": "2026-04-19T13:57:54.574Z"
}
```

`Cache-Control: no-store` is mandatory — a CDN that caches even a
"healthy" 200 will silently mask the next regression.

A monitoring tool that polls every 60 seconds with the bearer
token gets the verdict in `httpStatus` directly, so the alert rule
is just "fire when /api/admin/webhooks/health returns non-200".

## The human dashboard

`/admin/webhooks` reads the same snapshot via `+page.server.ts` and
renders three headline cards (status pill, backlog count, oldest
age) plus a per-type table. The `loadError` path is a **soft fail**
— a Postgres hiccup on this page should still render the chrome
and an explanatory banner, not a generic 500 that the on-call has
to ssh into something to interpret.

The page is intentionally fully server-rendered (no `onMount`, no
in-page polling). Refresh is a hard reload, which is the right
pattern for an admin dashboard: every measurement is
server-of-record, no client-state sync to hold.

## Tests

| Suite                    | Cases | Notes                                                                                                                                        |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook-health.test.ts` | 9     | Pure boundary sweep over `classifyHealth`, plus a lock-in test for the threshold constants so a sneaky rebalance shows up in code review.    |
| `auth/admin.test.ts`     | 9     | Bearer accept/reject, empty-token-disables-branch, whitespace + case tolerance, signed-in admin/non-admin, profile-read failure, no-session. |

End-to-end "monitor hits the JSON endpoint and sees a 503" lands
in Module 12 with the recorded-Stripe-cassette harness; it requires
a real Postgres + a deliberately stuck event.

## Promoting a user (the runbook)

```sql
-- Run from the Supabase SQL editor or a service-role psql session.
update public.profiles
set is_platform_admin = true
where email = 'oncall@contactly.io';
```

That's it. The `profiles_protect_admin_flag` trigger short-circuits
for `service_role` / `postgres`, so the UPDATE goes through. The
admin sees `/admin` on their next request.

Demote with the symmetric statement (`is_platform_admin = false`).

## Operational checklist

- [x] Migration applies cleanly against the local Supabase
      (`pnpm run db:reset` + `pnpm run db:start`).
- [x] `pnpm run lint` / `pnpm run check` / `pnpm run test:unit`
      green (162/162 unit tests).
- [x] `pnpm run build` green.
- [x] Unauthorised callers see 404 on `/admin/*` and
      `/api/admin/*`.
- [x] Bearer token only accepted when `OPS_API_TOKEN` is set.
- [x] Bearer comparison is constant-time (asserted by inspection;
      tested by behaviour).
- [x] Health endpoint returns `Cache-Control: no-store`.
- [x] `is_platform_admin` cannot be self-elevated by a user
      (trigger pins it for non-service-role updates).

## What changed since Lesson 10.2

- **Schema:** new migration `20260419000007_platform_admin.sql`.
- **Types:** `is_platform_admin` mirrored into `database.types.ts`.
- **Env:** optional `OPS_API_TOKEN` (≥32 chars when set).
- **New modules:** `auth/admin.ts`, `billing/webhook-health.ts`,
  the JSON endpoint, the (admin) layout group with the home and
  webhooks pages.
- **Tests:** 18 new unit tests across the classifier and admin
  gate.
- **Docs:** this file + `.env.example` updates.
