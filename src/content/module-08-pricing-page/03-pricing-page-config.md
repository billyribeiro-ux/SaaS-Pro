---
title: "8.3 - Pricing Page Config"
module: 8
lesson: 3
moduleSlug: "module-08-pricing-page"
lessonSlug: "03-pricing-page-config"
description: "Build a config-driven pricing page structure that separates content from presentation."
duration: 12
preview: false
---

## Overview

Before we build the pricing page UI in lesson 8.4, we need a place for the content to live. *What* tiers exist, *what* they're called, *what* features each one lists, *which* one is the "Best value" — this is all **content**, not markup. If we hardcode it into the Svelte page, every copy change ("add another feature row" or "rename Monthly to Starter") becomes a code change, a git commit, a deploy, and a round of "did I break the other tiers?" second-guessing.

Instead, we'll centralize the content in a single config file, `src/lib/config/pricing.config.ts`. It will export two pieces:

1. `PRICING_LOOKUP_KEYS` — the same constant our seed script from 8.2 already imports, defining the stable Stripe lookup keys.
2. `PRICING_TIERS` — a typed array describing each pricing card's content.

The Svelte component in lesson 8.4 will iterate over `PRICING_TIERS` and render one card per entry. Add a tier? Push an object into the array. Rename a tier? Edit a string. The component code never changes.

This is the **config-as-data** pattern, and it scales from pricing pages to navigation menus to feature flags to copy strings. Learning to see it — and the line between "this is content" and "this is structure" — is the principal-engineer skill we'll build in this lesson.

## Prerequisites

- Lesson 8.1 — you know what the three Stripe prices are and what their lookup keys will be.
- Lesson 8.2 — you've written the seed script, or at least know that it imports `PRICING_LOOKUP_KEYS` from this file.
- TypeScript basics: `interface`, union types, `as const`.
- Your `$lib` alias resolves `src/lib/*` — the SvelteKit starter sets this up in `svelte.config.js`, and we also alias `$config` to `src/lib/config` per the project's `tsconfig.json` conventions.

## What You'll Build

- A new file: `src/lib/config/pricing.config.ts`.
- `PRICING_LOOKUP_KEYS` — a frozen constant mapping tier IDs to Stripe lookup keys.
- `PricingTier` — a TypeScript interface describing the shape of one pricing card.
- `PRICING_TIERS` — an array of three `PricingTier` objects (Monthly, Yearly, Lifetime).
- A mental model for when config-driven beats markup-driven, and when it doesn't.

---

## Step 1: The File Structure

`src/lib/config/` is where Contactly keeps all its app-wide config. You've already seen `site.config.ts` (site name, URLs) and `curriculum.config.ts` if you're on the course-template branch. We're adding a sibling:

```
src/lib/config/
├── curriculum.config.ts
├── pricing.config.ts        ← new in this lesson
└── site.config.ts
```

Per the project's path aliases, this directory resolves as `$config`. So `src/lib/server/stripe.ts` can write:

```typescript
import { PRICING_LOOKUP_KEYS } from '$config/pricing.config'
```

The alias keeps import paths stable as files move. If we refactored the folder structure, we'd change one line in `svelte.config.js` / `tsconfig.json` instead of every importer. **Aliases are content addresses**; they hide physical layout from consumers.

Create the file:

```bash
touch src/lib/config/pricing.config.ts
```

---

## Step 2: The Lookup Keys Constant

```typescript
// src/lib/config/pricing.config.ts
export const PRICING_LOOKUP_KEYS = {
  monthly: 'contactly_monthly',
  yearly: 'contactly_yearly',
  lifetime: 'contactly_lifetime'
} as const
```

Two things to notice.

### Why a keyed object, not an array?

We chose `{ monthly: '...', yearly: '...', lifetime: '...' }` over `['contactly_monthly', 'contactly_yearly', 'contactly_lifetime']`. The object lets us refer to `PRICING_LOOKUP_KEYS.monthly` from code — semantic, readable, type-checked. With an array we'd write `PRICING_LOOKUP_KEYS[0]` and hope we remembered which index was which.

