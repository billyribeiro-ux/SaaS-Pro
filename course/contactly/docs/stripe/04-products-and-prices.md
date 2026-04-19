# Lesson 5.4 — Products & Prices Overview

Stripe's billing domain is built around two primary resources: a
[**Product**](https://docs.stripe.com/api/products.md) is the thing
you sell; a [**Price**](https://docs.stripe.com/api/prices.md) is how
much it costs. Contactly's pricing model (ADR-007) maps onto this
pair cleanly:

```text
Product: "Contactly Pro"
  ├─ Price: $19 / month  (lookup_key: contactly_pro_monthly)
  └─ Price: $190 / year  (lookup_key: contactly_pro_yearly)

Product: "Contactly Business"
  ├─ Price: $49 / month  (lookup_key: contactly_business_monthly)
  └─ Price: $490 / year  (lookup_key: contactly_business_yearly)
```

Starter is **not** a Stripe resource. It's the entitlement every user
has by default, when no paid subscription is active. Trying to model
Free as a `$0` Stripe price is an antipattern — it creates a
`customer.subscription.created` event for users who never paid, and
downstream code has to special-case the zero-dollar path on every
event type. Absence of a subscription is the cleanest signal.

## Anatomy of a Product

```typescript
// Shape, not code we'll run yet — Lesson 5.5 creates these
{
  id: "prod_abc123",                    // Stripe-assigned, unstable across re-seeds
  name: "Contactly Pro",                // shown in Checkout + Customer Portal
  description: "Up to 1,000 contacts...", // shown everywhere the name shows
  active: true,                         // false = hidden from new checkouts
  metadata: {
    tier: "pro",                        // our internal stable ID
    tier_rank: "1"                      // for sort order
  },
  tax_code: "txcd_10103001",            // "Software as a Service (SaaS)" — see tax_codes
  marketing_features: [...],             // rendered in Customer Portal
}
```

Three fields matter most:

- **`name`** — the human-readable string. Changing it changes what
  customers see. Treat it with the same care you'd treat public UI
  copy.
- **`metadata.tier`** — Contactly's stable, internal tier ID. Code
  that needs "is this subscription for the Pro product?" checks
  `subscription.items[0].price.product.metadata.tier === 'pro'`, never
  the Stripe product ID.
- **`tax_code`** — tells Stripe Tax how to tax the product. For a SaaS
  on `2026-03-25.dahlia` the right code is `txcd_10103001` ("Software
  as a Service (SaaS) - business use"). Pick this once, at product
  creation, and never change it without also checking your existing
  Subscriptions.

## Anatomy of a Price

```typescript
{
  id: "price_def456",                   // Stripe-assigned, unstable across re-seeds
  product: "prod_abc123",               // parent Product
  unit_amount: 1900,                    // cents — always an integer, never a float
  currency: "usd",
  type: "recurring",                    // vs. "one_time"
  recurring: {
    interval: "month",                  // or "year"
    interval_count: 1,                  // rare to change — `interval_count: 3` = quarterly
    usage_type: "licensed"              // flat-rate; "metered" = usage-based billing
  },
  lookup_key: "contactly_pro_monthly",  // **stable**, usable in place of the ID
  active: true,
  tax_behavior: "exclusive",            // tax is added on top of unit_amount
  billing_scheme: "per_unit"            // simple flat rate; "tiered" is multi-tier pricing
}
```

### Prices are immutable

**This is the one Stripe rule you'll violate if you're not careful.**
A Price's `unit_amount`, `currency`, `recurring.interval`,
`billing_scheme`, and `tax_behavior` are **immutable** once created.
If you need to change a price, you create a **new** Price, move the
`lookup_key` from old → new (using `stripe prices update
--transfer-lookup-key`), and archive the old Price. Existing
subscriptions keep billing at the old price (Stripe grandfathers
them); new checkouts use the new one.

This is why ADR-007 mandates referencing prices by `lookup_key`
everywhere in our code — when prices rotate, the code doesn't change;
only the pointer does.

### Cents, not dollars

Stripe `unit_amount` is always an integer in the currency's smallest
unit:

| Currency | Smallest unit | $19.00 as `unit_amount` |
| -------- | ------------- | ----------------------- |
| USD      | cent          | `1900`                  |
| EUR      | cent          | `1900`                  |
| JPY      | yen (no sub)  | `19`                    |

Never use floats. `19.00 * 100` in JavaScript is famously
`1900.0000000000002` in some edge cases. Store and transmit as
integers; format only at the render edge.

## Lookup keys: the single most important habit of this module

A **lookup key** is a string you assign to a Price that you, the
developer, get to choose. It must be unique within your Stripe account
(across both test and live modes — they don't collide, but they
share the namespace).

Stripe's API accepts lookup keys anywhere a Price ID is accepted:

```typescript
// Works
stripe.checkout.sessions.create({
	line_items: [{ price: 'price_1MHdNjBkN7BKmdD...' }]
});

// Also works, and 1000× more maintainable
stripe.checkout.sessions.create({
	line_items: [
		{
			price: (await stripe.prices.list({ lookup_keys: ['contactly_pro_monthly'] })).data[0].id
		}
	]
});
```

In Module 7 we'll cache the lookup-key → price-ID mapping in a
`public.stripe_prices` table so the extra round-trip only happens on
webhook processing, not on every checkout. But the contract in code is
_always_ the lookup key.

### Naming convention

We enforce a convention so keys stay searchable and sortable:

```text
<app>_<tier>_<interval>
contactly_pro_monthly
contactly_pro_yearly
contactly_business_monthly
contactly_business_yearly
```

- `<app>` prefix prevents collisions if this Stripe account hosts more
  than one product over its lifetime.
- `<tier>` matches the `metadata.tier` on the parent Product.
- `<interval>` is `monthly` or `yearly` — **not** `month`/`year`; we
  use English adjective form so `grep contactly_pro_monthly` is
  unambiguous.

Lesson 5.6 bakes these four keys into a typed `LookupKey` union in
`src/lib/billing/lookup-keys.ts`, and Lesson 5.5 creates the four
Prices with these exact keys via the Stripe fixtures file.

## Tax behavior

Every price in ADR-006 is `tax_behavior: 'exclusive'`. That means the
`unit_amount` is the pre-tax headline price, and Stripe Tax computes
a tax line at checkout based on the customer's collected billing
address. The customer sees:

```text
Contactly Pro (monthly)         $19.00
Tax (8.875%)                     $1.69
─────────────────────────────────────
Total                           $20.69
```

The alternative (`'inclusive'`) is valid for markets where regulation
requires showing tax-included prices (EU retail). Our initial market
is US B2B SaaS, so exclusive is correct. Module 12.5 covers the
decision point if you launch in the EU.

## Quick reference before Lesson 5.5

- Product = what; Price = how much.
- Starter is not a Stripe resource.
- Prices are immutable — rotate via new Price + lookup_key transfer.
- Money is integers, not floats.
- Every Contactly price is `tax_behavior: 'exclusive'`,
  `currency: 'usd'`, `recurring.usage_type: 'licensed'`.
- Every Contactly price has a lookup key following the
  `contactly_<tier>_<interval>` convention.

In the next lesson we create all six objects (2 products + 4 prices)
in one CLI command, driven by a version-controlled fixtures file.
