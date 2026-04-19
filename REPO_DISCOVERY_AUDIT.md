# SaaS-Pro — Repository discovery audit

**Generated from codebase inspection** (structure, routes, services, migrations, configs). This document describes what exists in the repo today, not deployment-specific account names.

---

## 1. Executive summary

| Item | Finding |
|------|---------|
| **Product** | Single **SvelteKit 2** application: marketing landing (`/`), pricing (`/pricing`), auth (`/login`, `/register`, …), and a **logged-in product surface** (`/dashboard`, `/learn`, `/account`). |
| **Monetization** | **Stripe** Checkout + Customer Portal; **Supabase** stores synced products/prices, customers, subscriptions, and lesson progress. |
| **Access model** | `(app)` routes require **login**. Lesson bodies are gated by **`canAccessLesson`**: preview lessons are readable when allowed by route logic; paid content requires **`trialing` / `active`** subscription in `public.subscriptions`. |
| **Deploy target** | **`@sveltejs/adapter-vercel`**; `vercel.json` pins `pnpm` install/build/dev commands. |
| **Data** | **Supabase** (Postgres + Auth). Schema defined under `supabase/migrations/`; TypeScript types in `src/lib/types/database.types.ts`. |

This is **one codebase and one deployable app**, not two separate repositories or two independent front-end apps. The “marketing site vs course platform” split is implemented with **route groups** and **server-side guards**, not separate hosts.

---

## 2. Technology stack

| Layer | Choice | Notes |
|-------|--------|--------|
| Framework | Svelte **5** (runes) + SvelteKit **2** | `svelte.config.js`: runes enabled for app sources. |
| Build | Vite **8** | `vite-plugin-svelte` notes experimental Vite 8 support. |
| Language | TypeScript | Strict typing; path aliases in `svelte.config.js`. |
| Styling | Tailwind CSS **4** (`@tailwindcss/vite`, typography + forms plugins) | Global styles in `src/app.css`. |
| Auth & DB | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | Cookie-based SSR client + service-role admin client. |
| Payments | Stripe **22** (`stripe` SDK) | Webhook at `POST /api/webhooks/stripe`. |
| Validation | Zod **4** | Server actions and API payloads. |
| Markdown | `marked` | Lesson content rendering in server pipeline. |
| Package manager | **pnpm** | `pnpm-workspace.yaml` whitelists native/postinstall deps (incl. Supabase CLI). |
| Lint/format | ESLint, Prettier | Scripts in `package.json`. |
| Tests | Vitest (browser + node projects), Playwright | Config present; see **§10 Gaps**. |

---

## 3. Path aliases (`svelte.config.js`)

| Alias | Points to |
|-------|-----------|
| `$components` | `src/lib/components` |
| `$server` | `src/lib/server` |
| `$types` | `src/lib/types` |
| `$config` | `src/lib/config` |
| `$utils` | `src/lib/utils` |
| `$content` | `src/content` |

---

## 4. Top-level directory map

| Path | Role |
|------|------|
| `src/routes/` | SvelteKit file-based routes (pages, layouts, API). |
| `src/lib/` | Shared UI, server modules, types, utilities, config. |
| `src/content/` | Course lesson **markdown** (mirrors `CURRICULUM` in `curriculum.config.ts`). |
| `src/hooks.server.ts` | Supabase per-request client, `getUser()`, session attachment. |
| `supabase/` | CLI config, **migrations**, `seed.sql`. |
| `static/` | Static assets (e.g. OG image). |
| `vercel.json` | Vercel framework + pnpm commands. |

---

## 5. Routes (discovery)

### 5.1 Public / marketing

| URL | File area | Purpose |
|-----|-----------|---------|
| `/` | `src/routes/+page.svelte` | Long-form marketing homepage. |
| `/pricing` | `src/routes/(marketing)/pricing/` | Pricing UI; loads prices from Stripe (fallback: Supabase `prices`). Checkout form actions. |
| `/sitemap.xml` | `src/routes/sitemap.xml/+server.ts` | Sitemap endpoint. |

