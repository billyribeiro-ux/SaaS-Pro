---
title: '5.4 - Products & Prices Overview'
module: 5
lesson: 4
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '04-products-prices-overview'
description: "Understand Stripe's product and pricing data model before creating your own."
duration: 10
preview: false
---

## Overview

Before we click "New product" in the Stripe dashboard, we need to understand the model Stripe is quietly imposing on our catalog. It's a two-object model: **Products** and **Prices**. A Product is _what_ you sell. A Price is _how much and how often_. One Product can have many Prices — monthly, yearly, regional, lifetime, legacy, experimental. This split looks overengineered at first glance, but it's one of the cleanest data-model decisions in any SaaS API. By the end of this lesson you'll understand why, and you'll know how to think in Stripe's terms before you ever write SQL for your own billing logic.

This lesson is **conceptual only**. No buttons clicked, no code written. Lesson 5.5 creates the actual Contactly Pro product and its three prices. Here we lay the groundwork so that when you create them, every field makes sense.

## Prerequisites

- Lesson 5.1 (dashboard tour) and 5.2 (docs tour) complete.
- Stripe test mode enabled.

## What You'll Build

- A full mental model of the Product / Price split — what each contains, how they relate, and why Stripe separates them.
- Fluency with the Price object's critical fields: `unit_amount`, `currency`, `type`, `interval`, `active`.
- Comfort with "amount in cents" as the SaaS standard.
- A preview of **lookup keys** (covered in depth in Lesson 5.6), and the rule: **never hardcode `price_xxx` IDs in application code**.

---

## Step 1: What Is a Product?

A Stripe **Product** is a reusable catalog entry describing _something you sell_. It has:

- **`name`** — human-readable name ("Contactly Pro"). Shown on invoices, receipts, and checkout pages.
- **`description`** — human-readable description ("Full access to Contactly — unlimited contacts and all features"). Also surfaced on checkout and receipts.
- **`images`** — an array of image URLs, optional. Shown on checkout if provided.
- **`active`** — boolean. Inactive products can't be used on new subscriptions but remain linked to existing ones.
- **`metadata`** — a free-form key/value map. This is your escape hatch for app-specific data ("`internal_sku`, `tier_slug`, `feature_flags_json`"). Metadata never appears on receipts; it's invisible to customers.
- **`id`** — starts with `prod_` (e.g., `prod_Nv7k8KZabc`). Stripe generates this on creation; you reference it when creating a Price.

Notice what **isn't** here: no price, no interval, no currency. A Product doesn't know how much it costs. It's just a _thing_.

This is deliberate. Think of Product as the platonic ideal of "the service you offer" — its identity, its branding, its description. If you change your pricing tomorrow, you don't want to create a new product; the product is still Contactly Pro. The _terms_ changed, not the thing.

### Examples of Products

- `Contactly Pro` — what we'll build.
- `GitHub Pro` — GitHub's paid-developer plan. One product.
- `The New York Times Digital` — NYT's digital subscription. One product.
- `Adobe Photoshop` — one product, sold through many SKUs (monthly, annual, student, business).

The "one product, many prices" pattern is ubiquitous. Our first instinct might be "monthly and yearly feel like different things — they should be different products." Resist it. Monthly and yearly are the same offering at different payment cadences. Same product, different prices.

---

## Step 2: What Is a Price?

A Stripe **Price** is the commercial terms under which a Product can be sold. It has:

- **`id`** — starts with `price_` (e.g., `price_1Nv7k8KZ`). Generated on creation.
- **`product`** — the `prod_xxx` this Price belongs to. Every Price is attached to exactly one Product.
- **`unit_amount`** — integer, in the **smallest currency unit** (cents for USD, pence for GBP, etc.). $97.00 is `9700`. Always an integer, never a decimal. More on this below.
- **`currency`** — three-letter ISO code: `"usd"`, `"eur"`, `"gbp"`, `"jpy"`. Lowercased.
- **`type`** — either `"recurring"` (subscriptions) or `"one_time"` (lifetime, single payments).
- **`recurring`** — present only when `type === "recurring"`. Contains:
  - `interval` — `"day"`, `"week"`, `"month"`, or `"year"`.
  - `interval_count` — how many of those intervals per billing cycle. Usually `1`.
  - `usage_type` — `"licensed"` (per-seat; we use this) or `"metered"` (pay-as-you-go).
