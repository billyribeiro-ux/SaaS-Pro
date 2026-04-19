# Module 10 — Webhooks resilience & operational hygiene (wrap-up)

> Five lessons. One unified observability + recovery story.
>
> 1. [Structured logger foundation](./01-structured-logger.md)
> 2. [Sentry server + client + release tagging](./02-sentry.md)
> 3. [Webhook backlog health endpoint + admin dashboard](./03-webhook-health.md)
> 4. [Webhook replay tool](./04-webhook-replay.md)
> 5. [Operational runbook](./05-runbook.md)

## What we built

A four-layer resilience story for the Stripe webhook hot path,
plus the supporting observability surfaces every other system in
the app inherits.

### The four layers, top-down

```
┌────────────────────────────────────────────────────────────────┐
│  Operational runbook (Lesson 10.5)                             │
│  Human playbook for every alert + every triage path.           │
└────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────┬─────┘
│  Replay tool (Lesson 10.4)                               │
│  POST /api/admin/webhooks/replay (JSON, monitors)        │
│  /admin/webhooks form actions (humans, dashboard)        │
└──────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────┐
│  Health surface (Lesson 10.3)                            │
│  GET /api/admin/webhooks/health (JSON, monitors)         │
│  /admin/webhooks dashboard (humans, triage)              │
└──────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────┐
│  Observability foundation (Lessons 10.1 + 10.2)          │
│  Structured logger w/ req_id, route_id, user_id          │
│  Sentry w/ release, environment, req_id, route_id tags   │
│  Webhook receiver: stripe_event_id / stripe_event_type   │
└──────────────────────────────────────────────────────────┘
```

Every level above the foundation **inherits** the foundation's
correlation tags. A 503 alert from the health endpoint includes
the `req_id` of the request that produced it; a Sentry exception
fired by a stuck handler carries the same `req_id`; the
structured log lines for that request all share it. Cross-system
search is one grep, one click.

## Why these five, in this order

- **10.1 first** because every later lesson uses
  `event.locals.logger`. Building Sentry on top of `console.*`
  would force a costly migration two lessons later.
- **10.2 second** so by the time we ship admin endpoints (10.3)
  every error from them is tagged + alertable. Adding Sentry
  _after_ the admin surface would mean writing the surface
  blind to its own failure modes.
- **10.3 third** because health is the diagnostic primitive every
  recovery tool depends on. Replay without a health view is
  "operator types event id from memory"; replay with a health
  view is "operator clicks the row".
- **10.4 fourth** because the replay tool needs the snapshot's
  `stuckEvents` array (added in 10.4) and the admin gate
  (built in 10.3) to exist. Do it earlier and you're refactoring
  the snapshot mid-lesson.
- **10.5 last** because the runbook can only reference surfaces
  that exist. Writing it earlier produces aspirational
  documentation; writing it after produces a literal
  description of the system.

## Cross-cutting design principles

These are the things every Module 10 lesson honours:

### 1. Two principals, one gate

`requireAdminOrToken` is the only auth helper for admin surfaces.
Bearer-token branch for monitors, signed-in-admin branch for
humans. Constant-time comparison on the bearer. 404 on every
failure path so the surface itself is invisible to outsiders.

### 2. Pure cores, async shells

Every service module exposes a pure function the unit tests can
sweep without a database:

- `classifyHealth(count, oldestAgeMs) → { status, httpStatus }`
- `baseInitOptions(dsn) → Record<string, unknown>`
- `resolveRelease() → string`
- `resolveEnvironment() → string`

The async shell (`getWebhookHealth`, `replayStripeEvent`,
`requireAdminOrToken`) wires the pure core to the IO it needs.

### 3. Structured outcomes, not exceptions

`ReplayOutcome` is a discriminated union. The endpoint serialises
it directly; the dashboard renders it via a colour map. No
"error string" field for happy paths, no exceptions for "didn't
find the row" — every terminal state has a name.

### 4. Caps everywhere

- `MAX_BATCH_REPLAY = 25` — an `{}`-bodied request can't sweep
  the world.
- `MAX_STUCK_EVENTS = 50` — the snapshot never bloats past a
  few KB.
- `MAX_PER_TYPE_BUCKETS = 25` — a runaway test environment can't
  blow the JSON payload up.
- `OPS_API_TOKEN` length floor of 32 chars — generic brute-force
  is prohibitively expensive over HTTPS.

### 5. Fail closed

Every "I don't know if this is OK" path defaults to "no":

- Profile-read error in the admin gate ⇒ 404.
- Empty DSN ⇒ Sentry off (can't accidentally report dev errors
  to prod).
- Empty `OPS_API_TOKEN` ⇒ bearer branch fully disabled (can't
  accidentally accept any token).
- Read error in `getWebhookHealth` ⇒ count of `-1` so the
  endpoint goes 503, not silently "healthy".
- Dispatch failure in replay ⇒ `'failed'` with no
  `markProcessed` call, so the row stays available for the next
  attempt.

### 6. Local dev never lights up production

- Empty DSN keeps Sentry dark.
- Empty `OPS_API_TOKEN` keeps the bearer branch dark.
- Logger silent in tests.
- Webhook replay sequential (no surprise concurrency in a
  one-developer environment).