Root layout `src/routes/+layout.svelte`: global **Navbar**, **Footer**, **Toast**.  
`src/routes/+layout.ts`: `prerender = 'auto'`.

### 5.2 Authentication

| URL | File area | Purpose |
|-----|-----------|---------|
| `/login` | `(auth)/login/` | Email/password (and related) sign-in. |
| `/register` | `(auth)/register/` | Sign-up; handles email-confirmation flow. |
| `/forgot-password` | `(auth)/forgot-password/` | Password reset request. |
| `/auth/callback` | `auth/callback/+server.ts` | OAuth / magic-link callback handler. |
| `/auth/google` | `auth/google/+server.ts` | Google OAuth route. |

`(auth)/+layout.server.ts`: if already logged in, **redirect** away (safe `next` handling).  
`(auth)/+layout.svelte`: centered card on gradient background (distinct from bare marketing sections).

### 5.3 Authenticated app (`(app)/`)

**Guard:** `src/routes/(app)/+layout.server.ts` — no `locals.user` → redirect to `/login?next=…`. Loads `hasSubscription` via `hasActiveSubscription`.

| URL | Purpose |
|-----|---------|
| `/dashboard` | Progress, tier badge, resume lesson, recent activity. |
| `/learn` | Module list / learn hub. |
| `/learn/[module]` | Module view. |
| `/learn/[module]/[lesson]` | Lesson reader; **gating** via `canAccessLesson` (preview vs subscription). |
| `/account` | Account + billing entry points (Stripe portal, etc.). |

`(app)/+layout.svelte` is a **pass-through**; shell chrome comes from root layout.

### 5.4 API (`src/routes/api/`)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/billing/checkout` | Create Stripe Checkout session. |
| POST | `/api/billing/portal` | Stripe Customer Portal session. |
| GET | `/api/billing/prices` | Expose price data for client use where needed. |
| POST | `/api/webhooks/stripe` | Stripe webhooks; signature verification; idempotency via `stripe_events`. |

Handled event types include product/price lifecycle, checkout completion, subscription lifecycle, and selected invoice events (see `HANDLED_EVENT_TYPES` in source).

### 5.5 Debug / development

| URL | Notes |
|-----|--------|
| `/debug/supabase` | Dev-oriented connectivity check; server load returns **404 in production** (`+page.server.ts`). |

---

## 6. Server architecture

### 6.1 Request lifecycle

1. **`hooks.server.ts`** — Creates request-scoped Supabase client, sets `locals.getUser()`, `locals.user`, `locals.session`.
2. **`+layout.server.ts` (root)** — Exposes `user` / `session` to all layouts.
3. **Route groups** — `(app)` enforces login; `(auth)` redirects if already authenticated; pages add business rules (e.g. lesson access).

### 6.2 Supabase clients (`src/lib/server/supabase.ts`)

- **SSR client** — `createRequestSupabaseClient(event)` — anon key + cookies; respects RLS.
- **Admin client** — `supabaseAdmin` — service role; used for webhooks, admin reads/writes, billing services. Implemented with **lazy initialization** so build-time analysis does not require secrets at module import.

### 6.3 Stripe (`src/lib/server/stripe.ts`)

- SDK client is **lazily** constructed for the same build-time reason as admin Supabase.

### 6.4 Access control (`src/lib/utils/access.ts`)

- `hasActiveSubscription(userId)` — at least one `subscriptions` row with status in `trialing` / `active`.
- `getSubscriptionTier(userId)` — derives tier from `prices.lookup_key` vs `src/lib/config/pricing.config.ts`.
- `canAccessLesson(userId, lesson)` — preview lessons always allowed; else requires subscription + user id.

### 6.5 Billing services (`src/lib/server/billing/`)

