# Contactly

> _Last revised: 2026-04-19. Reflects state through Module 12 (cassette
> harness) and Module 11 (Vercel deploy + hardening)._

Contactly is the multi-tenant contact-management SaaS that students build, end
to end, through the **SaaS-Pro** course. This directory holds the actual
project source. Each lesson tag (`course/lesson-XX-YY-...`) marks the exact
state the codebase reaches at the end of that lesson, so you can check out
any tag and run a working app.

For the per-module implementation docs (one folder per major surface), see
[`docs/README.md`](./docs/README.md).

> **Heads up.** This project lives inside the `course/` folder of the
> larger `saas-pro` repository, but it is intentionally **standalone** — it
> has its own `package.json`, its own `pnpm-lock.yaml`, and its own
> `node_modules`. You can copy this directory anywhere and it will run.

## Stack

| Concern                | Choice                                          |
| ---------------------- | ----------------------------------------------- |
| Framework              | SvelteKit 2 + Svelte 5 (runes)                  |
| Language               | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Styling                | Tailwind CSS v4 (`@tailwindcss/vite`)           |
| Database / Auth        | Supabase (Postgres, RLS, Auth)                  |
| Payments               | Stripe (Checkout, Billing Portal, Webhooks)     |
| Email                  | Resend (also wired as Supabase Auth SMTP)       |
| Tests — unit           | Vitest 4 (browser mode for component tests)     |
| Tests — end-to-end     | Playwright                                      |
| Errors / observability | Sentry                                          |
| Deploy                 | Vercel via GitHub Actions                       |

The architectural decisions that shape every lesson live in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md). Read it before you change
anything load-bearing.

## Getting started

```bash
cd course/contactly
cp .env.example .env          # values shipped are safe local defaults
pnpm install
pnpm run db:start             # boots Postgres + Auth + Studio in Docker
pnpm run dev
```

Then open <http://localhost:5173>. Supabase Studio is at
<http://localhost:64323>; local emails land in Inbucket at
<http://localhost:64324>.

> **Docker required.** `pnpm run db:start` needs Docker Desktop (or
> OrbStack / Colima) running. The first start downloads ~1 GB of
> images; subsequent starts take ~10 s.

## Scripts

| Script                      | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm run dev`              | Vite dev server with HMR                                           |
| `pnpm run build`            | Production build                                                   |
| `pnpm run preview`          | Serves the production build locally                                |
| `pnpm run check`            | `svelte-check` — TypeScript + Svelte template type checking        |
| `pnpm run lint`             | Prettier (check) + ESLint                                          |
| `pnpm run format`           | Prettier (write)                                                   |
| `pnpm run test:unit`        | Vitest unit tests                                                  |
| `pnpm run test:e2e`         | Playwright end-to-end tests                                        |
| `pnpm run test`             | Both unit and e2e                                                  |
| `pnpm run db:start`         | Boot the local Supabase stack                                      |
| `pnpm run db:stop`          | Stop the local Supabase stack                                      |
| `pnpm run db:status`        | Print URLs + keys for the running stack                            |
| `pnpm run db:reset`         | Drop and re-apply every migration + replay `seed.sql`              |
| `pnpm run db:migration:new` | Create a new timestamped migration file                            |
| `pnpm run db:push`          | Apply pending local migrations to the **linked** project           |
| `pnpm run db:diff`          | Capture schema drift into a new migration                          |
| `pnpm run types:generate`   | Regenerate `src/lib/database.types.ts` from the live schema        |
| `pnpm run seed:contacts`    | Generate N faker-based contacts for the `demo@contactly.test` org  |
| `pnpm run stripe:listen`    | Forward Stripe test events to `localhost:5173/api/webhooks/stripe` |
| `pnpm run stripe:trigger`   | Fire a test Stripe event on demand (Module 6+)                     |
| `pnpm run stripe:fixtures`  | Create the Contactly product catalog in your Stripe account        |
| `pnpm run stripe:cleanup`   | Archive Contactly Products + Prices in your Stripe account         |
| `pnpm run stripe:dev`       | Run dev server + Stripe listener side-by-side with prefixed output |

### Local Supabase ports

We use **64320–64329** (and 9083 for the edge runtime inspector) so this
project can run side-by-side with the SaaS-Pro platform's own local
Supabase, which uses 54320–54329.

| Service         | URL                                                       |
| --------------- | --------------------------------------------------------- |
| API             | <http://127.0.0.1:64321>                                  |
| DB (psql)       | `postgresql://postgres:postgres@127.0.0.1:64322/postgres` |
| Studio          | <http://localhost:64323>                                  |
| Inbucket (mail) | <http://localhost:64324>                                  |