The object also makes the *public API* of this file self-documenting. A teammate reading `$config/pricing.config.ts` for the first time immediately sees the three billing modes we support.

### Why `as const`?

Without `as const`, TypeScript infers the type of `PRICING_LOOKUP_KEYS` as:

```typescript
{
  monthly: string
  yearly: string
  lifetime: string
}
```

Which means `PRICING_LOOKUP_KEYS.monthly` has type `string` — any string. That's barely-typed.

With `as const`, TypeScript infers:

```typescript
{
  readonly monthly: 'contactly_monthly'
  readonly yearly: 'contactly_yearly'
  readonly lifetime: 'contactly_lifetime'
}
```

Now `PRICING_LOOKUP_KEYS.monthly` has type `'contactly_monthly'` — a **literal type**. If you later write `if (key === 'contactly_montly')` (typo), TypeScript catches it, because the string `'contactly_montly'` is not assignable to `'contactly_monthly' | 'contactly_yearly' | 'contactly_lifetime'`.

`as const` is how you get enum-like precision without using an actual `enum`. We'll lean on this all the way through Module 10's access control, where mis-typed strings are security bugs.

> [!NOTE]
> **`as const` in 60 seconds:** appending `as const` to an object or array literal tells TypeScript to treat every value as its narrowest possible literal type, and to make the whole structure deeply `readonly`. Use it for configuration, for lookup maps, for anything that should be frozen after definition. Don't use it on values that you intend to mutate — TypeScript will reject the mutation.

---

## Step 3: The `PricingTier` Interface

Now the tier definition. Add this below `PRICING_LOOKUP_KEYS`:

```typescript
export interface PricingTier {
  id: 'monthly' | 'yearly' | 'lifetime'
  name: string
  description: string
  lookup_key: string
  features: string[]
  highlighted: boolean
  badge?: string
}
```

Let's look at each field and why it's there (and not somewhere else).

### `id: 'monthly' | 'yearly' | 'lifetime'`

A **union of string literals** — same three names as `PRICING_LOOKUP_KEYS`. This is the tier's internal identity. It's the value you'd put in a URL query string, send to analytics, or use as the React-style `key` in a loop.

Union literals instead of `string` give us exhaustiveness. If we later write a `switch (tier.id)` with cases for `'monthly'` and `'yearly'` but forget `'lifetime'`, TypeScript (with the `noFallthroughCasesInSwitch` flag) will complain. That's a free bug catch.

### `name: string`

The tier name shown in the card header. `"Monthly"`, `"Yearly"`, `"Lifetime"`. This is *customer-facing copy* — no dashes, no underscores, marketing language. Separating `name` (UI) from `id` (internal) is intentional: product can rename "Monthly" to "Flex" without cascading changes through the codebase.

### `description: string`

One-line tagline under the name. "Flexible, pay as you go." / "Save 14% vs monthly." / "Pay once, use forever." Again, customer-facing copy.

### `lookup_key: string`

The Stripe lookup key. We'll set it to `PRICING_LOOKUP_KEYS.monthly` / `.yearly` / `.lifetime` in the array below. Why a `string` type and not `'contactly_monthly' | 'contactly_yearly' | 'contactly_lifetime'`?

Because *the interface shouldn't constrain its users to Contactly's specific keys*. If you reuse this file for another product, you'd want `lookup_key` to accept any string. The runtime data is still narrow (thanks to `as const` on `PRICING_LOOKUP_KEYS`), but the *interface contract* is about structure, not identity.

This is a subtle style call. If you wanted stricter typing, you could write `lookup_key: (typeof PRICING_LOOKUP_KEYS)[keyof typeof PRICING_LOOKUP_KEYS]` and thread the literal types through. For Contactly's scale, `string` is fine and keeps the interface reusable.

### `features: string[]`

An array of bullet-point feature strings. The Svelte card will iterate over these and render one `<li>` per entry. The array ordering matters — it's the render order. Put the most important feature first; users skim.

Strings-as-features is a deliberate simplification. A richer model would be:

```typescript
features: Array<{ label: string; included: boolean; icon?: string }>
```

…which supports "included" vs "not included" and a leading icon. For Contactly's pricing page every feature is included (no cross-out rows), so `string[]` is the honest representation. The day we add a "basic vs premium" split we'll upgrade the type. Don't pre-model something you don't need.

