---
title: "8.2 - Seeding Stripe Data"
module: 8
lesson: 2
moduleSlug: "module-08-pricing-page"
lessonSlug: "02-seeding-stripe-data"
description: "Write a script to programmatically create Stripe test data so setup is reproducible."
duration: 10
preview: false
---

## Overview

Lesson 8.1 walked you through the Stripe dashboard to create one product and three prices. That worked, but it lives entirely in click-memory. If a teammate joins the project, or you create a new test account, or you need to blow away your Stripe test data and restart, every one of those clicks has to happen again.

This lesson turns that whole click sequence into a TypeScript script, `scripts/seed-stripe.ts`. Run it once with `pnpm exec tsx scripts/seed-stripe.ts`, and your Stripe account ends up with the Contactly Pro product and all three prices, lookup keys set, ready to go. Commit the script, and your whole team shares the same source of truth for "what exists in Stripe".

This is the same mental shift you made in Module 1 when you stopped editing tables via Supabase Studio and started writing migration files. Infrastructure expressed as code is reviewable, reproducible, and replayable. Click-ops is none of those.

## Prerequisites

- Lesson 8.1 done — you understand what Products, Prices, and lookup keys are even if you didn't click through the dashboard (some readers will have deleted their test products to verify the script creates them from scratch; that's fine).
- `STRIPE_SECRET_KEY=sk_test_...` available in your `.env`.
- `stripe` v22 installed: `pnpm add stripe`.
- `tsx` available as a dev dependency (it ships with most SvelteKit `sv create` templates; if not, `pnpm add -D tsx`).
- `src/lib/config/pricing.config.ts` exists, or you're about to create it in the next lesson — the script imports `PRICING_LOOKUP_KEYS` from there. If you haven't built that file yet, skim lesson 8.3, then come back.

## What You'll Build