## Course progression

Each lesson is a tag of the form `course/lesson-MM-LL-slug`. Each completed
module is also tagged `course/module-MM-complete`. To jump to the exact
state at the end of a given lesson or module:

```bash
git checkout course/lesson-12-04-cassette-scenarios
# or
git checkout course/module-12-complete
cd course/contactly
pnpm install
```

> **Important.** From Lesson 2.1 onwards, `pnpm run build` and
> `pnpm run dev` both require the env vars in `.env.example` to be set.
> Copy `.env.example` to `.env` before your first build — the validators
> in `src/lib/env.public.ts` and `src/lib/server/env.ts` fail loudly if
> anything required is missing or malformed.

### Modules 1–2 — Foundations

Set up SvelteKit 2 + Svelte 5 (runes), strict TypeScript, Tailwind v4,
ESLint + Prettier, Vitest + Playwright. Local Supabase stack on a
non-conflicting port range, NIST-aligned password rules, Inbucket for
mail. Protected `auth.*` schema, `public.profiles` with RLS + signup
trigger. Zod-validated env loaders (`src/lib/env.public.ts`,
`src/lib/server/env.ts`) — bad env fails at boot, not at the first
request. Server + client Supabase clients with `safeGetSession`
(JWT-validated, never raw-cookie), universal load that hands the
right client to each runtime, `onAuthStateChange` + `invalidate('supabase:auth')`
for live UI updates without a page reload.

### Module 3 — Auth UX

Sign-up + password sign-in + magic-link sign-in (one toggle-able
sign-in form, one shared email field), protected `(app)` route
group, sign-out + nav, account page with email/password updates,
delete-account flow with strong confirmation. Superforms 2 for every
form, Zod schema reuse on client + server, server-only redirects so
the unauthenticated state never hits a protected route.

### Module 4 — Contacts CRUD

The first business-logic vertical. `contacts` table + RLS scoped to
the owning user, server actions for create/read/update/delete, modal
edit + confirm-delete, toast feedback, optimistic UI for the list.
`pnpm run seed:contacts` for faker-generated data. Service-role
admin client for trigger-driven side effects (close-modal-on-cancel
sub-lesson handles the "save then dismiss" race cleanly).

### Module 5 — Stripe primer

Stripe Dashboard tour, API + docs orientation, Stripe CLI install
(WSL sub-lesson included), Products + Prices model, lookup keys for
plan-shape stability across environments, hand-built fixtures for
the Contactly catalog, idempotent cleanup script. Sets up the
mental model the rest of the billing modules need.

### Module 6 — Stripe foundations

Server-side Stripe SDK (`src/lib/server/stripe.ts`) with
auto-detected API version + retries. Webhook receiver
(`/api/webhooks/stripe`) with `constructEventAsync` (works on Node

- Edge), strict signature verification, the `WHAT_TO_STORE`
  inventory that drives Module 7's tables.

### Module 7 — Mirroring Stripe into Postgres

Per-resource service modules in `src/lib/server/billing/`:

- `products.ts` — Stripe Products + Prices ↔ local catalog tables.
- `customers.ts` — `stripe_customer_id` mapping per user.
- `subscriptions.ts` — full subscription lifecycle mirror with
  trial/active/past_due/canceled state.
- `invoices.ts` — invoice ledger for portal-less history rendering.

