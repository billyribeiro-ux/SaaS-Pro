# 12.5 — CI wiring + Module 12 wrap

> **Module 12 — Recorded-cassette test harness for end-to-end Stripe scenarios.**
>
> Lesson 5 of 5. Wires the cassette suite into GitHub Actions so a
> regression in Module 7's invoice handlers, Module 9's checkout
> shape, or Module 10's webhook receiver shows up in a PR check
> instead of in a customer ticket. Then closes Module 12 with a
> comprehensive wrap.

## CI wiring

The repo root's `deploy.yml` workflow targets the standalone marketing
app at the repo root. Contactly lives under `course/contactly/` as a
separate pnpm project and now has its own scoped workflow:

```
.github/workflows/contactly-ci.yml
```

### Triggering shape

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'course/contactly/**'
      - '.github/workflows/contactly-ci.yml'
  pull_request:
    branches: [main]
    paths:
      - 'course/contactly/**'
      - '.github/workflows/contactly-ci.yml'
```

A lesson commit that doesn't touch contactly files (a `docs/`
typo fix elsewhere, a marketing-site change) doesn't pay the CI
cost. A lesson commit that does — including any touch on the
cassette files — gets a green check before review.

`concurrency.cancel-in-progress: true` means active development on a
branch (force-pushing 5 fixups in 90 seconds) only consumes one
runner at a time.

### Two parallel jobs

Job 1: **Lint, typecheck, unit tests.** Runs `pnpm run lint`,
`pnpm run check`, `pnpm exec vitest run`. ~272 tests in ~430 ms,
plus pnpm install + tooling overhead = ~2 min wall.

Job 2: **Cassette validation.** Runs only `cassette.test.ts` and
`cassette-loader.test.ts`. Catches malformed cassettes (offset
reordering, duplicate event ids, apiVersion typos, missing
fields) without re-running the full suite. ~30 s wall.

The cassette-only job exists because **the cost of "the cassette
parses" is tiny and the failure is high-signal**. A new contributor
authoring a cassette doesn't need the full receiver test suite to
discover their JSON has duplicate `evt_*` ids — they need it to
fail in the line that says "duplicate event id."

### Node 22, not Node 20

The root workflow pins Node 20. `contactly-ci.yml` pins Node 22
to match `svelte.config.js`'s `runtime: 'nodejs22.x'`. The Web
Crypto surface area available in undici differs between majors —
running CI on a node version that doesn't match production has
caused phantom Stripe signature mismatches in this exact codebase
during Module 11.2's source-map upload migration. We pin the
runtime in the adapter config; we pin the same major in CI.

### Placeholder env vars, no secrets

```yaml
env:
  PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
  ...
  STRIPE_SECRET_KEY: sk_test_ci_placeholder
  STRIPE_WEBHOOK_SECRET: whsec_ci_placeholder