- A `scripts/` directory (if you don't have one already) — the conventional home for operational one-shots that aren't part of the app build.
- A single script, `scripts/seed-stripe.ts`, that creates `Contactly Pro` and its three prices using the Stripe Node SDK.
- A reusable command: `pnpm exec tsx scripts/seed-stripe.ts`.
- A mental model for why seed scripts belong in your repo and how they relate to database migrations, IaC, and test fixtures.

---

## Step 1: Why `scripts/` Is Not `src/`

Look at your SvelteKit project. `src/` holds everything that ends up bundled into your app: routes, components, server code. Vite watches it, TypeScript type-checks it, the adapter packages it for deployment.

A seed script is not part of the app. It runs once (or once per environment). It has no HTTP route. It doesn't ship to production servers. If we put it in `src/`, we'd risk the bundler picking it up, or someone importing it from a real route, or it showing up in a code-split chunk.

The convention across the Node ecosystem is a sibling directory at the repo root:

```
contactly/
├── scripts/               ← operational tools, one-shots, admin
│   └── seed-stripe.ts
├── src/                   ← the app
│   ├── lib/
│   └── routes/
├── supabase/
├── package.json
└── tsconfig.json
```

`scripts/` contains things like: data seeders (this lesson), one-off migrations that are too weird for the migrations folder, admin utilities, local diagnostics. Keep them small, imperative, and commit-reviewable.

Create the directory:

```bash
mkdir -p scripts
```

---

## Step 2: Why `tsx` and Not `ts-node`?

We'll run the script with `tsx`, a TypeScript executor built on esbuild. It's fast, it speaks ESM natively, and it works with the same `tsconfig.json` your app uses.

You might have seen older projects use `ts-node`. `ts-node` predates esbuild/swc, uses the slow official TypeScript compiler for every execution, and has a thorny relationship with ESM. On a modern stack (Node 20+, ESM, SvelteKit v2, Vite), `tsx` is the right tool. It's zero-config for 99% of cases.

Install if you don't have it:

```bash
pnpm add -D tsx
```

Then you run any `.ts` file with:

```bash
pnpm exec tsx path/to/file.ts
```

`pnpm exec` runs a locally-installed binary the same way `npx` does for npm. No global install needed.

---

## Step 3: Environment Variables in a Script Context

Before we write the script, a quick note on environment variables, because scripts behave differently from your SvelteKit app.

Your SvelteKit code imports secrets via `$env/static/private` (e.g. `import { STRIPE_SECRET_KEY } from '$env/static/private'`). That works because Vite is the one reading `.env` and injecting values at build time. It only works *inside* modules that Vite compiles — i.e. inside `src/`.

A plain Node script run via `tsx` doesn't go through Vite. It's a raw Node process. Vite's `$env` magic isn't there, so `process.env.STRIPE_SECRET_KEY` is what we use.

But Node doesn't read `.env` by itself either. You have two options:

1. **`dotenv`**: `import 'dotenv/config'` at the top of the script. Loads `.env` into `process.env`.
2. **Run with the CLI flag**: `pnpm exec tsx --env-file=.env scripts/seed-stripe.ts`. Node 20.6+ supports `--env-file` natively.

We'll use the CLI flag approach for the initial run because it's zero-dependency. If you prefer the `dotenv` version (a lot of teams standardize on it for consistency across tooling), add `import 'dotenv/config'` as the very first line of the script.

> [!NOTE]
> **Two different env systems on one project.** Your *app* uses `$env/static/private` (Vite-powered, build-time). Your *scripts* use `process.env` directly (Node-native, run-time). Both read the same `.env` file, they just do it through different pipelines. That's a feature, not a bug: app code gets type-safe auto-completion for env vars, while scripts get the loose, flexible Node API. Don't try to import `$env/static/private` in a script — the resolver isn't there and you'll get a cryptic error about "virtual modules".

---

## Step 4: The Seed Script

Create `scripts/seed-stripe.ts`:

```typescript
// scripts/seed-stripe.ts
import Stripe from 'stripe'
import { PRICING_LOOKUP_KEYS } from '../src/lib/config/pricing.config'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia'
})

async function seedStripe() {
  console.log('Seeding Stripe test data...')

  const product = await stripe.products.create({
    name: 'Contactly Pro',
    description: 'Full access to Contactly — unlimited contacts and all features'
  })

  await stripe.prices.create({
    product: product.id,
    unit_amount: 9700,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: PRICING_LOOKUP_KEYS.monthly,
    transfer_lookup_key: true
  })

  await stripe.prices.create({
    product: product.id,
    unit_amount: 99700,
    currency: 'usd',
    recurring: { interval: 'year' },
    lookup_key: PRICING_LOOKUP_KEYS.yearly,
    transfer_lookup_key: true
  })

  await stripe.prices.create({
    product: product.id,
    unit_amount: 499700,
    currency: 'usd',
    lookup_key: PRICING_LOOKUP_KEYS.lifetime,
    transfer_lookup_key: true
  })

  console.log('✅ Stripe seeding complete')
}

seedStripe().catch(console.error)
```

Don't run it yet. Let's walk through it line by line, because every line is a decision.

### `import Stripe from 'stripe'`

The Stripe Node library ships a default export that is a class. We instantiate it once per process. The type `Stripe` also namespaces all the request/response types (`Stripe.Product`, `Stripe.Price`, etc.) — we won't use those here, but you'll see them when TypeScript helps you autocomplete.

### `import { PRICING_LOOKUP_KEYS } from '../src/lib/config/pricing.config'`

We import from the app's own config file. This is the critical choice: the *same constant* that the pricing page uses to look prices up is the one this script uses to create them. There is no way for the two sides to disagree on the lookup keys — they're literally the same symbol. Change `contactly_monthly` to `contactly_pro_monthly` in the config, and both the script and the page change in lockstep.

Without this shared import, you'd write `contactly_monthly` twice (once here, once in the config) and one day one of them would drift.

Note the path: `../src/lib/config/pricing.config`. We can't use the `$lib` alias here because that's a SvelteKit-specific resolver provided by Vite. Node's own resolver just sees directories. Relative paths work.

### `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })`

- `process.env.STRIPE_SECRET_KEY!` — the non-null assertion (`!`) tells TypeScript "trust me, this is defined". If it's not, the Stripe constructor will throw. We could add `if (!process.env.STRIPE_SECRET_KEY) throw ...`; for a script that's opinionated about failing fast, the trailing `!` is fine.
- `apiVersion: '2026-03-25.dahlia'` — **pin your Stripe API version**. Without this, Stripe uses your account's default API version, which can drift silently when Stripe ships new API revisions. Pinning means your code's response-shape expectations and Stripe's behaviour match, forever, until you explicitly upgrade. Contactly uses `2026-03-25.dahlia` throughout the course — keep them in lockstep everywhere (`src/lib/server/stripe.ts`, every webhook handler, every script).

### `await stripe.products.create({ ... })`

Creates a Product. Returns the full Product object. We capture `product.id` to attach prices below. There's no `upsert` on Stripe Products — if you re-run this script, you'll get a second Contactly Pro. Read on for how we handle that (we don't, in this minimal version — and that's a deliberate pedagogical decision discussed in Step 5).

### `await stripe.prices.create({ ... })`

Three near-identical calls. Each Price:

- `product: product.id` — the parent Product we just created.
- `unit_amount: 9700` — **Stripe API uses the smallest currency unit** (cents for USD). `9700` cents is `$97.00`. `99700` is `$997.00`. `499700` is `$4,997.00`. Getting this wrong by a factor of 100 is the single most common Stripe bug; keep a sanity-check comment nearby if your team is new to the API.
- `currency: 'usd'` — ISO 4217 code. Lowercase in Stripe's API.
- `recurring: { interval: 'month' }` (or `'year'`) — for subscription prices. **Omit** `recurring` entirely for one-time prices. Notice the Lifetime price has no `recurring` key.
- `lookup_key: PRICING_LOOKUP_KEYS.monthly` — the stable alias we covered in 8.1.
- `transfer_lookup_key: true` — explained below.

### `transfer_lookup_key: true`

Lookup keys are unique across a Stripe account. If a Price with the same lookup key already exists, the API normally returns an error. Passing `transfer_lookup_key: true` tells Stripe: "If another Price has this lookup key, take it from them and give it to me."

This is exactly what we want for a seed/update workflow: if you run the script, then later need to change the monthly price from $97 to $99, you'd archive the old $97 Price and create a new $99 Price with the same lookup key. The transfer flag re-points `contactly_monthly` at the new Price. Your application code, which queries by lookup key, immediately starts getting $99.

It's also what makes the script *somewhat* safe to re-run: the lookup keys don't collide with the previous run's prices, so subsequent price creations succeed. We cover the re-run story honestly in Step 5.

### `seedStripe().catch(console.error)`

Fire the async function and print any unhandled rejection. For a one-shot script, this is enough. In production automation we'd want `process.exit(1)` on error so CI reports a failure, but a dev script running locally is allowed to be quiet.

---

## Step 5: Run the Script

From the repo root:

```bash
pnpm exec tsx --env-file=.env scripts/seed-stripe.ts
```

(Or, if you prefer, add `import 'dotenv/config'` at the top of the file and omit the `--env-file` flag.)

You should see:

```
Seeding Stripe test data...
✅ Stripe seeding complete
```

Hop into the Stripe dashboard (test mode). Product catalog → Contactly Pro. You'll see the three prices. Lookup keys set. Same outcome as lesson 8.1, but reproducible.

### What happens if I run it twice?

Run it again. The script will succeed — Stripe will happily create a *second* Contactly Pro product. Your dashboard will now have two of them. The three prices from the second run will attach to the second product, and the `transfer_lookup_key: true` flag will move the lookup keys from the first run's prices to the second run's prices.

Your first product is now orphaned — it exists in Stripe, has prices, has no lookup keys, and nothing refers to it. You can archive it via the dashboard, but you can also ignore it. Test mode accumulates cruft; that's fine.

> [!NOTE]
> **Why we're not making the script "truly idempotent".** A fully idempotent version would: list existing products by name, reuse them if found; list existing prices by lookup key, reuse them if found; only create missing entities. That's about 60 more lines of code and a meaningful chunk of lesson time. For a course focused on shipping a pricing page, the tradeoff isn't worth it — the `transfer_lookup_key: true` flag already gets us 80% of the safety (re-runs don't break the pricing page because lookup keys always point at the newest valid price). In a real production onboarding script you'd write the full version; see Principal Engineer Note 3 for a sketch. For now, treat re-runs as "safe but messy" and periodically clean up archived products via the dashboard.