### `highlighted: boolean`

True for the tier visually emphasized as the recommended option (the "best value" card). The Svelte component reads this and adds a ring/border/glow. Exactly one tier should be highlighted — usually the yearly.

We *could* enforce "exactly one" at the type level (e.g. a separate `const HIGHLIGHTED_TIER = 'yearly' as const`), but a boolean per-tier is more flexible: during an experiment you might highlight two tiers, or zero. Types should express the invariants you care about; the "exactly one highlighted" rule isn't strict enough to encode.

### `badge?: string`

An optional floating badge label rendered above the card ("Best value", "Limited offer", etc.). `?` makes it optional — omit the field if the tier has no badge. Most tiers won't.

---

## Step 4: The `PRICING_TIERS` Array

Below the interface:

```typescript
export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    description: 'Flexible, pay as you go.',
    lookup_key: PRICING_LOOKUP_KEYS.monthly,
    features: [
      'Unlimited contacts',
      'All features included',
      'Email support',
      'Cancel anytime'
    ],
    highlighted: false
  },
  {
    id: 'yearly',
    name: 'Yearly',
    description: 'Save 14% vs monthly.',
    lookup_key: PRICING_LOOKUP_KEYS.yearly,
    features: [
      'Unlimited contacts',
      'All features included',
      'Priority email support',
      '2 months free vs monthly'
    ],
    highlighted: true,
    badge: 'Best value'
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    description: 'Pay once, use forever.',
    lookup_key: PRICING_LOOKUP_KEYS.lifetime,
    features: [
      'Unlimited contacts',
      'All features included',
      'Lifetime updates',
      'Never pay again'
    ],
    highlighted: false
  }
]
```

### Why the array ordering matters

The Svelte component will render `PRICING_TIERS` in declaration order. That means Monthly will be the leftmost card, Yearly the middle, Lifetime the rightmost. Whether that's the right visual order is a marketing decision — generally the *recommended* tier goes in the middle on 3-card layouts, because the eye lands there first. Hence: Monthly, **Yearly (highlighted)**, Lifetime.

If product wanted a different order ("lifetime should be leftmost to emphasise the one-time option"), they reorder the array. No Svelte change needed.

### The typed array

`PRICING_TIERS: PricingTier[]` tells TypeScript every entry must satisfy the interface. If you forget `lookup_key` on one tier, TypeScript refuses to compile. If you misspell `higlighted`, same. If you add a field that isn't in the interface, same.

This is the contract between the config and the component: **the component can safely assume every tier has all the required fields.** No defensive coding, no `?? ''`, no "what if features is undefined" — the type system already answered those questions at write time.

### Sharing the lookup keys

Each tier's `lookup_key` field uses `PRICING_LOOKUP_KEYS.*`. The tier object isn't just *describing* the Stripe price, it's *linking* to it by stable name. In lesson 8.4 the server code zips these tier definitions with live Stripe price data fetched by these same keys. One end of the zip is the content (features, copy, badge); the other end is the live price data (amount, interval); the lookup key is the join column.

---

## Step 5: Verify the Types Compile

Open the file and hover over `PRICING_TIERS` in your editor. You should see the inferred type as `PricingTier[]`. Hover over `PRICING_LOOKUP_KEYS.monthly` — it should say `'contactly_monthly'` (a literal), not `string`.

If you see `string` everywhere, you probably missed the `as const` on `PRICING_LOOKUP_KEYS`. Add it.

Run the TypeScript check:

```bash
pnpm exec svelte-kit sync && pnpm exec tsc --noEmit
```