```

Every test in the cassette suite mocks the env module
(`$lib/server/env`) and signs cassettes with a hardcoded
`whsec_unit_test_placeholder_secret_DO_NOT_USE`. The job-level
placeholders exist solely so SvelteKit's `$env/static/*`
type-checker doesn't fail with "missing required env var" at
build time. No live secret ever reaches the runner.

If we ever add a Playwright suite that hits a real test database,
that suite gets its own job with `secrets:` injection — the unit

- cassette suite stays placeholder-only.

---

## Module 12 — wrap

Five lessons. One reusable test harness for every Stripe webhook
scenario we'll add for the rest of the project.

### What we built

```
┌────────────────────────────────────────────────────────────────┐
│  CI integration (Lesson 12.5)                                  │
│  - Scoped to course/contactly/** changes                       │
│  - Two parallel jobs: full suite + cassette-only validation    │
└──────────────┬─────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  End-to-end scenarios (Lesson 12.4)                              │
│  - Four cassettes: subscribe, cancel, fail, recover              │
│  - 12 scenario tests against the real receiver                   │
└──────────────────────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  Playback driver (Lesson 12.3)                                   │
│  - playCassette(cassette, { transport, secret, ... })            │
│  - Transport-agnostic: real receiver / mock / no-op all welcome  │
└──────────────────────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  Webhook signing helper (Lesson 12.2)                            │
│  - signWebhookBody / signWebhookEvent / buildSignedWebhookRequest│
│  - Pure node:crypto, no Stripe SDK dependency                    │
└──────────────────────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  Cassette format + loader (Lesson 12.1)                          │
│  - Zod-validated cassette JSON                                   │
│  - listCassettes() + loadCassette() + parseCassetteOrThrow       │
└──────────────────────────────────────────────────────────────────┘
```

Every layer above is a thin shim over the layer below. A new
cassette is JSON-only; a new transport is one function; a new
scenario test is six lines. The cost of testing a new Stripe
event flow is now measured in cassette events, not in test files.

### Cross-cutting design principles

- **Pure cores, async shells.** `cassette.ts` is a Zod schema and
  a parse function; `cassette-loader.ts` is the IO shim that reads
  files. `webhook-signing.ts` is pure HMAC; `cassette-driver.ts`
  is the IO shim that calls transports. Same Module 10 / Module 11
  pattern.
- **One source of truth per concern.** Signing is in
  `webhook-signing.ts` and used by both the cassette driver AND
  the existing receiver test (refactored in 12.2 to delete its
  private copy). If Stripe ever ships v2 of the signature scheme,
  one file changes.
- **Transport-agnostic playback.** The cassette driver doesn't
  know about SvelteKit, fetch, or Node http. It speaks
  `(Request) => Response` and lets the caller decide. The same
  cassette plays against the production receiver in scenario
  tests, against a recording stub in integration tests, and could
  play against a `fetch`-based HTTP transport in a future smoke
  test against a real Vercel preview deploy.
- **Cassette = portable, hand-readable artifact.** The JSON
  format is reviewable in a PR diff. The `description` field is
  the human story. The `events` array is the wire-shape Stripe
  delivers. A junior engineer looking at a cassette can trace the
  full lifecycle without reading any test code.
- **Surgical mocks at the seam, not the leaves.** Scenario tests
  mock exactly two modules (the dispatch table + the storage
  layer) and run the receiver's HTTP layer for real. Mocking less
  would make tests slow + DB-dependent; mocking more would let the
  receiver's bugs through. The seam is the dispatch table because
  per-handler tests already cover the leaves.
- **Fail loudly, retry cleanly.** A handler that throws produces
  a 500 (Stripe retry signal). A storage layer that fails
  produces a 500 BEFORE the dispatcher runs (no half-applied side
  effect). A duplicate delivery produces a 200 with `duplicate:
true` (Stripe stops retrying). These three modes are tested by
  the cross-cassette behaviour suite in 12.4.

### What's deliberately out of scope

- **Cassette recorder mode.** The inverse of playback — capture
  webhook exchanges from a real test-mode Stripe account and write
  them out as a cassette. Useful for new event types we don't
  hand-author yet. Lands when we onboard a sufficiently exotic
  Stripe event (e.g. Issuing, Connect transfers, Treasury) where
  the payload is too complex to author by hand.
- **`offsetMs`-aware playback.** The driver fires events
  back-to-back. The cassette JSON carries the offsets so a future
  test that asserts on Stripe's "events delivered with stale
  timestamp are rejected" behaviour can drive playback at the
  recorded cadence. Not needed for the current four scenarios.
- **`stripeApiVersion` checks.** Cassettes carry the API version
  they were authored against. A future "your cassette is N major
  versions behind the SDK" check has a place to live. Lands when
  Stripe's next API version dahlia is superseded and we have to
  decide whether to re-record or version-pin.
- **Full DB integration mode.** Scenario tests mock the dispatch
  table for speed (272 tests, ~430 ms). A future "smoke a cassette
  against a real Supabase test schema" mode would unmock the
  storage + dispatch layer and assert against `subscriptions` /
  `invoices` / `stripe_events` rows after playback. The cassette
  JSON is reusable across both modes — that's the point of the
  format.
- **Real-Stripe roundtrip testing.** Anything that hits
  `api.stripe.com`. Belongs in a separate "live integration" job
  with API keys; we're deliberately keeping the cassette suite
  hermetic.

### Files added (cumulative across Module 12)

```
course/contactly/
├── docs/testing/
│   ├── 01-cassette-format.md             (new — 12.1)
│   ├── 02-cassette-signing.md            (new — 12.2)
│   ├── 03-cassette-driver.md             (new — 12.3)
│   ├── 04-cassette-scenarios.md          (new — 12.4)
│   └── 05-ci-and-wrap.md                 (new — 12.5; this file)
├── src/lib/testing/
│   ├── cassette.ts                       (new — 12.1)
│   ├── cassette.test.ts                  (new — 12.1; 12 cases)
│   ├── cassette-loader.ts                (new — 12.1)
│   ├── cassette-loader.test.ts           (new — 12.1; 6 cases)
│   ├── webhook-signing.ts                (new — 12.2)
│   ├── webhook-signing.test.ts           (new — 12.2; 11 cases)
│   ├── cassette-driver.ts                (new — 12.3)
│   ├── cassette-driver.test.ts           (new — 12.3; 13 cases)
│   ├── cassette-scenarios.test.ts        (new — 12.4; 12 cases)
│   └── cassettes/
│       ├── subscribe-pro-monthly-keep.cassette.json
│       ├── cancel-pro-monthly-immediate.cassette.json
│       ├── payment-failed-pro-monthly.cassette.json
│       └── recover-after-payment-failure.cassette.json
└── src/routes/api/webhooks/stripe/
    └── server.test.ts                    (modified — 12.2; uses signing helper)

.github/workflows/
└── contactly-ci.yml                      (new — 12.5)
```

### Tests added (cumulative)

| Lesson | Suite                        | Cases |
| ------ | ---------------------------- | ----- |
| 12.1   | `cassette.test.ts`           | 12    |
| 12.1   | `cassette-loader.test.ts`    | 6     |
| 12.2   | `webhook-signing.test.ts`    | 11    |
| 12.3   | `cassette-driver.test.ts`    | 13    |
| 12.4   | `cassette-scenarios.test.ts` | 12    |

Total: **+54 new unit cases** across Module 12, on top of the
217 from Module 11. Suite total at the end of Module 12:
**272 tests, 26 files, ~430 ms**. Every lesson commit kept the
suite green. CI runs the same suite + cassette validation on
every PR that touches contactly.

### Verification matrix

The single command to confirm Module 12 is healthy:

```bash
cd course/contactly
pnpm run lint && pnpm run check && pnpm exec vitest run
# 272 tests, 26 files, ~430 ms
```

Specific cassette-only validation (matches CI's parallel job):

```bash
pnpm exec vitest run \
  src/lib/testing/cassette.test.ts \
  src/lib/testing/cassette-loader.test.ts
```

If you've authored a new cassette, the loader sweep test will pull
it in automatically. If it fails:

- "non-decreasing offset" → events out of order in the JSON.
- "duplicate event id" → `evt_*` collision; pick a new id.
- "missing field X" → check the `cassetteSchema` in
  `cassette.ts` for the required shape.

## What's next

Module 13 — performance. Edge runtime for marketing routes,
Lighthouse budgets in CI, image pipeline. Builds on the deploy
primitives from Module 11 and the test harness from Module 12.