---

## Step 6: Add a package.json Script

Running the long command every time is tedious. Add it to `package.json`:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "seed:stripe": "tsx --env-file=.env scripts/seed-stripe.ts"
  }
}
```

Now from anywhere in the project:

```bash
pnpm seed:stripe
```

Short, discoverable, and documented by its existence in `package.json`. Every script you write gets an entry here — that's your team's command surface.

---

## Common Mistakes

### Mistake 1: Running before `pricing.config.ts` exists

The script imports `PRICING_LOOKUP_KEYS` from `src/lib/config/pricing.config.ts`. If you jumped here from 8.1 without doing 8.3 first, that file doesn't exist. `tsx` errors with `Cannot find module`.

**Fix:** do lesson 8.3 (or at minimum, stub out the config file with just `export const PRICING_LOOKUP_KEYS = { ... }`) before running the script.

### Mistake 2: Using dollars instead of cents

`unit_amount: 97` feels right but produces a $0.97 price. Stripe's API uses cents (or the smallest unit of the given currency). $97 is 9700.

**Fix:** always multiply the dollar amount by 100 before passing to Stripe. For repeated usage, consider a helper: `const dollars = (n: number) => n * 100`.

### Mistake 3: Forgetting to pin `apiVersion`

Omit the `apiVersion` option and Stripe uses your account's default. Two months later Stripe rolls out a new API version, your account's default auto-updates, and a field you depended on is renamed. Debugging this is miserable.

**Fix:** always pin `apiVersion`. In Contactly: `'2026-03-25.dahlia'`. Upgrade deliberately, with a migration plan, not accidentally.

### Mistake 4: Hardcoding the lookup keys in the script

```typescript
lookup_key: 'contactly_monthly' // DON'T DO THIS
```

That's the same string our app config has, but now it's in two places. Rename one and you've silently broken the integration.

**Fix:** always `import { PRICING_LOOKUP_KEYS } from '../src/lib/config/pricing.config'`. One source of truth.

### Mistake 5: Setting `recurring` on the Lifetime price

Copy-paste error: you duplicate the yearly price block, change the amount and lookup key, and forget to remove `recurring: { interval: 'year' }`. Now the Lifetime price is a $4997/year subscription.

**Fix:** omit the `recurring` field entirely for one-time prices. Review the script carefully before running it the first time.

### Mistake 6: Checking in a `.env.local` with real secrets

Scripts encourage a "just paste the key for a second" mentality. Never paste a live Stripe secret into a file that might get committed. Always use `.env` (which is `.gitignore`d by the SvelteKit starter) and verify with `git status` before every commit.

---

## Principal Engineer Notes

### 1. Seed scripts are infrastructure-as-code

The big idea of this lesson is small: a script that recreates your Stripe state. But it unlocks a category of thinking: **every persistent, human-created artifact in your SaaS should be expressible as code.**

- Database schema? Migrations (Module 1).
- Stripe products? Seed script (this lesson).
- Deployment infra? Config files (Module 12).
- Secrets? `.env` + a password manager (Module 2/3).
- Customer data? Depends — some of it you don't want reproducible (compliance), some you do (dev fixtures).

The unifying question is: "If the artifact disappeared tomorrow, could I regenerate it with a command?" For every "no", figure out if the cost of making it a "yes" is worth paying. For seed data in a new SaaS: almost always yes, because onboarding new environments and new teammates happens constantly in the first year.

### 2. `tsx` vs `ts-node` vs Bun vs Node 22's `--experimental-strip-types`

We used `tsx` because it's the most widely-adopted, stable, non-experimental TypeScript runner as of 2026. There are alternatives:

- **`ts-node`**: legacy, slow, ESM-hostile. Skip.
- **`bun`**: Bun runs TypeScript natively. If your team is all-in on Bun, that's a great choice. If not, forcing contributors to install Bun just for scripts adds friction.
- **Node 22's `--experimental-strip-types`**: Node is increasingly able to run TypeScript directly. By the time you're reading this in late 2026, the flag might be non-experimental. If it is, you can drop `tsx` entirely. Until then, `tsx` is the least-surprise default.

When evaluating tooling like this, ask: "What does this tool cost in friction, dependencies, and team-alignment overhead, versus its alternative?" `tsx` costs ~3MB of `node_modules` and zero config. It wins easily.

### 3. A sketch of a fully idempotent version

For real production onboarding, you'd write something like:

```typescript
async function findOrCreateProduct(name: string, description: string) {
  const existing = await stripe.products.search({
    query: `name:"${name}" AND active:"true"`,
    limit: 1
  })
  if (existing.data.length > 0) return existing.data[0]
  return stripe.products.create({ name, description })
}