- **`active`** — boolean. Inactive prices can't be used on new subscriptions but persist for existing ones.
- **`lookup_key`** — a stable, developer-chosen string like `contactly_monthly`. The hero of Lesson 5.6. (Preview: this is how you avoid hardcoding `price_xxx` IDs.)
- **`metadata`** — same concept as Product metadata: key/value map for your app's use.
- **`nickname`** — internal name for humans browsing the dashboard ("Contactly Pro Monthly"). Never shown to customers.

One Product has many Prices. Each Price represents one specific commercial offer.

### Examples of Prices for one Product

For `prod_Nv7k8KZ` (Contactly Pro), we'll create three Prices:

| Price    | `unit_amount` | `currency` | `type`    | `interval` | `lookup_key`         |
| -------- | ------------- | ---------- | --------- | ---------- | -------------------- |
| Monthly  | 9700          | `usd`      | recurring | month      | `contactly_monthly`  |
| Yearly   | 99700         | `usd`      | recurring | year       | `contactly_yearly`   |
| Lifetime | 499700        | `usd`      | one_time  | —          | `contactly_lifetime` |

All three attach to the same `prod_` ID. All three are listed under the Contactly Pro product in the dashboard. When a customer checks out, they pick one Price (via our UI); Stripe creates a Subscription (for recurring) or a Payment (for one_time) against that specific Price.

You could easily imagine adding more:

- `Monthly EUR` — same product, €97/mo.
- `Monthly Student` — $49/mo with a stricter verification flow.
- `Black Friday Yearly` — $797/yr, with a promotion code, time-limited.
- `Legacy Annual` — $497/yr, inactive, but grandfathered for existing customers.

All attached to the same Product. The Product's identity is stable; its commercial terms flex.

---

## Step 3: Why the Split? (The Principle Behind the Design)

A lot of simpler billing systems use a single `plan` or `tier` object that bundles everything: name, amount, interval, description. It works. But it has three subtle problems.

### Problem 1 — Identity drift across price changes

If you change your price from $97/mo to $127/mo, with a single-object model you've either:

- Edited the existing row — confusing for customers on the old price (do they still have "the $97 plan"? no, but kind of?), and messy in your audit log.
- Created a new row with the new price — but now you have two "Contactly Pro Monthly" rows, and you need a separate mechanism (a tag? a slug?) to know they're the same product.

With the Product/Price split, the Product is stable ("Contactly Pro") and you simply **add a new Price** ($127/mo) and deactivate the old one. Both Prices stay queryable. Reporting still shows "Contactly Pro revenue" aggregated across both. Customers on the old Price stay there unless you explicitly migrate them.

This is the same design philosophy behind immutability in general: once data is created, changing it loses history. Adding new data keeps it.

### Problem 2 — Multiple commercial terms for one thing

A Product sold at $97/mo, $997/yr, $4997 lifetime, and also in EUR, GBP, and JPY, with annual discounts and student pricing — that's potentially a dozen commercial combinations. Representing each as a separate Product creates noise in your catalog; users would see "Contactly Pro Monthly USD", "Contactly Pro Monthly GBP", "Contactly Pro Yearly USD"… a flat list where 90% of entries are the same product.

Product/Price lets you group: one "Contactly Pro" entry in the dashboard, with a dozen Prices nested under it. Vastly cleaner.

### Problem 3 — A/B testing

If you want to test $97 vs $117 monthly to see which converts better, you create **two Prices** for the same Product and show half your traffic each. The Product doesn't change. Your analytics see "Contactly Pro signups" aggregated across both; your pricing experiment sees signups per Price. Two different lenses on the same data.

With a single-object model, the A/B test would either require creating "Contactly Pro A" and "Contactly Pro B" as distinct products (muddying analytics) or some ad-hoc flag system.

### The pattern, in one sentence

**A Product is what the customer conceptually buys; a Price is the specific contract under which a given customer bought it.** Almost every mature catalog system ends up with this split — Shopify has Product/Variant, e-commerce has Item/SKU, ticketing has Event/TicketType. Stripe borrowed from decades of catalog-design experience. Trust it.

---

## Step 4: The `unit_amount` Detail (Cents, Always Cents)

`unit_amount: 9700` for $97. Not `97.00`. Not `97`. `9700`.

Stripe stores all monetary amounts as integers in the smallest currency unit:

