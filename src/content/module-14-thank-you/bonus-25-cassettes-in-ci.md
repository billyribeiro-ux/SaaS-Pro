---
title: 'Bonus: Cassettes in CI Pipelines'
module: 14
lesson: 25
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-25-cassettes-in-ci'
description: 'Wire the cassette suite into GitHub Actions with two parallel jobs (full suite + cassette-only validation), Node-version pinning that matches production, and placeholder env vars so live secrets never reach the runner.'
duration: 22
preview: false
---

# Bonus: Cassettes in CI pipelines

The cassette harness from Bonuses 21–24 catches receiver bugs in milliseconds locally. The point of CI is to catch them in someone else's PR before review.

This lesson wires the cassette suite into GitHub Actions with two parallel jobs (full suite + cassette-only validation), pins the Node version to match production, and uses placeholder env vars so live secrets never reach the runner.

By the end of this lesson you will:

- Add a path-scoped GitHub Actions workflow that only runs when the relevant code changes.
- Run two parallel jobs: lint+typecheck+full unit suite, and cassette-only validation.
- Pin the CI Node version to match `runtime: 'nodejs22.x'` from your Vercel adapter (Bonus 16).
- Use placeholder env vars so SvelteKit's `$env/static/*` checker doesn't fail without leaking real secrets to the runner.
- Use `concurrency.cancel-in-progress` so force-pushes don't pile up runners.

## 1. The workflow file

`.github/workflows/contactly-ci.yml`:

```yaml
name: contactly-ci

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

concurrency:
  group: contactly-ci-${{ github.ref }}
  cancel-in-progress: true

env:
  PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
  PUBLIC_SUPABASE_ANON_KEY: anon_placeholder
  SUPABASE_SERVICE_ROLE_KEY: srk_placeholder
  STRIPE_SECRET_KEY: sk_test_ci_placeholder
  STRIPE_WEBHOOK_SECRET: whsec_ci_placeholder
  PUBLIC_SENTRY_DSN: ''
  PUBLIC_BASE_URL: https://contactly.test

jobs:
  full:
    name: lint + typecheck + unit
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: course/contactly
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
          cache-dependency-path: course/contactly/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run check
      - run: pnpm exec vitest run

  cassettes:
    name: cassette validation
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: course/contactly
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
          cache-dependency-path: course/contactly/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec vitest run src/lib/testing/cassette.test.ts src/lib/testing/cassette-loader.test.ts
```

## 2. Path scoping — pay only when you touch contactly

```yaml
on:
  push:
    paths:
      - 'course/contactly/**'
      - '.github/workflows/contactly-ci.yml'
```

A typo fix in `docs/` somewhere or a marketing-site change doesn't pay the CI cost. A change that touches contactly — including any cassette file — gets a green check before review.

The workflow file itself is in the path list so a tweak to the workflow re-runs CI to validate it.

## 3. Concurrency — cancel-in-progress

```yaml
concurrency:
  group: contactly-ci-${{ github.ref }}
  cancel-in-progress: true
```

Active development on a branch (force-pushing 5 fixups in 90 seconds) only consumes one runner at a time. The earlier runs are cancelled mid-flight as soon as the next push lands.

## 4. Two parallel jobs — full + cassette-only

**Job 1 — `full`:** lint, typecheck, full Vitest run. ~2 min wall.

**Job 2 — `cassettes`:** runs only `cassette.test.ts` and `cassette-loader.test.ts`. Catches malformed cassettes (offset reordering, duplicate event ids, apiVersion typos, missing fields) without re-running the full suite. ~30 s wall.

Why split? **The cost of "the cassette parses" is tiny and the failure is high-signal.** A new contributor authoring a cassette doesn't need the full receiver test suite to discover their JSON has duplicate `evt_*` ids — they need it to fail in the line that says "duplicate event id."

The two jobs run in parallel. If you only break a cassette, the `full` job is still running, but the `cassettes` job has already failed and the PR check is red.

## 5. Pin Node 22 — match production

Your Vercel adapter (Bonus 16) pins `runtime: 'nodejs22.x'`. The CI Node version must match.

The Web Crypto surface area available in undici differs between Node majors — running CI on a node version that doesn't match production has caused phantom Stripe signature mismatches in real codebases during source-map upload migrations.

If you change the runtime in `svelte.config.js`, change the CI Node version in the same PR.

## 6. Placeholder env vars — no secrets

