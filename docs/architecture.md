# SaaS-Pro — Repository architecture

> Living document describing the **current state** of both apps in this
> repo. When the code changes shape, update this file in the same commit.
>
> _Last revised: 2026-04-19_

---

## 1. Executive summary

This repository ships **two SvelteKit 2 applications** in a single pnpm
workspace:

| App                                       | Path                | Role                                                                       |
| ----------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| **saas-pro** _(course platform)_          | `/`                 | Marketing, pricing, auth, dashboard, **lesson viewer** for the curriculum. |
| **contactly** _(the SaaS students build)_ | `course/contactly/` | Multi-tenant contact-management SaaS — the artifact the course produces.   |

This document covers the **saas-pro course platform** primarily; the
contactly app is documented exhaustively at
[`../course/contactly/README.md`](../course/contactly/README.md) and
[`../course/contactly/docs/README.md`](../course/contactly/docs/README.md).

Both apps are deployed independently:

- **saas-pro** → Vercel via [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
- **contactly** → Vercel via the workflow scaffolded in
  [`course/contactly/docs/deploy/`](../course/contactly/docs/deploy/) (Module 11).

---

## 2. Technology stack (saas-pro app)

| Layer           | Choice                                                      | Notes                                                            |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Framework       | Svelte 5 (runes) + SvelteKit 2                              | `svelte.config.js`: runes enabled for app sources only           |
| Bundler         | Vite 8 (Rolldown) + `@sveltejs/vite-plugin-svelte`          |                                                                  |
| Language        | TypeScript (strict)                                         | Path aliases declared in `svelte.config.js`                      |
| Styling         | Tailwind CSS 4 (`@tailwindcss/vite`, `typography`, `forms`) | Global styles in `src/app.css`                                   |
| Auth & DB       | Supabase (`@supabase/ssr`, `@supabase/supabase-js`)         | Cookie-based SSR client + service-role admin client              |
| Payments        | Stripe 22                                                   | Webhook at `POST /api/webhooks/stripe`                           |
| Validation      | Zod 4                                                       | Server actions, API payloads, env loaders                        |
| Markdown        | `marked`                                                    | Lesson rendering pipeline (`src/lib/server/lessons/markdown.ts`) |
| Package manager | pnpm 10 (workspaces)                                        | `pnpm-workspace.yaml` whitelists native postinstall deps         |
| Lint / format   | ESLint 10, Prettier 3, prettier-plugin-{svelte,tailwindcss} |                                                                  |
| Tests           | Vitest 4 (browser + node), Playwright                       | Smoke spec in `tests/smoke.e2e.ts`                               |
| Live-update     | `version: { pollInterval: 60_000 }` in `svelte.config.js`   | Detects mid-session deploys, forces clean reload                 |
| Deploy          | `@sveltejs/adapter-vercel`                                  | `vercel.json` pins pnpm install / build / dev commands           |

---

## 3. Path aliases (`svelte.config.js`)

| Alias         | Points to            |
| ------------- | -------------------- |
| `$components` | `src/lib/components` |
| `$server`     | `src/lib/server`     |
| `$types`      | `src/lib/types`      |
| `$config`     | `src/lib/config`     |
| `$utils`      | `src/lib/utils`      |
| `$content`    | `src/content`        |

---

## 4. Directory map (saas-pro app)

```
src/
├── app.css              ← Tailwind entry + global custom styles
├── app.d.ts             ← App.Locals / App.PageData type declarations
├── app.html             ← HTML shell
├── hooks.server.ts      ← Supabase per-request client, getUser, session attach
├── content/             ← Lesson markdown (mirrors curriculum.config.ts)
│   ├── module-00-introduction/
│   ├── module-01-project-setup/
│   ├── …
│   └── module-14-thank-you/
├── lib/
│   ├── components/      ← Reusable Svelte components
│   ├── config/          ← curriculum.config.ts (lesson registry)
│   ├── server/
│   │   ├── admin.ts                ← Service-role / admin helpers
│   │   ├── stripe.ts               ← Stripe SDK singleton
│   │   ├── supabase.ts             ← Supabase server-side client
│   │   ├── billing/{products,customers,subscriptions}.service.ts
│   │   └── lessons/{content,markdown}.ts
│   ├── stores/          ← Svelte stores (UI / shared state)
│   ├── types/           ← Generated DB types (database.types.ts) + shared types
│   └── utils/
└── routes/
    ├── (marketing)/     ← Public marketing surface (`/pricing`)
    ├── (auth)/          ← /login, /register, /forgot-password
    ├── (app)/           ← Logged-in product surface
    │   ├── dashboard/
    │   ├── learn/       ← Lesson viewer (module + lesson pages)
    │   ├── account/     ← Account settings + plan
    │   ├── contacts/    ← Demo contacts surface
    │   └── admin/       ← Admin-only screens
    ├── api/
    │   ├── webhooks/stripe/
    │   └── billing/{checkout,portal,prices}/
    ├── auth/            ← Auth callback routes
    ├── debug/           ← Internal-only debug surface
    └── sitemap.xml/
```

---

## 5. Data layer

### saas-pro Supabase

`supabase/migrations/` — applied in lexicographic order:

| File                                          | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `20260418000001_profiles.sql`                 | `public.profiles` + RLS + `handle_new_user` trigger  |
| `20260418000002_billing_tables.sql`           | Products / prices / customers / subscriptions mirror |
| `20260418000003_progress_tracking.sql`        | Per-user lesson-completion tracking                  |
| `20260418000004_stripe_event_idempotency.sql` | `stripe_events` table — webhook idempotency layer    |
| `20260419000001_admin_and_entitlements.sql`   | `is_platform_admin` flag + entitlement helpers       |
| `20260419000002_contacts.sql`                 | Demo contacts table for the in-platform demo         |

Generated TypeScript types live in `src/lib/types/database.types.ts`
(produced by `pnpm run db:types`).

### contactly Supabase

See [`course/contactly/supabase/migrations/`](../course/contactly/supabase/migrations/)
and the per-module docs under
[`course/contactly/docs/`](../course/contactly/docs/) for the contactly
schema (organizations, members, contacts, billing tables, platform-admin
flag).

---

## 6. Routing model — saas-pro

Three route groups separate concerns at the layout boundary:

| Group         | Layout guard                           | Contents                                                      |
| ------------- | -------------------------------------- | ------------------------------------------------------------- |
| `(marketing)` | None                                   | Public landing, `/pricing`                                    |
| `(auth)`      | Redirects authed users away            | `/login`, `/register`, `/forgot-password`                     |
| `(app)`       | `+layout.server.ts` — requires session | `/dashboard`, `/learn/*`, `/account`, `/contacts`, `/admin/*` |

Lesson access is gated by `canAccessLesson` (called inside the lesson
page's server `load`):

- Lessons with `preview: true` in their frontmatter are readable when the
  route logic allows previews.
- Paid content requires a `trialing` or `active` row in
  `public.subscriptions` for the acting user.

---

## 7. Webhooks & idempotency

`POST /api/webhooks/stripe`:

1. Validates the `Stripe-Signature` header with `constructEventAsync` (Edge-compatible).
2. Inserts the event id into `stripe_events`. If the row already exists
   (Postgres unique-violation), returns 200 and short-circuits.
3. Otherwise dispatches by `event.type` to the relevant service module
   (`src/lib/server/billing/{products,customers,subscriptions}.service.ts`).
4. Updates `stripe_events.processed_at` on success; the row stays
   present-but-unprocessed on failure so a retry can re-attempt.

This mirrors the contactly app's webhook contract (Module 7) so the
lesson code translates directly.

---

## 8. Deploy pipeline (saas-pro)

`.github/workflows/deploy.yml` runs on push to `main` and on manual
dispatch. The job sequence:

1. **Preflight — required secrets present.** Fails fast if any of
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, or
   `SUPABASE_DB_PASSWORD` is missing or empty. Error message links to the
   secret-rotation runbook.
2. **Preflight — Vercel token is live.** `curl https://api.vercel.com/v2/user`
   with the token; non-200 fails the job.
3. `pnpm install --frozen-lockfile`
4. Lint + typecheck + Vitest
5. `supabase link` + `supabase db push` (Supabase migrations)
6. `vercel pull` + `vercel build --prod` + `vercel deploy --prebuilt --prod`
   (CLI pinned to `vercel@51`)

Concurrency: `deploy` is serialized per branch (cannot stack); `ci` job
on PRs cancels in-progress runs of the same branch.

A separate workflow [`.github/workflows/contactly-ci.yml`](../.github/workflows/contactly-ci.yml)
gates lint / typecheck / Vitest / Stripe-cassette validation for the
contactly app on every change under `course/contactly/**`.

A third workflow [`.github/workflows/actionlint.yml`](../.github/workflows/actionlint.yml)
runs `actionlint` (with ShellCheck) on every workflow YAML to catch
structural mistakes before merge.

---

## 9. Observability — saas-pro

Compared to the contactly app (which ships full Sentry + structured
logging in Module 10), the saas-pro course platform currently runs with:

- Vercel's runtime stdout/stderr capture (no `pino` instance yet).
- No Sentry SDK.
- The `version: { pollInterval: 60_000 }` SvelteKit config to detect
  stale tabs after a new deploy.

Adding the same Sentry + `pino` stack to the course platform itself is
tracked as a known-future enhancement; it is **not** a regression because
the platform never made the claim of shipping them. The lessons that
build them live in the contactly app.

---

## 10. Known gaps & follow-ups

| Item                                                  | Status                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Sentry on the course platform itself                  | Pending — pattern documented in contactly Module 10                                    |
| Per-request structured logging on the course platform | Pending — pattern in `course/contactly/docs/operations/01-structured-logger.md`        |
| Playwright coverage beyond `tests/smoke.e2e.ts`       | Intentional: smoke is the gate here; deep coverage lives in contactly's E2E suite      |
| Course-platform pricing parity with contactly         | Tracked in `src/content/module-08-pricing-page/` — content shipped, ops parity pending |

When you close one of these, delete the row.

---

## 11. Curriculum vs. git tags — two views, one project

The repo carries **two intentionally distinct views** of the course's
lesson timeline. Don't try to make them mirror each other:

- **`src/lib/config/curriculum.config.ts`** — the lesson registry the
  saas-pro **course platform** renders. Mirrors `src/content/module-*`
  one-for-one and drives navigation, the `/learn` page, lesson titles,
  durations, preview flags, and `meta` for the lesson viewer. This is
  the **public-facing** lesson outline.
- **`course/lesson-XX-YY-*` git tags** — checkpoint commits in the
  contactly app's actual implementation history. Each tag reproduces
  the contactly repo state at the end of one **build step**. The
  numbering matches the lesson sequence as it was taught/built; some
  modules (e.g. tags 8–12) carry granular sub-steps (cassette format,
  cassette signing, etc.) that the curriculum collapses into a single
  topic.

The right mental model:

> The CURRICULUM describes _what students will learn_. The git tags
> describe _the discrete commits we shipped on the way to teaching it_.
> They reference the same body of work at different granularities.

Two automated guardrails enforce that each view is internally consistent:

- `pnpm run check:curriculum` cross-checks `CURRICULUM` against
  `src/content/**/*.md` frontmatter (titles, slugs, durations, preview
  flags). Run it after editing either file. Fails CI if they drift.
- `course/contactly` has its own ESLint / svelte-check / vitest /
  Playwright gates that ensure each tagged commit actually compiled
  and passed at that point in time.

---

## 12. References

- [Root README](../README.md)
- [Documentation index](./README.md)
- [Contactly ADRs](../course/ARCHITECTURE.md)
- [Contactly README](../course/contactly/README.md)
- [Contactly docs index](../course/contactly/docs/README.md)
- [Agent rules](../AGENTS.md)
