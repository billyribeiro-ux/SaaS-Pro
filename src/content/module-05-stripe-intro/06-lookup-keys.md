---
title: '5.6 - Lookup Keys'
module: 5
lesson: 7
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '06-lookup-keys'
description: 'The most important Stripe concept in this course — lookup keys let you change prices without touching code.'
duration: 12
preview: false
---

## Overview

This is the single most important lesson in Module 5. If you skim every other lesson but internalize this one, you'll still build a billing integration worthy of a Principal Engineer. If you ace every other lesson but skip this one, you'll be bitten by the same bug every working day for the life of the product: **your code is coupled to a Stripe ID that isn't stable**.

The concept is simple: instead of referencing Stripe Prices by their generated ID (`price_1Nv7k8KZabc`), reference them by a **lookup key** — a stable, developer-chosen string (`contactly_monthly`) that you own and can move from one Price to another as your catalog evolves. Your code names _what it wants_ (the Contactly monthly plan); Stripe names _what that resolves to today_ (this specific Price object). When prices change, the code stays the same.

Lookup keys are the API boundary between your application and your billing infrastructure. Draw that boundary clearly now, in Module 5, and every later module is easier.

## Prerequisites

- Lesson 5.5 complete — you have a Contactly Pro Product with three Prices, each with a lookup key (`contactly_monthly`, `contactly_yearly`, `contactly_lifetime`).
- Comfortable with TypeScript `const` objects and `as const`.

## What You'll Build

- A deep understanding of the "hardcoded price ID" anti-pattern and what it costs.
- The config file at `src/lib/config/pricing.config.ts` that names the lookup keys our app will use.
- Fluency with **lookup key transfer** (`transfer_lookup_key: true`) for zero-downtime price migrations.
- Intuition for the general pattern — indirection via stable identifiers — which shows up in dozens of other systems.

---

## Step 1: The Problem — Hardcoded `price_xxx` IDs

Imagine, for a minute, you've never heard the term "lookup key." You've just created your three Prices in Stripe. You go back to your SvelteKit project and start building a checkout flow. Natural first move:

```typescript
// src/routes/api/checkout/+server.ts — ANTI-PATTERN, do not do this
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia'
});

const PRICE_IDS = {
	monthly: 'price_1Nv7k8KZmonthly', // from Stripe dashboard
	yearly: 'price_1Nv7k8KZyearly', // from Stripe dashboard
	lifetime: 'price_1Nv7k8KZlifetime' // from Stripe dashboard
};

export async function POST({ request }) {
	const { tier } = await request.json();
	const priceId = PRICE_IDS[tier];

	const session = await stripe.checkout.sessions.create({
		line_items: [{ price: priceId, quantity: 1 }],
		mode: tier === 'lifetime' ? 'payment' : 'subscription',
		success_url: 'https://contactly.com/success',
		cancel_url: 'https://contactly.com/cancel'
	});

	return new Response(JSON.stringify({ url: session.url }));
}
```

This "works." A developer can read it. Tests could pass. But the design is broken in three load-bearing ways.

### Problem 1: Prices can't change without a deploy

Marketing decides next Monday to change monthly from $97 to $87 — maybe a promotion, maybe a strategic repricing. In Stripe, the right move is:

1. Create a new Price at $87 (because `unit_amount` is immutable on existing Prices).
2. Deactivate the old $97 Price.

Now your code's `PRICE_IDS.monthly` still points at the archived $97 Price. New checkouts use the old Price, customers pay $97, the promotion doesn't land. You need to:

1. Manually copy the new `price_xxx` from the dashboard.
2. Open a pull request updating the constant.
3. Get it reviewed.
4. Merge.
5. Deploy.
6. Hope nothing goes wrong during the rollout window.

Hours or days, for a price change that should be a 30-second dashboard edit.

### Problem 2: Environments drift

Your test environment has `price_1TestMonthly`. Your production environment has `price_1LiveMonthly`. These are different IDs because they live in different Stripe accounts (test vs live). So now your hardcoded constant is environment-dependent, which usually leads to:

```typescript
const PRICE_IDS = import.meta.env.DEV
	? { monthly: 'price_1Test...' }
	: { monthly: 'price_1Live...' };
```