async function findOrCreatePrice(opts: {
  product: string
  unit_amount: number
  currency: string
  recurring?: Stripe.PriceCreateParams.Recurring
  lookup_key: string
}) {
  const existing = await stripe.prices.list({
    lookup_keys: [opts.lookup_key],
    active: true,
    limit: 1
  })
  if (existing.data.length > 0) {
    const p = existing.data[0]
    if (p.unit_amount === opts.unit_amount) return p
    // amount changed → archive old, create new, transfer key
    await stripe.prices.update(p.id, { active: false })
  }
  return stripe.prices.create({ ...opts, transfer_lookup_key: true })
}
```

It's not rocket science — it's 30 extra lines for full idempotency. Worth it for a production seed script; overkill for a course lesson.

### 4. Env-var loading strategies: know the full matrix

| Context                               | How env is loaded            | Who reads `.env`? |
|---------------------------------------|------------------------------|--------------------|
| `vite dev` / `vite build` (SvelteKit) | `$env/static/*`, `$env/dynamic/*` | Vite            |
| `tsx` with `--env-file=.env`          | `process.env.*`              | Node (native)     |
| `tsx` with `import 'dotenv/config'`   | `process.env.*`              | `dotenv` package  |
| Node process in production            | `process.env.*`              | Deployment platform (Vercel/Fly/etc.) |
| CI (GitHub Actions, etc.)             | `process.env.*`              | CI config (secrets as env) |

The lesson here isn't the detail; it's that **there's always *someone* reading `.env` — it's never magic, and knowing who reads it in each context is how you debug missing-variable errors in 30 seconds instead of 30 minutes.**

### 5. Why the script lives in the repo, not in a "devops" folder

Some teams put seed scripts in a separate repo or in a `devops/` directory tree kept far from app code. Don't. The script you just wrote is coupled to `pricing.config.ts` — they evolve together. Splitting them across repositories means every lookup-key rename is a cross-repo atomic commit problem. Co-locate.

The mental model: the application is a product, the seed script is a companion tool **for that product**, and both belong in the same repo for the same reason as unit tests belonging next to the code they test.

### 6. Seed scripts and webhook testing

In Module 9 you'll build the checkout flow and need to test webhooks locally with `stripe listen`. That flow requires a real Price in your test-mode Stripe account. The seed script gets you from zero to "testable webhook environment" in one command. Without it, every new contributor to your codebase spends 15 minutes clicking around the dashboard before they can run the integration tests. Pay the 10-minute upfront cost of the script, save all of that downstream friction.

---

## Summary

- Created `scripts/seed-stripe.ts`, a TypeScript seed script that recreates the Contactly Pro product and its three prices in Stripe.
- Used `pnpm exec tsx --env-file=.env scripts/seed-stripe.ts` to run it, with Node's native `.env` loading.
- Imported `PRICING_LOOKUP_KEYS` from the app's own config so the script and the pricing page share a single source of truth for lookup keys.
- Pinned the Stripe API version to `2026-03-25.dahlia` — the same version used everywhere in Contactly.
- Learned the difference between Vite's `$env/*` virtual modules (app-side) and Node's `process.env` (script-side), and why both read the same `.env` through different pipelines.
- Added a `seed:stripe` script to `package.json` so teammates can run `pnpm seed:stripe` without memorising the command.

## What's Next

Stripe is now seeded. But our app still has no `/pricing` route, and no config telling it how to render Monthly vs Yearly vs Lifetime cards. Lesson 8.3 builds `src/lib/config/pricing.config.ts`: the `PRICING_LOOKUP_KEYS` constant (which this script already imports), plus a `PRICING_TIERS` array describing each tier's display name, description, feature list, and whether it's highlighted. Config-driven tiers mean no Svelte-component-per-tier. One card component renders three tiers by iterating over the config. When marketing wants to add a fourth tier, it's a five-line config change, not a component refactor.
