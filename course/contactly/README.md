# Contactly

Contactly is the multi-tenant contact-management SaaS that students build, end
to end, through the **SaaS-Pro** course. This directory holds the actual
project source. Each lesson tag (`course/lesson-XX-YY-...`) marks the exact
state the codebase reaches at the end of that lesson, so you can check out
any tag and run a working app.

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

| Script                      | What it does                                                |
| --------------------------- | ----------------------------------------------------------- |
| `pnpm run dev`              | Vite dev server with HMR                                    |
| `pnpm run build`            | Production build                                            |
| `pnpm run preview`          | Serves the production build locally                         |
| `pnpm run check`            | `svelte-check` — TypeScript + Svelte template type checking |
| `pnpm run lint`             | Prettier (check) + ESLint                                   |
| `pnpm run format`           | Prettier (write)                                            |
| `pnpm run test:unit`        | Vitest unit tests                                           |
| `pnpm run test:e2e`         | Playwright end-to-end tests                                 |
| `pnpm run test`             | Both unit and e2e                                           |
| `pnpm run db:start`         | Boot the local Supabase stack                               |
| `pnpm run db:stop`          | Stop the local Supabase stack                               |
| `pnpm run db:status`        | Print URLs + keys for the running stack                     |
| `pnpm run db:reset`         | Drop and re-apply every migration + replay `seed.sql`       |
| `pnpm run db:migration:new` | Create a new timestamped migration file                     |
| `pnpm run db:push`          | Apply pending local migrations to the **linked** project    |
| `pnpm run db:diff`          | Capture schema drift into a new migration                   |
| `pnpm run types:generate`   | Regenerate `src/lib/database.types.ts` from the live schema |
| `pnpm run seed:contacts`    | Generate N faker-based contacts for the `demo@contactly.test` org |
| `pnpm run stripe:listen`    | Forward Stripe test events to `localhost:5173/api/webhooks/stripe` |
| `pnpm run stripe:trigger`   | Fire a test Stripe event on demand (Module 6+)              |
| `pnpm run stripe:fixtures`  | Create the Contactly product catalog in your Stripe account |

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

## Module 1 progress

Each lesson lands a verified, tagged commit:

- **Lesson 1.1 — SvelteKit project setup.** SvelteKit 2 + Svelte 5
  (runes), strict TypeScript, Tailwind v4, ESLint + Prettier, Vitest
  - Playwright, one passing smoke test, branded welcome homepage.
- **Lesson 1.2 — Supabase local development.** `supabase init` with a
  config tuned for the Contactly stack: ports off the default range so
  it never collides with anything else on your machine, NIST-aligned
  password rules, mandatory email confirmation for password sign-ups,
  Inbucket for local mail, and a commented-out Resend SMTP block ready
  for production.
- **Lesson 1.3 — Protected auth schema.** First migration: revokes all
  on `auth.*` from `anon` + `authenticated`, alters default privileges
  forward, leaves `service_role` and `supabase_auth_admin` untouched.
- **Lesson 1.4 — Profiles + RLS + triggers.** Second migration: the
  `public.profiles` table, RLS scoped to the row owner, the reusable
  `set_updated_at()` trigger, and the `handle_new_user()` trigger that
  mirrors signups from `auth.users`. Module 4 will extend the trigger
  to also create the user's personal organization.
- **Lesson 2.1 — Server-side env with Zod.** `src/lib/env.public.ts`
  - `src/lib/server/env.ts` parse and validate `$env/dynamic/*` at
    boot. Misconfiguration produces a precise, actionable error rather
    than a runtime "URL is undefined" failure.
- **Lesson 2.2 — Supabase SDKs + database types.**
  `@supabase/supabase-js` 2.103+ and `@supabase/ssr` 0.10+ installed.
  Hand-written `src/lib/database.types.ts` that mirrors the migrations
  exactly so `pnpm run check` is green without Docker; regenerated
  from the live schema with `pnpm run types:generate`.
- **Lesson 2.3 — Server-side Supabase + safeGetSession.**
  `src/hooks.server.ts` instantiates a per-request `createServerClient`
  with the v0.10 `getAll` / `setAll(cookies, headers)` cookie API and
  attaches `event.locals.supabase` + `event.locals.safeGetSession`
  (which validates the JWT via `getUser()` instead of trusting the raw
  cookie). `src/routes/+layout.server.ts` exposes `{ session, user,
cookies }` to every page. `src/app.d.ts` types `App.Locals` so the
  whole codebase gets autocomplete on these. Playwright's web server
  now seeds demo Supabase env so e2e tests boot cleanly without
  requiring a local `.env`.
- **Lesson 2.4 — Client-side Supabase + auth-state propagation.**
  `src/routes/+layout.ts` is the universal load: in the browser it
  builds a `createBrowserClient`, on the server it builds a
  `createServerClient` from the cookies forwarded by Lesson 2.3.
  `+layout.svelte` subscribes to `onAuthStateChange` and calls
  `invalidate('supabase:auth')` on `SIGNED_IN` / `SIGNED_OUT` /
  `TOKEN_REFRESHED`, which re-runs every load that depends on
  session/user — UI updates without a full page reload. The homepage
  now renders the auth state ("Signed in as …" / "Not signed in")
  to make the wiring visible, and a second e2e asserts the
  unauthenticated baseline.

> **Important.** From Lesson 2.1 onwards, `pnpm run build` and
> `pnpm run dev` both require the env vars in `.env.example` to be set.
> Copy `.env.example` to `.env` before your first build — the validators
> in `src/lib/env.public.ts` and `src/lib/server/env.ts` fail loudly if
> anything required is missing or malformed (which is the point: a
> deploy with bad env should fail at the build, not at the first
> request in production).

## Course progression

Each lesson is a tag of the form `course/lesson-MM-LL-slug`. To jump to the
exact state at the end of a given lesson:

```bash
git checkout course/lesson-04-03-creating-contacts
cd course/contactly
pnpm install
```