Or worse, environment-specific config files, CI secrets for IDs, a wiki page of "Stripe IDs by environment." Every new developer onboards by being given a list of IDs to copy.

### Problem 3: Pricing experiments are painful

Marketing wants to A/B test $97 vs $117. Option A: `PRICE_IDS.monthly_v1` and `PRICE_IDS.monthly_v2`, with branching in code. Now you've coupled pricing experiments to code deploys; you can't run a new test without shipping a PR. Option B: find some way to resolve the right price at request time. Which is essentially what lookup keys give you, just with more ceremony.

### The pattern behind all three problems

Each is a variant of: **your code is naming infrastructure details, not business concepts**. `price_1Nv7k8KZabc` is an _implementation detail_; "Contactly monthly plan" is a _business concept_. Your code should deal in business concepts and let infrastructure resolve them at runtime.

Every anti-pattern in software has this shape: exposing the layer below you instead of modeling your own layer. Fix this one habit and you'll improve 50% of your code quality automatically.

---

## Step 2: The Solution — Lookup Keys

Stripe anticipated this. Every Price has an optional `lookup_key` field — a string you choose, unique per account, that you use to retrieve the Price later. You already set these in Lesson 5.5:

| Price           | Lookup Key           |
| --------------- | -------------------- |
| $97/mo          | `contactly_monthly`  |
| $997/yr         | `contactly_yearly`   |
| $4,997 lifetime | `contactly_lifetime` |

Now the checkout code becomes:

```typescript
// src/routes/api/checkout/+server.ts — CORRECT pattern
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';
import { PRICING_LOOKUP_KEYS } from '$lib/config/pricing.config';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia'
});

export async function POST({ request }) {
	const { tier } = (await request.json()) as { tier: keyof typeof PRICING_LOOKUP_KEYS };
	const lookupKey = PRICING_LOOKUP_KEYS[tier];

	// Resolve the lookup key to the *currently active* Price at request time.
	const { data: prices } = await stripe.prices.list({
		lookup_keys: [lookupKey],
		active: true,
		limit: 1
	});

	const price = prices[0];
	if (!price) {
		return new Response(`Price not found for ${lookupKey}`, { status: 500 });
	}

	const session = await stripe.checkout.sessions.create({
		line_items: [{ price: price.id, quantity: 1 }],
		mode: price.type === 'recurring' ? 'subscription' : 'payment',
		success_url: 'https://contactly.com/success',
		cancel_url: 'https://contactly.com/cancel'
	});

	return new Response(JSON.stringify({ url: session.url }));
}
```

(We'll build this file in earnest in Module 6 — this is a sketch for illustration.)

### Line-by-line walkthrough

**`import { PRICING_LOOKUP_KEYS } from '$lib/config/pricing.config'`** — pulls the keys from a central config. No `price_xxx` in sight.

**`const lookupKey = PRICING_LOOKUP_KEYS[tier]`** — translates the tier name from the UI (monthly/yearly/lifetime) to the Stripe lookup key (`contactly_monthly` etc.). The mapping lives in one file.

**`stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })`** — asks Stripe: "give me the currently active Price whose lookup key is X." The key can only ever be on _one_ active Price at a time (Stripe enforces uniqueness), so the result is deterministic.

**`const price = prices[0]`** — get the resolved Price object. This contains the current `price.id`, the current `unit_amount`, the current `currency`, etc. All fresh, from Stripe, at request time.

**`price: price.id`** — pass the Price ID to the Checkout Session. Stripe doesn't know or care that the ID came from a lookup; it just needs a current Price.

**`mode: price.type === 'recurring' ? 'subscription' : 'payment'`** — polymorphic handling. The code asks the Price object what kind of thing it is, then dispatches. You don't have a `const MODES = { monthly: 'subscription', lifetime: 'payment' }` table that will rot.

### What this achieves

- **Price changes don't require deploys.** Marketing creates a new Price with `lookup_key: contactly_monthly`, passes `transfer_lookup_key: true` (we'll cover this), and the new Price becomes what `PRICING_LOOKUP_KEYS.monthly` resolves to. No code change needed.
- **Environments don't drift.** Both test and live accounts have a Price with lookup key `contactly_monthly`. Same lookup, different resolution, same code path. No `if (DEV) ...` branches.
- **A/B tests are trivial.** Want to test a $117 monthly? Create a new lookup key `contactly_monthly_b`, route some traffic to it. Both keys coexist; no code branches on `price_xxx` constants.

