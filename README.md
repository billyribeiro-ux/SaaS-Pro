# SaaS-Pro

> Production-grade SvelteKit course platform plus the multi-tenant SaaS
> students build inside it, in one pnpm workspace.
>
> _Last revised: 2026-04-19_

---

## What's in this repository

This repo is **two deployable apps in one workspace**:

| Path                | App                                         | Role                                                                                                              |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/`                 | **`saas-pro`** — the course platform        | Marketing site, pricing, auth, dashboard, lesson viewer. Renders the markdown in `src/content/` as the course UX. |
| `course/contactly/` | **`contactly`** — the SaaS students _build_ | Standalone SvelteKit app the course produces lesson by lesson. Tagged at every lesson and module boundary.        |

Both apps share `pnpm-lock.yaml` (declared in `pnpm-workspace.yaml`) so a
single `pnpm install` at the repo root installs and dedupes everything.

```
saas-pro/
├── src/                     ← saas-pro course-platform app
│   ├── routes/(marketing|auth|app)/
│   ├── content/             ← lesson markdown (mirrors `curriculum.config.ts`)
│   └── lib/{server,components,types,utils,config}/
├── supabase/                ← saas-pro DB (migrations + seed)
├── scripts/                 ← saas-pro ops + Stripe seeding
├── tests/                   ← saas-pro Playwright smoke tests
│
├── course/
│   ├── ARCHITECTURE.md      ← contactly ADRs (read before changing anything load-bearing)
│   └── contactly/           ← contactly app — see course/contactly/README.md
│       ├── src/, supabase/, scripts/, stripe/, tests/, docs/
│       └── package.json     ← own deps, own engines, own CI
│
├── docs/                    ← repo-level documentation
│   ├── README.md            ← documentation index (revision-dated)
│   └── architecture.md      ← saas-pro architecture, current state
│
├── AGENTS.md                ← canonical AI-agent rules (Cursor / Claude / Junie / Windsurf)
├── CLAUDE.md                ← pointer to AGENTS.md (legacy filename for Claude Code)
├── .agents/skills/          ← Stripe agent skills (sourced once, symlinked from .claude/.junie/.windsurf)
│
├── .github/workflows/
│   ├── deploy.yml           ← saas-pro CI + production deploy (Vercel + Supabase)
│   ├── contactly-ci.yml     ← contactly lint / typecheck / unit / cassette validation
│   └── actionlint.yml       ← static analysis for every workflow YAML
│
├── package.json             ← saas-pro app scripts
├── pnpm-workspace.yaml      ← pnpm workspace declaration (lists course/contactly)
└── pnpm-lock.yaml           ← THE lockfile (root-level, single source of truth)
```

> **Heads up.** Some sub-trees that look duplicated (e.g. both apps have
> `src/`, `supabase/`, `vite.config.ts`) are intentional — they belong to
> different applications. The `course/contactly/` subtree is a **standalone
> SvelteKit project** that you can copy out of this repo and run on its own.

---

## Stack — both apps

| Layer           | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Framework       | SvelteKit 2 + Svelte 5 (runes)                               |
| Build           | Vite 8 (Rolldown bundler) + `@sveltejs/vite-plugin-svelte`   |
| Language        | TypeScript (strict; `noUncheckedIndexedAccess` on contactly) |
| Styling         | Tailwind CSS 4 (`@tailwindcss/vite`, typography + forms)     |
| Auth & DB       | Supabase (Postgres, RLS, Auth) — `@supabase/ssr` SSR client  |
| Payments        | Stripe 22 (Checkout, Billing Portal, Webhooks)               |
| Validation      | Zod 4 (forms + env loaders)                                  |
| Forms           | sveltekit-superforms 2 _(contactly)_                         |
| Testing — unit  | Vitest 4 (browser project for components)                    |
| Testing — e2e   | Playwright                                                   |
| Observability   | Sentry _(contactly)_, `pino` structured logs                 |
| Deploy target   | Vercel (`@sveltejs/adapter-vercel`, `nodejs22.x`, `iad1`)    |
| Package manager | pnpm 10 (workspaces)                                         |

Engines are pinned in `course/contactly/package.json` (`node>=20`,
`pnpm>=10`); the same minimums apply to the root app.

---

## Getting started

### Prerequisites

- Node.js 20+ (22 recommended — matches the production runtime)
- pnpm 10+
- Docker Desktop / OrbStack / Colima (for the local Supabase stack)

### One-time setup

```bash
git clone <repo-url> saas-pro && cd saas-pro
pnpm install                       # installs both apps in one pass
cp .env.example .env               # saas-pro env (course platform)
cp course/contactly/.env.example course/contactly/.env  # contactly env
```

### Run the saas-pro course platform

```bash
pnpm run db:start                  # Supabase: ports 54321–54329
pnpm run dev                       # http://localhost:5173
```

### Run contactly (the app students build)

```bash
cd course/contactly
pnpm run db:start                  # Supabase: ports 64321–64329 (non-conflicting)
pnpm run dev                       # http://localhost:5173 (run separately from above)
```

> The two Supabase stacks intentionally use different port ranges so you
> can run both side by side.

---

## Course progression — git tags

Every lesson lands as a tag of the form `course/lesson-MM-LL-slug`, and
every completed module also gets `course/module-MM-complete`. To jump to
the exact state of the contactly app at the end of any lesson:

```bash
git checkout course/lesson-12-04-cassette-scenarios
cd course/contactly && pnpm install && pnpm run dev
```

The full curriculum (lesson sequence, slugs, preview status) is the
**markdown in `src/content/`**, mirrored in code by
`src/lib/config/curriculum.config.ts`. The folder structure under
`src/content/` _is_ the canonical lesson order.

---

## CI / CD

Three workflows guard `main`:

| Workflow           | Triggered when                           | Gates                                                               |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| `actionlint.yml`   | Any change under `.github/workflows/**`  | Static analysis (actionlint + ShellCheck) on every workflow YAML    |
| `contactly-ci.yml` | Any change under `course/contactly/**`   | Prettier + ESLint + svelte-check + Vitest + cassette validation     |
| `deploy.yml`       | Push to `main` (and `workflow_dispatch`) | Lint + typecheck + tests, then Supabase migrate, then Vercel deploy |

`deploy.yml` runs **two preflight checks** _before_ `pnpm install` to
fail fast on broken secrets:

1. All required GitHub Actions secrets present (`VERCEL_TOKEN`,
   `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`).
2. `VERCEL_TOKEN` actually authenticates against the Vercel API.

Both failure modes link directly to
[`course/contactly/docs/deploy/06-secret-rotation.md`](./course/contactly/docs/deploy/06-secret-rotation.md).
The Vercel CLI version is pinned (`vercel@51`) so deploys are reproducible.

---

## Documentation map

| Topic                                            | Location                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Repo architecture (this README's deeper sibling) | [`docs/architecture.md`](./docs/architecture.md)                                                               |
| Documentation index (with revision dates)        | [`docs/README.md`](./docs/README.md)                                                                           |
| Contactly architectural decisions                | [`course/ARCHITECTURE.md`](./course/ARCHITECTURE.md)                                                           |
| Contactly app guide                              | [`course/contactly/README.md`](./course/contactly/README.md)                                                   |
| Per-module docs (contactly)                      | [`course/contactly/docs/README.md`](./course/contactly/docs/README.md)                                         |
| Lesson markdown (course platform)                | [`src/content/`](./src/content/)                                                                               |
| AI agent rules                                   | [`AGENTS.md`](./AGENTS.md)                                                                                     |
| Secret rotation runbook                          | [`course/contactly/docs/deploy/06-secret-rotation.md`](./course/contactly/docs/deploy/06-secret-rotation.md)   |
| On-call runbook                                  | [`course/contactly/docs/deploy/05-runbook-and-wrap.md`](./course/contactly/docs/deploy/05-runbook-and-wrap.md) |

---

## Common scripts

Unless noted, run from the repo root.

| Script                 | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `pnpm install`         | Install both apps' deps (workspace install)               |
| `pnpm run dev`         | Dev server for the saas-pro course platform               |
| `pnpm run check`       | `svelte-check` (saas-pro)                                 |
| `pnpm run lint`        | Prettier + ESLint (saas-pro)                              |
| `pnpm run test:unit`   | Vitest (saas-pro)                                         |
| `pnpm run test:e2e`    | Playwright smoke tests (saas-pro)                         |
| `pnpm run db:start`    | Boot saas-pro Supabase stack (ports 54321+)               |
| `pnpm run db:reset`    | Drop and re-apply every saas-pro migration + seed         |
| `pnpm run seed:stripe` | Seed Stripe test fixtures for the course-platform pricing |

For contactly's own scripts, see
[`course/contactly/README.md`](./course/contactly/README.md#scripts).

---

## Repository conventions

- **Lockfile is at the root.** Always. Both `package.json`s resolve through it.
- **No floating versions in CI.** `vercel@51`, `actionlint@1.7.12`,
  `pnpm@10` are pinned in workflows; bump them with intent.
- **Generated artifacts are gitignored** (`node_modules`, `.svelte-kit`,
  `.vercel`, `.netlify`, `build`, `test-results`, `playwright-report`,
  Vite timestamp files). If you find one tracked, that's a bug — file a PR.
- **Secrets are never committed.** `.env*` is gitignored except
  `.env.example` and `.env.test`. CI rotates secrets via the runbook above.
- **Anti-patterns are caught at PR time** — `actionlint`, `prettier --check`,
  `eslint`, `svelte-check`, and the Svelte autofixer MCP all gate merges.

---

## License

UNLICENSED — private course material. Lesson markdown, source code, and
Stripe fixtures are not redistributable without written permission.