Every test in the cassette suite mocks the env module (`$lib/server/env`) and signs cassettes with a hardcoded `whsec_unit_test_placeholder_secret_DO_NOT_USE`. The job-level placeholders exist solely so SvelteKit's `$env/static/*` type-checker doesn't fail with "missing required env var" at build time. **No live secret ever reaches the runner.**

If you ever add a Playwright suite that hits a real test database, that suite gets its own job with `secrets:` injection — the unit + cassette suite stays placeholder-only.

## 7. The single verification command

The local equivalent of CI is:

```bash
cd course/contactly
pnpm run lint && pnpm run check && pnpm exec vitest run
```

The cassette-only equivalent (matches CI's parallel job):

```bash
pnpm exec vitest run \
  src/lib/testing/cassette.test.ts \
  src/lib/testing/cassette-loader.test.ts
```

If you've authored a new cassette, the loader sweep test will pull it in automatically. If it fails:

- **"non-decreasing offset"** → events out of order in the JSON.
- **"duplicate event id"** → `evt_*` collision; pick a new id.
- **"missing field X"** → check the schema for the required shape.

## 8. Pre-commit hook (optional but worth it)

A husky / lefthook pre-commit that runs the cassette validation in <1 second:

```yaml
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"

cd course/contactly
pnpm exec vitest run src/lib/testing/cassette.test.ts src/lib/testing/cassette-loader.test.ts
```

Catches the broken cassette before it leaves your machine. The `cassettes` CI job is the safety net, the pre-commit is the bumper.

## 9. The full picture

```
┌────────────────────────────────────────────────────────────────┐
│  CI integration (this lesson)                                  │
│  - Scoped to course/contactly/** changes                       │
│  - Two parallel jobs: full suite + cassette-only validation    │
└──────────────┬─────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  End-to-end scenarios (Bonus 24)                                 │
│  - Four cassettes: subscribe, cancel, fail, recover              │
│  - 12 scenario tests against the real receiver                   │
└──────────────────────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  Playback driver (Bonus 23)                                      │
│  - playCassette(cassette, { transport, secret, ... })            │
│  - Transport-agnostic: real receiver / mock / no-op all welcome  │
└──────────────────────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  Webhook signing helper (Bonus 22)                               │
│  - signWebhookBody / signWebhookEvent / buildSignedWebhookRequest│
│  - Pure node:crypto, no Stripe SDK dependency                    │
└──────────────────────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────────────────────┐
│  Cassette format + loader (Bonus 21)                             │
│  - Zod-validated cassette JSON                                   │
│  - listCassettes() + loadCassette() + parseCassetteOrThrow       │
└──────────────────────────────────────────────────────────────────┘
```

Every layer above is a thin shim over the layer below. A new cassette is JSON-only; a new transport is one function; a new scenario test is six lines. The cost of testing a new Stripe event flow is now measured in cassette events, not in test files.

## 10. Cross-cutting design principles

- **Pure cores, async shells.** `cassette.ts` is a Zod schema and a parse function; `cassette-loader.ts` is the IO shim that reads files. `webhook-signing.ts` is pure HMAC; `cassette-driver.ts` is the IO shim that calls transports.
- **One source of truth per concern.** Signing is in `webhook-signing.ts` and used by both the cassette driver AND the existing receiver test. If Stripe ever ships v2 of the signature scheme, one file changes.
- **Transport-agnostic playback.** The cassette driver doesn't know about SvelteKit, fetch, or Node http. It speaks `(Request) => Response` and lets the caller decide.
- **Cassette = portable, hand-readable artifact.** The JSON format is reviewable in a PR diff. The `description` field is the human story. A junior engineer looking at a cassette can trace the full lifecycle without reading any test code.

## 11. Acceptance checklist

- [ ] `.github/workflows/contactly-ci.yml` exists.
- [ ] Path-scoped to `course/contactly/**` and the workflow file itself.
- [ ] `concurrency.cancel-in-progress: true` set.
- [ ] Two jobs: `full` (lint+check+vitest) and `cassettes` (validation only).
- [ ] Node version pins to `'22'` (match the adapter).
- [ ] Placeholder env vars at the job env, no secrets.
- [ ] `pnpm install --frozen-lockfile`.
- [ ] PR shows two checks; both green before merge.

## What's next

Bonus 26 starts the **advanced features track** — two-factor auth via TOTP using Supabase's MFA primitives, with enrolment flow, recovery codes, and step-up auth on the billing portal.
