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
pnpm install
pnpm run dev
```

Then open <http://localhost:5173>.

## Scripts

| Script               | What it does                                                |
| -------------------- | ----------------------------------------------------------- |
| `pnpm run dev`       | Vite dev server with HMR                                    |
| `pnpm run build`     | Production build                                            |
| `pnpm run preview`   | Serves the production build locally                         |
| `pnpm run check`     | `svelte-check` — TypeScript + Svelte template type checking |
| `pnpm run lint`      | Prettier (check) + ESLint                                   |
| `pnpm run format`    | Prettier (write)                                            |
| `pnpm run test:unit` | Vitest unit tests                                           |
| `pnpm run test:e2e`  | Playwright end-to-end tests                                 |
| `pnpm run test`      | Both unit and e2e                                           |

## Lesson 1.1 — SvelteKit Project Setup

This is what lands at the end of Lesson 1.1:

- A SvelteKit 2 project with TypeScript in **strict** mode.
- Tailwind v4 wired through the Vite plugin (no `tailwind.config.*` file).
- ESLint + Prettier configured to lint and auto-format Svelte and TS.
- Vitest set up for unit tests.
- Playwright set up for end-to-end tests, with one passing smoke test
  (`tests/welcome.spec.ts`) that loads the homepage and checks the heading.
- A welcoming homepage that previews what the rest of the course will build.

## Course progression

Each lesson is a tag of the form `course/lesson-MM-LL-slug`. To jump to the
exact state at the end of a given lesson:

```bash
git checkout course/lesson-04-03-creating-contacts
cd course/contactly
pnpm install
```