- USD: cents. $97.00 → `9700`.
- EUR: cents. €12.50 → `1250`.
- GBP: pence. £1.00 → `100`.
- JPY: yen (no subdivisions). ¥100 → `100`.
- BHD: fils, 1000 per dinar. 1 BHD → `1000`.

**Why integers and not floats?** Because floating-point arithmetic is not associative for decimals. `0.1 + 0.2 !== 0.3` in JavaScript (and every IEEE 754 language). Compound that over a billion transactions and you get rounding errors, balance drifts, auditor nightmares.

With integer cents, a $9.99 charge is exactly `999` cents — never `998.9999999` or `999.0000001`. Addition and subtraction are exact. Tax and multi-item cart totals are exact. Month-end reconciliation is exact.

The rule across the entire financial tech industry: **money is represented as integer minor units**. Postgres columns of type `bigint` or `numeric(19,0)`. Java's `BigDecimal`. Python's `Decimal`. JavaScript's integers (or `bigint` if you're handling amounts larger than `Number.MAX_SAFE_INTEGER`, i.e., over ~$90 trillion — a problem most of us don't have).

### Converting for display

UIs show `$97.00`, not `9700`. So you divide by 100 just before rendering:

```typescript
const displayPrice = (amountInCents: number, currency: string) =>
	new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountInCents / 100);

displayPrice(9700, 'USD'); // "$97.00"
```

Pitfall: some currencies don't divide by 100. Japanese Yen is a whole-unit currency (`unit_amount: 100` means ¥100, not ¥1). Bahraini Dinar divides by 1000. The `Intl.NumberFormat` API handles this correctly if you pass the currency — don't hardcode `/ 100` for international apps.

For Contactly, we'll charge in USD and use `/ 100` confidently. For a global app, delegate to `Intl.NumberFormat`.

### Converting for input

If a form lets the user enter `97`, you multiply by 100 to get cents. Use integer multiplication; never compute via floats:

```typescript
// Good: integer input, integer math
const cents = parseInt(inputDollars, 10) * 100;

// Bad: float input, float math — will sometimes produce 9699 or 9701
const cents = Math.round(parseFloat(inputDollars) * 100);
```

(The "bad" version is occasionally necessary when users enter decimals like `97.50`. In that case `Math.round(parseFloat(input) * 100)` is the widely-accepted safe pattern — but prefer keeping the UI whole-dollar if possible.)

---

## Step 5: Recurring vs One-Time

A Price's `type` field is either `"recurring"` or `"one_time"`:

- **`recurring`** — used for subscriptions. Must have a `recurring.interval` (month/year/week/day) and `recurring.interval_count`. The `$97/mo` and `$997/yr` Prices.
- **`one_time`** — used for single payments. No interval. The `$4997 lifetime` Price.

When you create a Checkout Session, you pass a Price ID and Stripe infers the mode:

- Price with `type: "recurring"` → Stripe creates a **Subscription** (a long-lived object that bills on the interval).
- Price with `type: "one_time"` → Stripe creates a **Payment** (one-shot, no recurrence).

### The hidden polymorphism

Your code for "user picks a tier → checkout" is almost identical for all three tiers — SvelteKit grabs the lookup key, fetches the Price, builds a Checkout Session, redirects. Stripe handles the rest. You don't maintain two separate code paths (subscriptions vs one-time); you pass the Price and Stripe polymorphs internally.

This is why we can offer Contactly monthly, yearly, and lifetime with essentially the same codebase — the Price type is data, not a branching condition.

One caveat: post-purchase behavior differs. A subscription creates a webhook stream (`customer.subscription.created`, `invoice.paid`, etc.) that continues for the life of the subscription. A one-time payment creates a `checkout.session.completed` and a single `payment_intent.succeeded`, then goes quiet. Your webhook code needs to handle both. We cover this in Module 7.

---

## Step 6: `active` — Deactivate, Don't Delete

Stripe lets you **delete** Products and Prices, but the option is disabled for any Product/Price that's been used in a real transaction (or is referenced by an active Subscription). Why? Because deleting would break referential integrity for historical records: invoices, refunds, receipts.

The safer, default-correct operation is **deactivation**. Set `active: false`:

- Deactivated Products don't appear in new Checkout Sessions.
- Deactivated Prices can't be used for new Subscriptions.
- Existing Subscriptions attached to deactivated Prices **continue billing normally** — the customer isn't affected.
- Historical invoices, receipts, and reports still reference the deactivated objects; nothing breaks.

