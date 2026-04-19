---
title: "6.1 - Setup Stripe Node Client"
module: 6
lesson: 1
moduleSlug: "module-06-stripe-sveltekit"
lessonSlug: "01-setup-stripe-node-client"
description: "Install the Stripe Node.js SDK and create a typed server-side client."
duration: 10
preview: false
---

## Overview

This is the first lesson of the billing module. By the end of it, Contactly will know how to speak Stripe. That "knowing how to speak" is a single, tiny file — `src/lib/server/stripe.ts` — that exports one object: a fully typed, strictly server-side `stripe` client.

Ten minutes, six lines of code, and a disproportionate amount of under-the-hood detail. The file we write here will be imported by every checkout route, every webhook handler, every subscription update, every customer portal redirect in the next four modules. Getting this foundation right (TypeScript types, environment variable discipline, API version pinning, server-only placement) makes every lesson that follows **trivially safe**. Getting it wrong leaks secrets, breaks TypeScript inference, or ships billing code against an API version you haven't tested against.

So we're going to do six lines of code, and explain the decision behind every single one.

## Prerequisites

- Modules 1–5 complete — Contactly has a working dashboard, authenticated users, and a CRUD flow for contacts.
- A Stripe account (free). Sign up at [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register) if you don't have one.
- Your Stripe test-mode **Secret key** copied from the [API keys page](https://dashboard.stripe.com/test/apikeys) — it starts with `sk_test_`.

## What You'll Build

- Install the Stripe Node.js SDK (v22) with pnpm.
- Add `STRIPE_SECRET_KEY` to your local `.env` file.
- Create `src/lib/server/stripe.ts` — the single, canonical place in the codebase where the Stripe client is constructed.
- Verify the `$lib/server/` guarantee: the file cannot accidentally be imported into client code.

---

## Step 1: Install the Stripe SDK

```bash
pnpm add stripe
```

This installs the [`stripe`](https://www.npmjs.com/package/stripe) package — the official Stripe Node.js SDK, written in TypeScript, maintained by Stripe themselves. The package bundles **everything** we need: the API client, the webhook signature verifier, and a deep `Stripe` namespace full of precise TypeScript types for every object Stripe has ever returned.

Check your `package.json` after install — you should see something like:

```json
"dependencies": {
  "stripe": "^22.0.0"
}
```

The `^22.0.0` means "any 22.x version." For billing code, you probably want to be stricter — remove the caret later to pin exactly (`"22.0.0"`). More on that in the Principal Engineer notes below.

### The v22 Breaking Change: `new Stripe(...)`, Not `Stripe(...)`

Before v22, you could construct the SDK two ways:

```typescript
// Old, deprecated (v21 and earlier)
const stripe = Stripe(STRIPE_SECRET_KEY, { apiVersion: '...' })

// Modern, required (v22+)
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '...' })
```

In v22, Stripe removed the factory-function form entirely. The only valid way to construct the client is with the `new` keyword. If you forget it, TypeScript gives you a clear error:

```
Value of type 'typeof Stripe' is not callable. Did you mean to include 'new'?
```

If you're following a Stripe tutorial written in 2023 or 2024 and it omits `new`, the code **will not compile** against our `stripe` v22. Always use `new Stripe(...)`.

---

## Step 2: Add the Secret Key to `.env`

Open `.env` at the root of your Contactly project and add:

```bash
# .env
STRIPE_SECRET_KEY=sk_test_51ABCxyz...YOUR_KEY_HERE
```

A few rules that apply to every secret you'll ever add to `.env`:

1. **No quotes.** `STRIPE_SECRET_KEY=sk_test_...` — not `STRIPE_SECRET_KEY="sk_test_..."`. SvelteKit parses dotenv files with a permissive parser; quotes become part of the value in some edge cases. Safer to skip them.
2. **No spaces around `=`.** `KEY=value`, never `KEY = value`. The equals sign has no surrounding whitespace.
3. **`.env` is in `.gitignore`.** Check `.gitignore` contains `.env` before you commit. Leaked Stripe keys on GitHub get picked up by scrapers within minutes and used to rack up fraudulent charges or exfiltrate customer data.
4. **Test keys only in development.** `sk_test_...` — never `sk_live_...`. The live key moves real money. Production deployments get the live key via their hosting provider's environment variable dashboard (Vercel, Fly, Railway, etc.), never in a committed file.

If you accidentally commit a key to git, **rotate it immediately** in the Stripe dashboard. The key in your git history is compromised forever; changing the file in a subsequent commit does **not** undo the leak.

---

## Step 3: Create the Server-Only Stripe Client

Create `src/lib/server/stripe.ts`:

```typescript
// src/lib/server/stripe.ts
import Stripe from 'stripe'
import { STRIPE_SECRET_KEY } from '$env/static/private'

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-25.dahlia'
})
```

Six lines, but every single one is a deliberate decision. Let's walk through them.

### Line 1: `import Stripe from 'stripe'`

This is the default import from the SDK. `Stripe` is **both a value and a namespace**:

- As a value: `Stripe` is the class. `new Stripe(...)` constructs a client.
- As a namespace: `Stripe.Checkout.Session`, `Stripe.Subscription`, `Stripe.Customer`, `Stripe.Invoice` are all types you can use for type-annotating function parameters and return values.

This is a TypeScript feature called "declaration merging" — a single identifier can carry both a runtime value (the constructor) and a compile-time type namespace. Once you've seen it, it'll pop up in other SDKs too. Ours will use it heavily:

```typescript
// Later in the course, you'll write things like:
async function upsertSubscription(sub: Stripe.Subscription) {
  // 'sub' now has full IntelliSense — Stripe.Subscription has ~50 typed fields
}
```

The `Stripe` import gives us both capabilities from a single line.

### Line 2: `import { STRIPE_SECRET_KEY } from '$env/static/private'`

This is SvelteKit's **static, private, server-only** environment import path. Four words matter:

1. **Static** — the variable is resolved at build time, not runtime. Vite inlines the value into the server bundle. Faster than `process.env.STRIPE_SECRET_KEY`, and TypeScript knows the exact type.
2. **Private** — the variable is **never** shipped to the client. If you try to import `STRIPE_SECRET_KEY` from a `.svelte` file or a `+page.ts` (which runs in the browser), SvelteKit throws a build error. You cannot accidentally leak it.
3. **Static vs. dynamic** — `$env/dynamic/private` exists too. Use dynamic for values that might change per-request (rare). Static is the default; we'll use it for 99% of secrets.
4. **Type-safe** — because the value is known at build time, TypeScript types `STRIPE_SECRET_KEY` as `string`. No `| undefined`, no `as string` cast, no null-checks.

Compare this to the Node-native alternative:

```typescript
// What Node would give you without SvelteKit:
const key = process.env.STRIPE_SECRET_KEY
// Type: string | undefined — you'd need to null-check every use
if (!key) throw new Error('STRIPE_SECRET_KEY missing')
```

SvelteKit's `$env/static/private` handles all of that at build time. If `STRIPE_SECRET_KEY` is missing from `.env`, the build fails loudly instead of crashing at runtime in production.

### Line 3: `export const stripe = new Stripe(`

We export a `const` — a single, shared client instance that every other module imports. This matters because:

- **Stripe's client is designed to be long-lived.** It holds internal state (user-agent, connection pool). Creating a new one per request is wasteful.
- **Constants are statically analyzable.** The bundler sees one export, traces one import tree, and tree-shakes safely.
- **Singleton-by-module.** Node's module caching guarantees `src/lib/server/stripe.ts` only evaluates once per process. Every `import { stripe } from '$server/stripe'` gets the same reference. No race conditions, no duplicate instances.

This pattern — "create one client at module scope, export it, import it everywhere" — is exactly what we did with `supabaseAdmin` in Module 1. It's the standard shape for any I/O client in a SvelteKit app.

### Line 4: `apiVersion: '2026-03-25.dahlia'`

This is the most important line in the file. Let's go slowly.

**What is an API version?** Stripe's REST API changes over time. They add fields, deprecate others, rename things, restructure resources. Every such change is bundled into a dated release. `'2026-03-25.dahlia'` is the release from March 25, 2026, codenamed "dahlia."

**Why pin it explicitly?** Because if you don't, Stripe uses whatever version your account's default is set to. That default can change (Stripe bumps it during account upgrades, testing, or when you click a button in the dashboard without realizing it). The consequence: your code behaves **differently in production than in development**, and you won't know until something breaks.

By specifying `apiVersion: '2026-03-25.dahlia'` in code, we guarantee:

1. Every call from this codebase, forever, goes against this exact API version — regardless of dashboard settings, account defaults, or Stripe's global rollouts.
2. The TypeScript types we get from the SDK match the API contract we're calling against. (The SDK version is paired with an API version — `stripe` v22 ships with types for `2026-03-25.dahlia`.)
3. When we eventually upgrade, it's a deliberate, tested, reviewable change: bump `stripe` to the next major version, change the date string, run tests.

Pinning the API version is the single best thing you can do to insulate Contactly from "it worked yesterday, broke today" billing bugs.

---

## Step 4: Verify the File Is Server-Only

SvelteKit has a strict rule: **anything inside `src/lib/server/` can only be imported from server code.** That includes:

- `+page.server.ts`, `+layout.server.ts`
- `+server.ts` (API routes)
- `hooks.server.ts`
- Other files in `$lib/server/`

It **cannot** be imported from:

- `.svelte` components (they run in the browser)
- `+page.ts`, `+layout.ts` (universal files — they can run in both places, so server-only imports are forbidden)
- `src/lib/` files outside the `server/` subdirectory

Try it. Open your root `+page.svelte` and add, purely as a test:

```svelte
<script lang="ts">
  import { stripe } from '$lib/server/stripe'  // This will fail to build
</script>
```

Save. Watch the dev server throw something like:

```
Cannot import $lib/server/stripe.ts into client-side code
```

That's the **blast-radius guarantee**. Even if a teammate makes a mistake, the build catches it before it ships. Rip the test import back out before moving on.

### Why this matters so much for Stripe

The `STRIPE_SECRET_KEY` in this file has **full control** over your Stripe account. With it, an attacker can:

- Create charges.
- Refund charges.
- List every customer, subscription, and invoice.
- Delete all your products.
- Read every credit card's last 4 digits and billing address.

If that key ever ships to the browser — even once, even in a source map — you've leaked it to every visitor. Rotate-the-key scrambles ensue; customer trust shrinks; your on-call engineer has a bad Tuesday.

`$lib/server/` makes the leak technically impossible. That's not a convenience — it's a security boundary.

### The `$server` alias

Throughout this course we use `$server` as a shorthand for `$lib/server`. If you set it up in Module 2's `svelte.config.js` (revisit that file to confirm), you can write:

```typescript
import { stripe } from '$server/stripe'
// instead of
import { stripe } from '$lib/server/stripe'
```

Both work. The `$server` form is shorter and reinforces intent ("this is server-only"). Every subsequent lesson will use `$server/stripe`.

---

## Step 5: Quick Sanity Check

You don't need a full feature to confirm the client works. Open a temporary `+server.ts` somewhere you can hit it — or just write a one-off script. A tiny test:

Create `src/routes/api/stripe-check/+server.ts`:

```typescript
// src/routes/api/stripe-check/+server.ts — temporary, delete after
import { json } from '@sveltejs/kit'
import { stripe } from '$server/stripe'

export const GET = async () => {
  // List up to 3 products; empty is fine.
  const products = await stripe.products.list({ limit: 3 })
  return json({ count: products.data.length })
}
```

Run `pnpm dev`, visit `http://localhost:5173/api/stripe-check`. You should see `{"count": 0}` (or however many products you have in test mode). A non-zero count means the request reached Stripe and returned successfully. A 500 means the key is wrong or `apiVersion` is invalid — check the terminal for the real error.

**Delete the file afterwards.** We'll build the real endpoints in lesson 6.3 and beyond.

---

## Common Mistakes

### Mistake 1: `const stripe = Stripe(...)` without `new`

Easy to copy from a pre-v22 tutorial. TypeScript will catch it:

```
Value of type 'typeof Stripe' is not callable. Did you mean to include 'new'?
```

Add `new`.

### Mistake 2: Importing from `'stripe'` as a named export

```typescript
import { Stripe } from 'stripe'  // Wrong
```

The SDK uses a **default** export. Always:

```typescript
import Stripe from 'stripe'  // Correct
```

### Mistake 3: Reading the key with `process.env`

```typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '...' })
```

This works, but you're bypassing SvelteKit's type safety. The non-null assertion (`!`) masks the real issue: you'd rather the build fail at compile time if the variable is missing. Use `$env/static/private`.

### Mistake 4: Placing the file outside `src/lib/server/`

```typescript
// src/lib/stripe.ts  ← WRONG
import Stripe from 'stripe'
export const stripe = new Stripe(...)
```

This file is not server-only. Any client code can now import `stripe`, which attempts to bundle `$env/static/private` into the browser — SvelteKit will error, but the boundary is fragile. Worse, an untrained eye might move `STRIPE_SECRET_KEY` to a public env var "to make it build" and cause a catastrophic leak.

Rule: **if a file imports a secret, it lives in `src/lib/server/`**. No exceptions.

### Mistake 5: Hardcoding the API version as an unreleased string

```typescript
apiVersion: '2030-12-31.pumpkin'  // Made-up version
```

At runtime, Stripe rejects API requests with an unknown version and returns a 400 error. Always use a version that's documented in the [Stripe API changelog](https://stripe.com/docs/upgrades). For the course we use `'2026-03-25.dahlia'`, which matches the SDK's built-in types.

### Mistake 6: Committing `.env` to git

Check your `.gitignore`. If `.env` isn't there, add it now — before your next commit. If you've already committed a key, rotate it in the Stripe dashboard (API keys → roll key) and purge it from git history with BFG or `git-filter-repo`. Don't hope no one noticed.

---

## Principal Engineer Notes

### 1. Why server-only placement is a security architecture decision

There are two kinds of secrets in a web app: **client-safe** (public API endpoints, Supabase anon key, Stripe publishable key — designed to be shipped to the browser) and **server-only** (database service role keys, Stripe secret keys, third-party OAuth client secrets). The second category has **zero** legitimate reason to exist on the client.

The physical location of a file in your codebase is your enforcement boundary. `src/lib/server/` is a moat. Don't climb over it — even for a clever reason. Every senior engineer I know has a story of the one time they did, and the log of the production incident that followed.

### 2. TypeScript strict mode + Stripe namespace = free correctness

Our `tsconfig.json` has `"strict": true`, which turns on every type-safety feature TypeScript offers. Combined with Stripe's exported types (`Stripe.Checkout.Session`, `Stripe.Subscription`, etc.), you get:

- Autocomplete on every field of every Stripe object.
- Compile errors when you access a field that doesn't exist on this API version.
- Exhaustive switch-case coverage when you switch on `event.type` (we'll use this in lesson 6.3).

In exchange you have to occasionally type-annotate function parameters — `(session: Stripe.Checkout.Session) => ...` — which is a fair trade. The result is a codebase where Stripe-related TypeScript errors mean real bugs, not noise.

### 3. SDK version pinning and `pnpm-lock.yaml` discipline

Once your billing code works against `stripe@22.x`, pin it exactly:

```json
"stripe": "22.0.0"
```

And commit `pnpm-lock.yaml` (it's already in your repo from scaffolding). The lockfile records exact transitive dependencies. If Stripe ever publishes a 22.0.1 patch that tweaks behavior, you won't accidentally adopt it during a `pnpm install` two weeks later. Your code stays on the exact version you tested against until you deliberately bump it.

Billing is not the place for "latest" dependency policies. It's the place for "tested, frozen, deliberately upgraded" policies.

### 4. Future-you will thank present-you for the `apiVersion` pin

Every year or so, Stripe releases a new API version with breaking changes — maybe a field is moved, maybe a resource splits into two. If you hadn't pinned, you'd discover this when a webhook stops parsing correctly and your app starts double-charging users.

Pinning gives you **leisure** to upgrade. You read the changelog, bump the SDK, run the test suite, flip the version string, deploy. No surprise breakage. No Saturday-night firefighting.

### 5. Why we don't wrap the Stripe client in a custom class

It's tempting to write `StripeService` with methods like `createCheckoutSession(userId, priceId)` that hide the raw SDK. Don't — at least not until you have a real reason to.

The Stripe SDK is already excellent: typed, documented, ergonomic. Wrapping it in your own class adds indirection without value. Every lesson in the next four modules uses `stripe.checkout.sessions.create(...)` directly, and the code is clear. If you later find yourself repeating the same three-line pattern in ten places, **then** extract a helper. Premature wrapping hides intent and makes stack traces worse.

This is the YAGNI (you ain't gonna need it) principle applied to billing abstractions.

### 6. One client, many contexts

The same `stripe` singleton will be called from:

- Form actions (user clicks "Upgrade" → `stripe.checkout.sessions.create`).
- Webhook handlers (Stripe POSTs to our endpoint → `stripe.webhooks.constructEvent`).
- Background syncs (cron job reconciles state → `stripe.subscriptions.list`).
- Admin scripts (one-off fix for customer X → `stripe.customers.update`).

Node's module-level singleton handles all of this correctly. Don't try to construct a per-request client "for isolation." The SDK is designed to be shared.

---

## Summary

- Installed the Stripe Node SDK at v22 with `pnpm add stripe`.
- Learned v22's breaking change: `new Stripe(...)` is mandatory; the factory-function form is gone.
- Added `STRIPE_SECRET_KEY` to `.env`, with a reminder that `.env` must stay gitignored.
- Created `src/lib/server/stripe.ts` — the one canonical place the client lives — with a pinned API version (`'2026-03-25.dahlia'`).
- Used `$env/static/private` for type-safe, build-time-validated, server-only secret access.
- Verified the `$lib/server/` boundary prevents the client from being bundled into browser code.
- Internalized why API version pinning is the single most important decision for billing longevity.

## What's Next

In lesson 6.2 we'll zoom out from "how to call Stripe" to "how Stripe calls us." You'll learn the webhook lifecycle, the six events Contactly cares about, and why signature verification — not just TLS — is what keeps your billing endpoint safe from forgery. After that, lesson 6.3 translates that understanding into the real webhook endpoint at `POST /api/webhooks/stripe`.