Every service is idempotent; the dispatch table in `stripe-events.ts`
gives each subscribed event its strongly-typed handler. The
`stripe_events` table provides the storage idempotency layer that
de-dupes Stripe's automatic retries.

### Module 8 — Pricing surface

Public pricing page driven by the mirrored catalog (no live Stripe
calls). `PlanBadge` + entitlements derived from the active
subscription. Account-page "Plan" section. Fail-closed contact cap
(free plan limited to N contacts; the cap is enforced server-side
on `create`, never client-side).

### Module 9 — Checkout, portal, invoices

Stripe Checkout session creation behind the upgrade button (Pro
monthly + annual), Billing Portal session for "manage subscription".
`/checkout/success` lands on a trial-guard page that polls the
subscription mirror until the webhook materialises the row.
`account/billing` lists every invoice from the local mirror.

### Module 10 — Operations

Production-grade observability + ops:

- **10.1** — `pino` structured logger with per-request correlation ids.
- **10.2** — Sentry SDKs (client + server) wired through SvelteKit hooks.
- **10.3** — `/api/admin/webhooks/health` endpoint + `is_platform_admin`
  flag with trigger-protected RLS for human-only escalation.
- **10.4** — `/admin/webhooks` dashboard + replay-by-event-id action
  for stuck webhooks.
- **10.5** — On-call runbook + Module 10 wrap.

### Module 11 — Production deploy

Deploy + hardening:

- **11.1** — `@sveltejs/adapter-vercel` with pinned runtime
  (`nodejs22.x`), region (`iad1`), memory, max duration, CDN cache
  rules in `vercel.json`.
- **11.2** — `@sentry/vite-plugin` for source-map upload, gated on
  the (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) triple,
  hidden source maps deleted post-upload.
- **11.3** — `src/lib/release.ts` as the single source of truth for
  release/environment/SHA. `/api/version` endpoint, deploy strip in
  the admin chrome, build-tag = runtime-tag by construction.
- **11.4** — Per-environment HTTP security headers (HSTS, COOP, CORP,
  Permissions-Policy, …) via SvelteKit hook + dynamic `/robots.txt`
  that locks down preview deploys.
- **11.5** — Incident-shaped on-call runbook + Module 11 wrap.

### Module 12 — Cassette test harness

End-to-end test harness for Stripe webhook scenarios:

- **12.1** — Zod-validated cassette JSON format + loader. Seed
  cassette: `subscribe-pro-monthly-keep`.
- **12.2** — Reusable webhook signing helper (`signWebhookBody` /
  `signWebhookEvent` / `buildSignedWebhookRequest`); the existing
  receiver test refactored onto it.
- **12.3** — Transport-agnostic playback driver
  (`playCassette({ transport, secret })`) for driving cassettes
  against any `(Request) => Response`.
- **12.4** — Three more cassettes (cancel, fail, recover) and 12
  scenario tests against the real receiver — closes the loop on
  the subscription lifecycle.
- **12.5** — Scoped GitHub Actions workflow
  (`.github/workflows/contactly-ci.yml`) with parallel
  full-suite + cassette-validation jobs, plus Module 12 wrap.

### Test + lint posture

```bash
pnpm run lint     # prettier --check && eslint
pnpm run check    # svelte-check
pnpm exec vitest run   # 272 unit tests, ~430 ms
pnpm run test:e2e # Playwright suite
```

CI gates lint + check + unit-tests on every PR that touches
`course/contactly/**`. Cassette validation runs as a parallel job
so a malformed cassette fails fast independently of the full suite.

### Documentation map

| Topic                             | Where                       |
| --------------------------------- | --------------------------- |
| Stripe primer + theory            | `docs/stripe/`              |
| Billing surface (Modules 8–9)     | `docs/billing/`             |
| Operations (Module 10)            | `docs/operations/`          |
| Deploy + hardening (Module 11)    | `docs/deploy/`              |
| Cassette test harness (Module 12) | `docs/testing/`             |
| Architectural decisions           | `../ARCHITECTURE.md` (root) |