- `customers.service.ts` — Stripe customer ↔ profile mapping.
- `products.service.ts`, `subscriptions.service.ts` — sync from webhooks into Supabase.

### 6.6 Lessons (`src/lib/server/lessons/`)

- `content.service.ts` — loads markdown from `$content` by module/lesson slug.
- `markdown.ts` — rendering pipeline (uses `marked`).

---

## 7. Configuration modules (`src/lib/config/`)

| File | Purpose |
|------|---------|
| `site.config.ts` | App name, URL, OG defaults (`$env/dynamic/public`). |
| `curriculum.config.ts` | **Single source of truth** for modules, lesson slugs, durations, `preview` flags. |
| `pricing.config.ts` | Stripe **lookup keys** (`saas_pro_monthly`, `saas_pro_yearly`, `saas_pro_lifetime`), tier metadata. |

---

## 8. Database (Supabase migrations)

Migrations under `supabase/migrations/` (applied order by filename):

| Migration | Tables / objects (high level) |
|-----------|-------------------------------|
| `20260418000001_profiles.sql` | `profiles`, auth trigger `handle_new_user`, `set_updated_at`, RLS for profiles. |
| `20260418000002_billing_tables.sql` | `products`, `prices`, `customers`, `subscriptions` + RLS/triggers. |
| `20260418000003_progress_tracking.sql` | `lesson_progress` + RLS. |
| `20260418000004_stripe_event_idempotency.sql` | `stripe_events` (webhook idempotency). |

`supabase/seed.sql` — seed/placeholder data for local dev.

---

## 9. UI components (`src/lib/components/`)

Organized by concern:

- **layout** — `Navbar`, `Footer`, `Sidebar`, `ProgressBar`.
- **ui** — `Button`, `Card`, `Badge`, `Modal`, `Toast`.
- **lesson** — `LessonViewer`, `LessonNav`, `LessonComplete`, `CodeBlock`.
- **billing** — `PricingCard`, `UpgradePrompt`.
- **icons** — SVG icon set.

---

## 10. Content inventory

- **`src/content/`** — Markdown lessons grouped by `module-*` folders; filenames align with `CURRICULUM` entries.
- **Embedded course meta** — Homepage and curriculum config reference lesson counts and structure for marketing copy.

---

## 11. Testing & quality (as implemented)

| Mechanism | Status in repo |
|-----------|----------------|
| `pnpm check` | svelte-check + sync — configured. |
| `pnpm test:unit` | Vitest — **no `*.test.ts` / `*.spec.ts` files** found under the workspace at audit time. |
| `pnpm test:e2e` | Playwright — `testMatch: **/*.e2e.{ts,js}` — **no matching e2e files** found at audit time. |
| `pnpm lint` | Prettier + ESLint — configured. |

**Implication:** Test **tooling** is wired; **automated tests are largely absent** from the tree as of this audit.

---

## 12. Documentation & README

- **`README.md`** is still the generic **`sv` starter** text (create-project instructions, `better-auth`, `drizzle`, etc.) and does **not** reflect the current stack (Supabase session auth, Stripe-only billing). Treat README as **stale** until updated.

---

## 13. Environment variables (from `.env.example`)

Expected keys (set locally and on the host):

- **Public:** `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PUBLIC_APP_URL`, `PUBLIC_APP_NAME`
- **Private:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

---

## 14. Conclusion

The repository implements a **full-stack SvelteKit course SaaS**: one application serving **marketing + pricing**, **authentication**, and a **subscriber-only learning experience**, with **Stripe** for payments and **Supabase** for auth, relational data, and progress. Separation is by **routes and server logic**, not by multiple front-end projects.

**Suggested follow-ups (optional, not blocking):** align `README.md` with the real stack; add smoke e2e or unit tests if you want CI confidence; confirm preview-branch env parity on Vercel if you use preview deployments.

---

*End of report.*