Pricing changes follow this pattern: **add new, deactivate old**. Never edit in place, never delete.

In the dashboard, you deactivate from the Product or Price detail page → "Archive" (Stripe's UI name for deactivation). In the API, it's `stripe.products.update(id, { active: false })`.

We'll lean on this in Lesson 5.6 when we do price migrations via lookup key transfer.

---

## Step 7: Previewing Lookup Keys (The `price_xxx` Problem)

Every Price has a globally unique ID like `price_1Nv7k8KZabc` — assigned by Stripe, unchangeable, specific to your account. Natural instinct: put it in your code.

```typescript
// In a SvelteKit route — DO NOT do this
const PRICE_MONTHLY = 'price_1Nv7k8KZabc';
const PRICE_YEARLY = 'price_1Nv7k8KZxyz';
const PRICE_LIFETIME = 'price_1Nv7k8KZfoo';
```

This breaks badly the first time you need to change a price. If you bump monthly from $97 to $127, you:

1. Create a new Price in Stripe (because editing breaks history). It gets a new `price_` ID.
2. Update `PRICE_MONTHLY` in your code to point at the new ID.
3. Deploy.

Between step 1 and step 3, which can easily be hours or days (code review, CI, staging), the code still references the old ID. New checkouts fetch the old Price. Customers pay the old amount. Revenue leak, caused by a string constant. Multiply across a team of engineers and a dozen prices and you get an ongoing maintenance burden.

**Lookup keys** solve this. Instead of hardcoding the Stripe ID, you give each Price a stable, human-chosen key like `contactly_monthly`. Your code references `contactly_monthly`. Stripe resolves it to the currently-active Price at request time. When you change the price, you move the lookup key from the old Price to the new one (via the dashboard or API). Your code **doesn't change**.

The rule: **lookup keys are your code's contract with Stripe; Stripe IDs are infrastructure implementation details.** Never let `price_xxx` into your app code.

We build this out fully in Lesson 5.6. For now, just know: **we're going to give each Contactly Price a lookup key in Lesson 5.5** (e.g., `contactly_monthly`), and from then on, our code will look up Prices by key, not by ID.

---

## Common Mistakes

### Mistake 1: Treating monthly and yearly as separate Products

You create "Contactly Pro Monthly" and "Contactly Pro Yearly" as two Products. It works, but your dashboard is cluttered, your revenue reports don't aggregate cleanly, and if you add a third tier you triple the noise. **One Product, multiple Prices** is the shape. Fight the instinct to split.

### Mistake 2: Using decimals for `unit_amount`

```typescript
unit_amount: 97.0; // WRONG — API expects an integer
unit_amount: 9700; // RIGHT — 9700 cents = $97.00
```

The SDK will sometimes accept `97.00` and silently truncate to `97` (i.e., $0.97 — a near-free price), or sometimes error out. Either outcome is bad. Always integer.

### Mistake 3: Deleting Prices instead of archiving

"I created a wrong Price; let me delete it." If that Price has been used in a transaction, Stripe will reject the delete. If it hasn't, it'll succeed — but your habit of deleting will cause damage the first time it was used. **Always archive** (set `active: false`). Deletion should be treated as a destructive operation of last resort.

### Mistake 4: Hardcoding `price_xxx` in source code

Addressed above; we'll fix this properly in 5.6. For now: **if you see a `price_` ID checked into source, it's a bug**.

### Mistake 5: Forgetting the currency on a Price

Every Price requires a currency. You can't create a "currency-agnostic" Price. If you want to sell in multiple currencies, you create one Price per currency (same Product, different Prices). Don't try to dynamically convert at checkout — Stripe handles multi-currency catalogs natively and correctly.

### Mistake 6: Giving the same lookup key to two Prices in the same account

Lookup keys are **unique per account**. If you try to create a new Price with a lookup key that's already in use, Stripe rejects the request — unless you pass `transfer_lookup_key: true`, which moves the key from the old Price to the new one (the exact pattern we'll use for price migrations).

### Mistake 7: Forgetting to save the Price ID after creation (as a side note)

Even though you shouldn't hardcode `price_xxx`, when you create a Price programmatically the response contains its ID. For creation scripts (seed data, migration scripts) you'll note the ID in the script output. Don't commit it; the ID's only long-term name is its lookup key.

