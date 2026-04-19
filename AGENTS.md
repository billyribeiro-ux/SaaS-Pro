# Agent rules — SaaS-Pro

> Canonical instructions for any AI coding agent (Cursor, Claude Code,
> Junie, Windsurf, Codex, …) working in this repository.
>
> _Last revised: 2026-04-19_

If your tool reads a different filename (`CLAUDE.md`, `.junie/...`,
`.windsurf/...`, `.cursor/rules/...`), treat **this file as the source of
truth** and resolve any disagreement against it.

---

## 0. Read these first, in this order

1. [`README.md`](./README.md) — repo-level orientation.
2. [`docs/architecture.md`](./docs/architecture.md) — current state of the
   saas-pro course platform.
3. [`course/ARCHITECTURE.md`](./course/ARCHITECTURE.md) — load-bearing
   ADRs for the contactly app. **Do not deviate without adding an ADR.**
4. [`course/contactly/README.md`](./course/contactly/README.md) — the
   contactly app guide.

---

## 1. Repo layout in one sentence

A pnpm workspace with **two SvelteKit apps**: the saas-pro course
platform at the repo root, and the contactly app the course produces at
`course/contactly/`. Both share `pnpm-lock.yaml` at the root.

---

## 2. Tooling — what you must use

### Svelte / SvelteKit MCP

The `svelte` MCP server (`.mcp.json`) is **mandatory** when writing or
editing Svelte code. The available tools and their purpose:

| Tool                | When to use                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `list-sections`     | First call in any Svelte/SvelteKit task — discovers all docs sections + use cases.        |
| `get-documentation` | After `list-sections`, fetch every section relevant to the user's task before coding.     |
| `svelte-autofixer`  | Run on every Svelte file you produce. Loop until it returns no issues / no suggestions.   |
| `playground-link`   | Only after the user confirms they want a playground link **and** code is not yet on disk. |

Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) are the
default. Snippets (`{#snippet}`/`{@render}`) replace slots. Universal
loads use `$app/paths` `resolve()` for type-safe URLs.

### Stripe skills

`.agents/skills/` (symlinked from `.claude/skills/`, `.junie/skills/`,
`.windsurf/skills/`) ships three Stripe skills you must consult before
touching any Stripe surface:

- `stripe-best-practices/` — API selection, Checkout vs PaymentIntents,
  Connect, subscriptions, security, webhook hardening.
- `stripe-projects/` — provisioning the Stripe Projects CLI.
- `upgrade-stripe/` — upgrading API versions and SDKs.

Skills are versioned in [`skills-lock.json`](./skills-lock.json) — do not
edit skill contents in place; refresh through the lock file.

### Package manager

`pnpm` only. **Never** call `npm` or `yarn`. `pnpm install` _at the repo
root_ resolves both apps; do not `cd course/contactly && pnpm install`
unless you explicitly intend to break workspace deduplication.

### Vercel CLI

Pinned to `vercel@51` in `.github/workflows/deploy.yml`. Bump intentionally,
in its own commit, never as a side effect.

---

## 3. Code-quality gates you must pass

Before declaring a task done, run — **from the relevant app's directory** —
the gates that touch the files you changed:

```bash
pnpm run check     # svelte-check (TS + Svelte template types)
pnpm run lint      # prettier --check && eslint
pnpm exec vitest run
pnpm run test:e2e  # only when UI/route surfaces changed
```

CI gates (`.github/workflows/`) re-run the same checks on every PR. A
green local run is necessary but not sufficient — wait for CI before
declaring "done" in the user's eyes.

---

## 4. Conventions you must follow

### Architecture & decisions

- **ADRs are append-only** (`course/ARCHITECTURE.md`). Never delete or
  silently rewrite an existing decision. New decision → new ADR; supersede
  the old one with a `Superseded by ADR-XXX` line.
- **Multi-tenancy is by organization** (ADR-001). Every user-content row
  carries `organization_id`; every RLS policy keys off org membership.
- **Subscriptions belong to the user** (ADR-002), not the organization.
- **Stripe price references go through `lookup-keys.ts`** (ADR-007).
  Hard-coded `price_xxx` IDs are a code-review block.

### TypeScript

- `strict: true` everywhere. `noUncheckedIndexedAccess: true` in contactly.
- Validate every user-facing input with Zod. Validate env at boot
  (`src/lib/env.public.ts`, `src/lib/server/env.ts`) — bad env should
  fail at startup, not at the first request.

### Svelte / SvelteKit

- Runes only — no legacy reactive `$:` in new code.
- Server load functions return typed data; no client-side fetches for data
  that exists at request time.
- Forms use `sveltekit-superforms` + Zod with the same schema on client
  and server. Server actions are the only mutation surface; client `fetch`
  for mutations is forbidden in app routes.
- Auth check uses `safeGetSession` (JWT-validated). Never trust raw cookies.

### Database

- Migrations are immutable once merged to `main`. Schema changes are new
  numbered migration files (`YYYYMMDDHHMMSS_description.sql`).
- Every new table has RLS enabled and at least one policy in the same
  migration. Tables without RLS fail review.

### Stripe

- Webhooks use `constructEventAsync` for Edge compatibility.
- The `stripe_events` table is the **idempotency layer** — every handler
  short-circuits on duplicate event IDs.
- All Checkout Sessions and Subscriptions set
  `automatic_tax: { enabled: true }` (ADR-006).
- Lookup keys, never live price IDs (ADR-007).

### Logging & observability

- Server: `pino` to stdout, with a per-request correlation id.
- Errors that escape user handlers must hit Sentry; `console.error` in
  server code is a smell — wrap or replace it.
- Audit-worthy events (admin actions, billing state changes) write a row
  in the audit log table (ADR-004).

### Comments

- No narration comments (`// import the module`, `// loop`, etc.). Comments
  exist only to explain non-obvious intent, trade-offs, or constraints.

---

## 5. Git workflow

- Commit lesson-by-lesson; tag at the end of every lesson
  (`course/lesson-MM-LL-slug`) and module (`course/module-MM-complete`).
- Use Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, `chore:`,
  `build:`, `ci:`, `refactor:`, `test:`, `perf:`).
- Never `git push --force` to `main`. Never edit git config. Never bypass
  hooks (`--no-verify`) without explicit user approval.
- Pre-existing tags are immutable.

---

## 6. Anti-patterns the agent must scan for and refuse

- Using `any` to escape a real type problem.
- Hard-coded Stripe price IDs anywhere outside `LOOKUP_KEYS`.
- New tables without RLS.
- Reading the Supabase service-role key in client code.
- Server data flowing through client `fetch` instead of `load` / form
  actions.
- Workflow YAML changes that bypass `actionlint` or use unquoted
  variables in `run:` blocks (SC2086).
- `vercel@latest` or any other floating CLI version in CI.
- Editing migration files that have shipped to `main`.
- New components without a corresponding `*.test.ts` for non-trivial logic.

---

## 7. When in doubt

Ask. The user prefers a clarifying question over a wrong assumption that
costs a revert. If the question is small (single sentence), inline it in
your reply; if it has multiple branches, present a short structured list.

---

_Tool-specific entry points (`CLAUDE.md`, `.junie/skills/`,
`.windsurf/skills/`, `.cursor/rules/`) all defer to this file._