(Or whatever your project's type-check script is — `pnpm check` usually works on the SaaS-Pro template.)

No errors means the contract is sound. The config is ready.

---

## Step 6: A Look Ahead at the Consumer

You won't write this yet (it's lesson 8.4's job), but a preview helps you see why the config was worth the effort. Here's roughly what the pricing page's server load function will do:

```typescript
import { PRICING_TIERS } from '$config/pricing.config'
import { stripe } from '$lib/server/stripe'

export const load = async () => {
  const prices = await stripe.prices.list({
    lookup_keys: PRICING_TIERS.map((t) => t.lookup_key),
    active: true,
    expand: ['data.product']
  })

  const byLookupKey = new Map(
    prices.data.map((p) => [p.lookup_key, p])
  )

  return {
    tiers: PRICING_TIERS.map((tier) => {
      const price = byLookupKey.get(tier.lookup_key)
      return {
        ...tier,
        price_id: price?.id,
        unit_amount: price?.unit_amount ?? null,
        interval: price?.recurring?.interval ?? null
      }
    })
  }
}
```

Notice: the server code knows nothing about "Monthly vs Yearly" — it just iterates over `PRICING_TIERS` and asks Stripe about each one. If marketing adds a "Quarterly" tier by pushing a fourth entry into the array, this server code requires zero change.

That's the payoff. Config-driven gives you leverage: the component is a generic renderer, the config is the specific content, and one can change without forcing the other to.

---

## Common Mistakes

### Mistake 1: Forgetting `as const`

Without it, `PRICING_LOOKUP_KEYS.monthly` is typed as `string`. Your narrowing logic downstream silently disappears. Lint passes, tests pass, you never notice until a typo in `'contactly_monhtly'` breaks the Stripe lookup at runtime.

**Fix:** always end lookup-map constants with `as const`.

### Mistake 2: Putting the seed amounts in this config too

A tempting refactor: why not add `unit_amount: 9700` to each tier here? Then the seed script and the pricing display both read from this config.

Resist. Stripe is the source of truth for prices. Duplicating the amount in a local config creates two places where price changes happen; eventually they drift. The pricing page already fetches live amounts from Stripe (lesson 8.4). Let it.

Exception: if you ever ship a static site with zero server round-trips, you might denormalize the amounts into the config for speed. That's a known tradeoff; document it at the top of the file. Don't do it by default.

### Mistake 3: Making the interface too flexible

A first-draft interface might include things like `onClickOverride?: (tier) => void` or `customCardRenderer?: Component`. These aren't content, they're behaviour — and once you allow per-tier behaviour overrides, the config stops being declarative and becomes a mini-programming language. Mistakes compound.

**Fix:** keep the interface to content only. If you need per-tier behaviour, handle it with branches in the component (`{#if tier.id === 'lifetime'}`), not callbacks in the config.

### Mistake 4: Mixing marketing copy across files

The tier names here are `Monthly` / `Yearly` / `Lifetime`. If lesson 8.4's Svelte component writes `<h1>Choose your plan</h1>` and lesson 8.1's Stripe dashboard has the product description `Full access to Contactly`, those are *three* places with customer copy.

For a small site, fine. For a larger site, consider consolidating copy in one file (`i18n/en.ts`, `copy.ts`, or a CMS). Start small, extract when you feel the pain.

### Mistake 5: Treating `id` and `lookup_key` as the same thing

`id` is internal, short, uppercase-safe. `lookup_key` is the Stripe identifier, which has prefix conventions (`contactly_`) and cross-environment meaning. Even though they happen to match 1:1 today (`id = monthly` ↔ `lookup_key = contactly_monthly`), don't collapse them. The day you rebrand to "Relate Pro" and change lookup keys to `relate_monthly`, you'll thank yourself for having two separate fields.

**Fix:** keep them separate. Use `id` for component logic, `lookup_key` for Stripe calls.

---

## Principal Engineer Notes

### 1. Config as data: the line between content and code

The rule of thumb: **anything a non-developer might want to change should be data; anything about how data is rendered is code.** Tier names, descriptions, feature lists — a marketer could own these. Which Tailwind class adds a "highlighted" ring — an engineer owns that.

Config files are the handshake between those roles. The config describes *what*; the code describes *how*. If you notice a single file containing both ("the Svelte component has hard-coded feature strings"), you've collapsed the layers — and the result is always the same: either the engineer becomes the pricing-copy approver, or the marketer has to open a PR to change a typo.

### 2. `as const` is a load-bearing idiom

`as const` is seen as a small TS nicety. It's actually one of the most important tools in the language for encoding business invariants. Every string that *should* have a fixed set of values wants `as const`:

- Route names (`['/login', '/dashboard'] as const`)
- Status codes in your own app (`{ paid: 'paid', trialing: 'trialing' } as const`)
- Feature flags
- Billing modes
- Tier IDs

Once you have literal types, you can use them to constrain function parameters (`function setBillingMode(mode: BillingMode)`) and to exhaustively-switch on them. The payoff compounds: catching bugs at compile time is cheaper than catching them in production.

### 3. Type safety scales with explicit union types

The `id: 'monthly' | 'yearly' | 'lifetime'` union means a function accepting `PricingTier['id']` cannot be called with a random string. TypeScript's error on `setTier('yearl')` is far more useful than a runtime-only "unknown tier" crash.

You see the same pattern in `BillingMode = 'trialing' | 'active' | 'past_due' | 'canceled'` (Module 10), in `UserRole = 'user' | 'admin'`, in any schema field with a fixed set of values. Whenever the set of values is closed, write the union. When it's open (user-supplied names, dynamic feature flags), keep it as `string`.

### 4. The "content model" separation scales beyond pricing

This file is a content model for pricing cards. The same idea extends to:

- **Navigation menus**: `NAV_ITEMS` is an array of `{ label, href, icon?, children? }`. One `<Nav>` component renders any nav structure.
- **Onboarding steps**: `ONBOARDING_STEPS: Step[]` drives a multi-step wizard. Reorder by editing the array.
- **Feature comparison tables**: `COMPARISON_ROWS` drives a marketing-page comparison. Product owns the content.
- **Settings panels**: `SETTINGS_SECTIONS` drives an account-settings page. Add a section by pushing to the array.

Every time you feel the urge to duplicate a block of Svelte markup with minor variations, stop and ask: "Is the variation data?" If yes, extract it to config.

### 5. How this enables non-dev tier updates

With `PRICING_TIERS` in a single TS file, a marketer who wants to change the yearly tier's description can open a PR that touches one string. The PR is grep-able, diff-able, reviewable by a PM. The CI pipeline type-checks the config, so structural breakage is caught. Merge, deploy, done.

The logical next step, once this gets heavy, is to move the config to a CMS (Sanity, Contentful, Supabase itself) and fetch it via the server load function. You don't need that yet — three tiers don't warrant CMS overhead — but the shape of the data is already CMS-ready: a flat array of typed records. The migration, when you need it, is replacing one import with one fetch.

### 6. Don't let config become a programming language

A danger sign: the config starts accepting `if` conditions, computed fields, or references to external state. At that point you have a leaky abstraction — the config looks declarative but behaves imperatively, and contributors have to guess which rules are in force.

Stay declarative. When you need behaviour, branch in the component based on declarative fields (`{#if tier.id === 'lifetime'} ... {/if}`), not function-valued config. The constraint forces you to keep the data model simple, which keeps the component simple.

---

## Summary

- Created `src/lib/config/pricing.config.ts`, Contactly's single source of truth for pricing-page content.
- Exported `PRICING_LOOKUP_KEYS` as a frozen object — the same constant the seed script from lesson 8.2 imports. One definition, two consumers.
- Used `as const` to give TypeScript literal-type precision on the lookup keys.
- Declared a `PricingTier` interface capturing the shape of one pricing card: id, name, description, lookup key, features, highlighted flag, optional badge.
- Populated `PRICING_TIERS` with Monthly, Yearly, and Lifetime, each linked to its Stripe lookup key via `PRICING_LOOKUP_KEYS.*`.
- Learned where the config-vs-component line should fall: content is data, rendering is code.

## What's Next

The content model is defined. Now we render it. Lesson 8.4 builds `src/routes/(marketing)/pricing/+page.server.ts` and `+page.svelte`. The server load function uses `PRICING_TIERS.map((t) => t.lookup_key)` to fetch live prices from Stripe via `stripe.prices.list({ lookup_keys, active: true, expand: ['data.product'] })`, zips them with the tier config, and hands the page a ready-to-render array. The Svelte component iterates, renders three cards with formatted amounts and CTA buttons, and wires the buttons to a `/api/billing/checkout` POST (which we'll build in Module 9).