---

## Step 3: The Config File — `src/lib/config/pricing.config.ts`

Create the file (you'll fill in the full directory structure in Module 6; for now the path is the commitment):

```typescript
// src/lib/config/pricing.config.ts
export const PRICING_LOOKUP_KEYS = {
	monthly: 'contactly_monthly',
	yearly: 'contactly_yearly',
	lifetime: 'contactly_lifetime'
} as const;
```

Four lines. Let's unpack why each part is what it is.

### `src/lib/config/pricing.config.ts`

- **`src/lib/`** — SvelteKit convention for reusable code.
- **`config/`** — subfolder for static config. Other config files will go here (analytics, feature flags, mailer settings). Grouping keeps them discoverable.
- **`pricing.config.ts`** — the `.config.ts` suffix is a community convention for "this is config, treat it as data, don't put logic here."

### `export const PRICING_LOOKUP_KEYS`

Exported so we can import it anywhere. Named in SCREAMING_SNAKE_CASE to signal **immutable data** — a convention from C's `#define` constants, adopted broadly in JS/TS.

### The three entries

```typescript
monthly: 'contactly_monthly',
yearly: 'contactly_yearly',
lifetime: 'contactly_lifetime'
```

Left side is the **internal tier key** — what our app calls each tier. Right side is the **Stripe lookup key** — what Stripe calls it. The two layers have different naming conventions:

- Internal tier keys are short, single-word, camelCase-lite (`monthly`, `yearly`, `lifetime`).
- Stripe lookup keys are prefixed with the product (`contactly_`) to avoid collision in a multi-product account.

Having two names (internal + external) is good hygiene. If we later integrate a second billing provider (Paddle, LemonSqueezy), the internal key stays `monthly`; the mapping file gains a second column.

### `as const`

Without `as const`:

```typescript
const PRICING_LOOKUP_KEYS = { monthly: 'contactly_monthly', ... }
// Inferred type: { monthly: string; yearly: string; lifetime: string }
```

With `as const`:

```typescript
const PRICING_LOOKUP_KEYS = { monthly: 'contactly_monthly', ... } as const
// Inferred type: { readonly monthly: 'contactly_monthly'; readonly yearly: 'contactly_yearly'; ... }
```

Two benefits:

1. **Immutability in types.** TypeScript rejects `PRICING_LOOKUP_KEYS.monthly = 'something_else'`. The values are locked.
2. **Literal types, not string.** The type of `PRICING_LOOKUP_KEYS.monthly` is the exact string `'contactly_monthly'`, not the generic `string`. This means downstream code can use it in discriminated unions, switch statements, or zod schemas with full type narrowing.

`as const` is one of those small TypeScript features that pays compound interest. Use it for every static config table.

### Why this is a file, not inline

You might wonder: "it's only three lines — why not inline it into the checkout route?" Because:

- The same mapping is used in multiple places (checkout, webhook handling, pricing page, admin UI). A single source of truth is easier to keep correct than three copies.
- A config file is trivially **testable** — you can write a test that asserts `PRICING_LOOKUP_KEYS.monthly === 'contactly_monthly'` to catch accidental renames.
- A config file can be **documented** — add comments explaining what each key means for junior engineers.
- It builds muscle memory. Every billing-related app will have a `pricing.config.ts`. Your tenth SaaS will have one. Establish the habit early.

---

## Step 4: Lookup Key Transfer — Zero-Downtime Price Migrations

Here's the trick that makes lookup keys a superpower.

Every `lookup_key` is unique across active Prices in your Stripe account. If I try to create a second Price with `lookup_key: contactly_monthly` while an existing active Price already has it, Stripe returns an error: "lookup key is already in use."

Unless I set `transfer_lookup_key: true`. Then Stripe:

1. Creates the new Price with the new `unit_amount`, currency, interval, etc.
2. **Moves** the lookup key from the old Price to the new one.
3. Leaves the old Price active-but-keyless (or you archive it in a follow-up call).

From your application's perspective, the lookup key `contactly_monthly` silently starts resolving to a new Price. No deploy, no code change. A customer checking out 2 seconds before the transfer paid the old price; a customer checking out 2 seconds after pays the new price. Instantaneous, atomic, lossless.

### How to do it in the dashboard

Navigate to **Products → Contactly Pro**. Click the three-dot menu on the monthly price → **Update price**. In the dialog, Stripe actually offers a "Create new price with same lookup key" flow (because editing `unit_amount` isn't allowed on an existing price — the dashboard walks you through the transfer). The UI handles `transfer_lookup_key: true` for you.

### How to do it via the API

```typescript
await stripe.prices.create({
	product: 'prod_Contactly', // the Contactly Pro product
	currency: 'usd',
	unit_amount: 8700, // new price: $87/mo
	recurring: { interval: 'month' },
	lookup_key: 'contactly_monthly',
	transfer_lookup_key: true
});
```

The flag does the magic. Stripe creates the new Price and moves the lookup key in a single atomic operation. You then optionally archive the old Price (`stripe.prices.update(oldId, { active: false })`) as cleanup.

### The workflow, end to end

To change monthly from $97 to $87:

1. Marketing decides, tells engineering.
2. Engineer (or marketing, if you expose a script) runs:
   ```bash
   pnpm run stripe:update-price -- --key contactly_monthly --amount 8700
   ```
   which under the hood does the API call above.
3. Within a second, the new price is live.
4. Optionally, archive the old Price in the same script.

No PR. No deploy. No downtime. A change that would be days of friction in a hardcoded-IDs world becomes a trivial operation.

### What about subscribers on the old Price?

Existing subscriptions aren't affected by Price changes. A customer who subscribed at $97 continues to be billed $97 until you explicitly migrate them (a separate Stripe operation: `subscription.items.update` with the new Price). This is a feature — you don't accidentally re-price your entire customer base whenever you tweak the pricing page.

Migrations between prices for existing subscribers is its own topic (prorations, notice periods, grandfathering) that we touch on in Module 8. For now, know: **changing a Price doesn't change subscribers' rates**. Two separate operations.

---

## Step 5: The General Pattern — Indirection via Stable Identifiers

Step back. What's really happening here?

You have a **resource** (a Price). The resource has a **system-generated identifier** (`price_1Nv7k8KZabc`) — unique, immutable, infrastructure-owned. You want to refer to "this kind of thing" stably even if the underlying resource changes.

Solution: introduce a **stable, human-chosen identifier** (`contactly_monthly`) that's **transferable between resources**. Application code uses the stable identifier. Infrastructure resolves it to the current resource at request time.

This pattern appears everywhere:

- **DNS records.** `contactly.com` (stable) resolves to `54.197.12.88` (IP, changes). You move to a new server: update the A record, the domain name keeps resolving. Same pattern.
- **Git refs.** `main` (stable) resolves to a commit SHA (changes). Same pattern.
- **Kubernetes Services.** Service name `frontend` (stable) resolves to current pod IPs (change constantly). Same pattern.
- **OAuth scopes.** `contacts.read` (stable) as the string clients request; internally maps to a set of permissions that might be refactored. Same pattern.
- **Semantic versioning.** `react@^18` (stable-ish) resolves to whatever version satisfies the constraint at install time. Same pattern.
- **Feature flags.** `new_checkout_flow` (stable) resolves to true/false based on rollout config. Same pattern.

Every mature system has these indirection layers. You build them when you realize **infrastructure identity churns faster than business intent**. You skip them when you're in a hurry and pay later.

**Internalize this pattern** and you'll see opportunities to apply it in your own designs — when to add a stable slug column next to an opaque UUID, when to use a feature-flag key instead of an `if (userId === 42)`, when to name things "by intent" in general. This is load-bearing senior-engineer thinking.

---

## Step 6: Dark-Launching Pricing Changes

A special case of lookup-key transfer: **dark launches**. You want to test a new price internally before exposing it. Workflow:

1. Create a new Price with **no lookup key** (or with a temp key like `contactly_monthly_draft`).
2. Build the checkout flow to optionally accept the draft key via a query param (e.g., `/pricing?plan=draft`).
3. Route internal team traffic to the draft. Test the full flow — checkout, webhook, account gating, receipt.
4. When ready, transfer the lookup key: create a new Price with `lookup_key: contactly_monthly, transfer_lookup_key: true`. Main traffic flips instantly.
5. Archive the old Price.

Dark launches let you test at real production fidelity (real Stripe, real webhooks, real email receipts) without exposing untested prices to customers. It's one of the cleanest QA workflows in SaaS, enabled entirely by the lookup-key abstraction.

---

## Common Mistakes

### Mistake 1: Hardcoding `price_xxx` for "just one place, just for now"

"I'll use the ID in one spot and refactor later." Later never comes. The ID spreads to three spots. A new engineer copies the pattern because it's what's already there. Six months in, removing them is a multi-PR migration.

**Defense:** introduce the lookup key from the first line of billing code you ever write. Even if it's overkill for the current feature. The muscle memory is worth it.

### Mistake 2: Using the lookup key as the _display_ identifier

```svelte
<h2>{PRICING_LOOKUP_KEYS.monthly}</h2> <!-- renders "contactly_monthly" -->
```

The lookup key is a technical identifier, not a marketing string. Don't show it to users. The display string ("Monthly") is its own config.

### Mistake 3: Lookup key collisions across products

You later add a "Contactly Team" product with lookup keys `team_monthly` and `team_yearly`, but you also had `monthly` on an earlier product. Now `monthly` is ambiguous — it could mean either product.

**Defense:** always prefix lookup keys with the product slug: `contactly_monthly`, `contactly_team_monthly`, `contactly_enterprise_monthly`. Prefixing costs zero and prevents the collision entirely.

### Mistake 4: Not passing `active: true` to `prices.list`

```typescript
stripe.prices.list({ lookup_keys: ['contactly_monthly'] });
// Returns both active AND archived prices with that key (if any)
```

Usually you want only the active one. Always pass `active: true`. If there's ever more than one result, your pricing history is broken and you should investigate — not silently pick `[0]`.

### Mistake 5: Forgetting `transfer_lookup_key: true` on a migration

```typescript
await stripe.prices.create({
	product: 'prod_xxx',
	lookup_key: 'contactly_monthly',
	unit_amount: 8700
	// missing: transfer_lookup_key: true
});
// Returns: "Lookup key is already in use by price_existing..."
```

The error is clear. The fix is the one flag.

### Mistake 6: Caching the resolved Price ID

```typescript
// Anti-pattern: cache the resolved ID across requests
let cachedPriceId: string | null = null;

async function getPriceId() {
	if (cachedPriceId) return cachedPriceId;
	const { data } = await stripe.prices.list({ lookup_keys: ['contactly_monthly'], active: true });
	cachedPriceId = data[0].id;
	return cachedPriceId;
}
```

Your "optimization" just broke the superpower. When the lookup key transfers to a new Price, your cache is stale and points at the old archived Price. You're back in hardcoded-ID land via a different mechanism.

**Defense:** if you cache, cache with a short TTL (a minute or two) and include a version field, or cache nothing and trust Stripe's API speed (which is fast enough for checkout flows — you're calling Stripe anyway). A cache that lies about pricing is worse than no cache.

### Mistake 7: Forgetting lookup keys exist in test mode too

When you create products in test mode (which you did in Lesson 5.5), each Price's lookup key is test-mode-only. When you eventually activate live mode, you need to recreate the same products and prices **with the same lookup keys** so your code's `PRICING_LOOKUP_KEYS` works unchanged. We'll do this in Module 17.

---

## Principal Engineer Notes

### Data vs. code — the deploy separation

Reiterating the headline: **prices are data, not code**. The config file `pricing.config.ts` holds the **names** (which are code, rarely changing); the actual **values** live in Stripe and change via dashboard edits.

This is the same principle behind configuration management in general: separate the things that change at deploy frequency (code) from the things that change at business frequency (data). If your CEO can't change a headline on the landing page without pinging engineering, your CMS architecture is wrong. If marketing can't change a price without a PR, your billing architecture is wrong. Same failure mode, same fix: move the changeable thing out of code.

### Dark-launching pricing changes

Introduced above but worth reiterating: the lookup-key abstraction is what makes safe pricing changes possible. Without it, every pricing change is a coordinated deploy across code and data. With it, code and data can be released independently.

Most senior engineers learn this the hard way — shipping a price change during a demo, rolling back when a bug surfaces, scrambling to patch production. Build the mechanism now so you never have to learn the hard way.

### A/B testing via lookup-key swap

For a real pricing experiment, lookup keys give you two approaches:

**Approach A — Two active keys, routing at the application layer**:

- `contactly_monthly_a` = $97/mo (active)
- `contactly_monthly_b` = $117/mo (active)
- Your pricing page randomly sends users to one or the other.
- After the test, you either keep the winner's key or transfer the "main" key (`contactly_monthly`) to the winning Price.

**Approach B — Active key swap with analytics tagging**:

- `contactly_monthly` points at $97 Price. Tag checkouts with `variant: a`.
- Flip `contactly_monthly` to point at $117 Price. Tag checkouts with `variant: b`.
- Can't run the two variants simultaneously; it's A-then-B sequential.

Approach A is cleaner but requires your app to know about the variants. Approach B is simpler but slower to get a signal. For Contactly's scale, B is fine; for a pricing-heavy company, A is the norm.

Either way, the mechanism — pointers, not hardcoded IDs — is the enabler.

### Canary deploys of pricing

At large scale, you don't flip a price atomically; you canary it. 1% of traffic for an hour, 10% for a day, 50% for a week, 100%. Each phase is: create a new Price → route N% of traffic to the lookup key → watch metrics → proceed or revert.

Lookup keys plus a feature-flag layer (percentage rollouts of `pricing_experiment_v2`) make this straightforward. Without lookup keys, canary pricing is an infrastructure nightmare. The abstraction gives you the optionality to run sophisticated rollouts even if you don't use them on day one.

### When **not** to use lookup keys

Some narrow cases: if you're building a **one-off checkout** for a limited-time promotion that will never be reused, creating a Price and hardcoding its ID for the duration is pragmatic. The lookup-key tax is overhead when reuse isn't expected.

But even then — 95% of the time "one-off" turns out to have longer legs than you thought. When in doubt, lookup-key it.

### The deeper skill: naming by business intent

Everything in this lesson boils down to the same advice: **name things by what they are to your business, not by the identifier the infrastructure gave them.**

- Not `price_1Nv7k8KZabc` → `contactly_monthly`.
- Not `user_8c32...` → `current_user_id`.
- Not `feature_flag_42` → `new_checkout_flow`.
- Not `error_code_500` → `InternalServerError`.

Every time code can refer to a business concept by its business name, the code gets clearer, more refactorable, and more correct. This is a career-long habit. Practice it here, apply it everywhere.

---

## Summary

- Understood why **hardcoding `price_xxx` IDs is an anti-pattern**: it couples deploys to pricing changes, fragments across environments, and obstructs A/B testing.
- Adopted **lookup keys** as the stable, business-intent identifier your code uses. Stripe resolves the key to the current Price at request time.
- Wrote `src/lib/config/pricing.config.ts` as the single source of truth for which lookup keys Contactly uses:
  ```typescript
  export const PRICING_LOOKUP_KEYS = {
  	monthly: 'contactly_monthly',
  	yearly: 'contactly_yearly',
  	lifetime: 'contactly_lifetime'
  } as const;
  ```
- Learned **`transfer_lookup_key: true`**, the mechanism for moving a key from an old Price to a new one atomically — enabling zero-downtime pricing changes.
- Connected the lookup-key pattern to a broader principle: **indirection via stable identifiers** — the same pattern behind DNS, Git refs, Kubernetes Services, and feature flags.

## What's Next

We've prepared everything Stripe needs on its side: products, prices, lookup keys, CLI, dashboard familiarity. Lesson 5.7 is a short hygiene pass — cleaning up any stray test data, locking down the API keys in `.env`, and verifying the catalog is tidy before Module 6 builds the checkout flow. Ten minutes well spent.