The student running `pnpm run dev` after cloning sees nothing
fire externally — every Module 10 surface is opt-in via env
configuration.

## What's deliberately out of scope

- **Source-map upload to Sentry.** Lands in Module 11 alongside
  the Vercel adapter swap; needs `SENTRY_AUTH_TOKEN` in CI plus
  the `@sentry/vite-plugin` integration.
- **PagerDuty / Opsgenie integration.** The runbook references
  "your on-call tool"; the wiring is project-specific and not
  worth a generic abstraction.
- **End-to-end "monitor sees 503 then operator replays" test.**
  Lands in Module 12 with the recorded-cassette harness.
  Today's coverage stops at the unit-level pure-classifier
  sweep + admin-gate scenarios.
- **Per-event retry budget tracking.** Stripe handles delivery
  retries; we re-apply on demand. A per-event counter on
  `stripe_events` would be valuable for "this row has failed 5
  replays — page someone different" semantics, but that's a
  follow-on lesson.
- **Audit log for admin actions.** Every replay logs via the
  structured logger with `admin_principal` and (for users)
  `user_id`. A first-class `admin_audit` table — append-only,
  RLS-locked-down, with view-only policies — is the right
  long-term shape and lands in a future hardening pass.

## Files added (cumulative across Module 10)

```
course/contactly/
├── .env.example                                           (modified)
├── docs/operations/
│   ├── 00-module-10-wrap.md                               (new — this file)
│   ├── 01-structured-logger.md                            (new — 10.1)
│   ├── 02-sentry.md                                       (new — 10.2)
│   ├── 03-webhook-health.md                               (new — 10.3)
│   ├── 04-webhook-replay.md                               (new — 10.4)
│   └── 05-runbook.md                                      (new — 10.5)
├── package.json                                           (modified — pino, @sentry/sveltekit)
├── src/
│   ├── app.d.ts                                           (modified — Locals.logger)
│   ├── hooks.client.ts                                    (new — Sentry client + handleError)
│   ├── hooks.server.ts                                    (modified — Sentry init + sentryHandle + handleError)
│   ├── lib/
│   │   ├── database.types.ts                              (modified — is_platform_admin)
│   │   ├── env.public.ts                                  (modified — PUBLIC_SENTRY_DSN)
│   │   ├── sentry-shared.ts                               (new)
│   │   ├── sentry-shared.test.ts                          (new)
│   │   └── server/
│   │       ├── auth/admin.ts                              (new)
│   │       ├── auth/admin.test.ts                         (new)
│   │       ├── billing/
│   │       │   ├── invoices.ts                            (modified — accept logger)
│   │       │   ├── webhook-health.ts                      (new)
│   │       │   ├── webhook-health.test.ts                 (new)
│   │       │   ├── webhook-replay.ts                      (new)
│   │       │   └── webhook-replay.test.ts                 (new)
│   │       ├── env.ts                                     (modified — OPS_API_TOKEN)
│   │       ├── logger.ts                                  (new)
│   │       ├── logger.test.ts                             (new)
│   │       ├── stripe-events.ts                           (modified — invoice.* routing in 9.5)
│   │       ├── stripe-events-store.ts                     (modified — accept logger)
│   │       └── stripe-events-store.test.ts                (modified — fakeLogger)
│   └── routes/
│       ├── (admin)/+layout.server.ts                      (new)
│       ├── (admin)/+layout.svelte                         (new)
│       ├── (admin)/admin/+page.svelte                     (new)
│       ├── (admin)/admin/webhooks/+page.server.ts         (new + extended in 10.4)
│       ├── (admin)/admin/webhooks/+page.svelte            (new + extended in 10.4)
│       ├── api/admin/webhooks/health/+server.ts           (new — 10.3)
│       ├── api/admin/webhooks/replay/+server.ts           (new — 10.4)
│       └── api/webhooks/stripe/+server.ts                 (modified — logger + Sentry tags)
└── supabase/migrations/
    └── 20260419000007_platform_admin.sql                  (new)
```

## Tests added

| Suite                         | Cases      | Notes                                         |
| ----------------------------- | ---------- | --------------------------------------------- |
| `logger.test.ts`              | 5          | Module 10.1                                   |
| `stripe-events-store.test.ts` | (modified) | Migrated from `console.*` spies to fakeLogger |
| `sentry-shared.test.ts`       | 11         | Module 10.2                                   |
| `webhook-health.test.ts`      | 9          | Module 10.3                                   |
| `auth/admin.test.ts`          | 9          | Module 10.3                                   |
| `webhook-replay.test.ts`      | 8          | Module 10.4                                   |

Total: **~42 new unit cases** across Module 10, on top of the
~129 pre-existing. Suite total at the end of the module:
**171 tests, 19 files, ~350 ms**. Every lesson commit kept the
suite green.

## What's next

Module 11 is the production-deploy + adapter swap (Vercel
adapter, source-map upload to Sentry, build-time SHA pinning,
preview-environment hardening). Module 12 layers the
recorded-cassette test harness for end-to-end Stripe scenarios on
top.

Both lean on Module 10's foundations — structured logs,
Sentry tags, the admin gate — without modifying them.