---

## Principal Engineer Notes

### Prices are data; code is behavior

The big mental shift this lesson wants you to make: **pricing is data, not code**. Your code knows that there's a "monthly" plan and a "yearly" plan; it doesn't know what either costs. That knowledge lives in Stripe, fetched at request time. If marketing decides to drop monthly from $97 to $87 overnight, they edit the Stripe dashboard; no deploy required.

This is the same separation as "feature flags are data, config is data, localization strings are data." You're building a **machine** that reads its rules from a **database**; Stripe just happens to be that database for pricing.

Engineers who haven't internalized this split often argue that hardcoded prices "are simpler" or "don't change often enough to matter." In my experience, both are wrong — prices change _more_ than you expect (promos, regional adjustments, grandfathering, experiments), and the cost of coupling pricing to deploy cycles is paid with interest. Start decoupled.

### Amount-in-cents as a civilizational agreement

Banks, exchanges, payment processors, accounting software, tax systems — all of them, globally, represent money as integer minor units. When two systems interop, integer minor units are the lingua franca. Floating-point "dollars" is an anti-standard.

Contactly's `orders.amount_cents` column in a future module will be `integer not null`. Our Stripe `unit_amount` is integer. Our internal arithmetic stays in cents until the very last step of display. If you remember one rule from this course: **money in cents, always**.

### Why Stripe split Product and Price, told as a design story

Imagine the early Stripe team designing Subscriptions. They probably started with a single `Plan` object: name + price + interval. It shipped, customers loved it, they used it for years.

Then customers started asking for things that didn't fit:

- "I want to change my price without losing billing history."
- "I want multi-currency."
- "I want to A/B test pricing."
- "I want to sell the same thing monthly or yearly."

Each of those could be solved with more fields on `Plan`, but each patch made `Plan` weirder. At some point the team made the hard call: rename `Plan` to `Price`, introduce `Product` as the parent concept, and migrate every customer. That migration is why the Stripe API has both `/plans` (legacy) and `/prices` (modern) endpoints — the old shape still works, but the new shape is what the docs recommend.

This is a common arc: a simple model hits real-world complexity, and the correct response is usually to **introduce a new layer of abstraction**, not to add complexity to the existing layer. The skill to recognize when you need a new layer (Product/Price) vs. when an extra field will do is one of the hardest parts of senior engineering.

### Metadata is an escape hatch — use it sparingly

Both Products and Prices have a `metadata` field for your app's custom data. It's tempting to overload: store tier slugs, feature flag strings, tenant-specific overrides, etc. **Resist.** Metadata is:

- Limited to 50 keys, 500 chars per value.
- Unindexed on Stripe's side — you can't efficiently query "all Prices with `metadata.tier_slug = 'pro'`".
- Visible to anyone with API access — don't store secrets.

Rule of thumb: metadata is for cross-references (e.g., `internal_product_id = prod-abc-123`), not for first-class business logic. First-class business logic belongs in your own database.

### The data model is universal; the implementation is Stripe-specific

Even if you moved off Stripe tomorrow — to Paddle, Chargebee, Lemon Squeezy, or an in-house billing system — the Product/Price split would be the right model. It's the correct abstraction for "we sell this under these terms." Stripe didn't invent it, it just happens to have the most polished implementation today. Learning it well is an investment in general billing literacy, not a Stripe-specific skill.

---

## Summary

- **Product** = what you sell (name, description, identity). Stable.
- **Price** = commercial terms (amount, currency, cadence). One Product has many Prices.
- **`unit_amount`** is always an integer in the smallest currency unit (cents for USD). Never decimals, never floats.
- **`type`** is `"recurring"` (with an `interval`) or `"one_time"`. Stripe's checkout handles both polymorphically.
- **Deactivate, don't delete.** Archive stale Prices with `active: false`; they continue to support existing subscriptions.
- **Lookup keys** (next lesson) are how your code references Prices stably. Never hardcode `price_xxx` IDs.
- The Product/Price split is the correct abstraction even beyond Stripe; internalize it as a general billing pattern.

## What's Next

Now that you know the model, Lesson 5.5 puts it into practice — we create the **Contactly Pro** Product in the Stripe dashboard and attach three Prices: monthly $97, yearly $997, lifetime $4997. Each gets a lookup key so our code will never have to know a `price_xxx` ID by name.
