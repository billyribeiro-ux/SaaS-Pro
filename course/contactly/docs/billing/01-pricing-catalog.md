# 01 — Pricing catalog view-model (Module 8.1)

Module 7 closed the bridge from "Stripe says you subscribed" to "your
tier in our DB is `pro`." Module 8 builds the **UI side of that
bridge**: a public `/pricing` page, a plan badge in the app shell, a
"current plan" section on `/account`, and the first fail-closed
feature gate.

This first lesson is the boring-on-purpose preamble: the **view-model**
the next four lessons all consume. We turn the raw rows that come out
of `listActivePlans()` (Lesson 7.2) into a typed pricing-card model
the marketing page can render in two lines.

## Why a separate module

The marketing page wants three cards (`Starter`, `Pro`, `Business`)
with two billing intervals on each paid card and a curated marketing
bullet list. That's a different shape than what comes out of the DB:

```text
listActivePlans() → ActivePlanRow[]
   { price_id, lookup_key, unit_amount, currency, recurring_interval,
     product_id, product_name, product_description, product_metadata }
```

If we did the reshape inline in `+page.server.ts`, three things would
happen:

1. The page becomes hard to test — every assertion needs Supabase + a
   seed file in scope.
2. The "Starter is the absence of a Stripe product" fact (ADR-007)
   leaks into the template as `if (!card) renderStarter()` everywhere
   it's needed (pricing page, account page, plan-badge component).
3. Currency formatting drifts. Two callers each write
   `(cents/100).toFixed(2)` slightly differently and you ship a
   pricing page that says `$19.00/mo` next to `$19/mo`.

Putting the transform in `src/lib/billing/catalog.ts` means the page
becomes a one-liner, the model is unit-tested without I/O, and there
is exactly one place that knows how to format a Contactly price.

## What the model looks like

```ts
type PricingCard = {
	tier: 'starter' | 'pro' | 'business';
	name: string;
	tagline: string;
	features: readonly string[];
	recommended: boolean;
	prices: {
		monthly: CatalogPrice | null;
		yearly: CatalogPrice | null;
	};
};

type CatalogPrice = {
	priceId: string;
	lookupKey: LookupKey;
	unitAmount: number; // cents — never coerce to dollars in the model
	currency: string;
	interval: 'monthly' | 'yearly';
	formatted: string; // "$19/mo" or "$190/yr"
	monthlyEquivalentCents: number | null; // 1583 for $190/yr
};
```

`monthlyEquivalentCents` lets the page render
`"$15.83/mo billed annually"` next to the headline yearly price
without re-doing the math in the template — that math is part of the
model.

## Three rules the function obeys

1. **Starter is always card #0**, even when the input is empty.
   Starter is the absence of a Stripe subscription, not a row in the
   mirror; the catalog hard-codes it from
   `STATIC_TIER_COPY.starter`.
2. **Unknown lookup keys are ignored.** A row with
   `lookup_key=NULL` is a one-off SKU somebody created in the
   Dashboard for a private demo — it has no business on a public
   pricing page.
3. **Recurring + non-null `unit_amount` only.** A free-trial-only
   price or a deleted-but-still-active row gets dropped.

These rules live in code, not in the consumer. `buildPricingCatalog`
returns `[Starter, Pro, Business]` no matter what.

## Locale-stable formatting

`Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
runs identically on the server (during SSR) and on the client (after
hydration). Skip the locale and you get `$19.00` from Vercel and
`19,00 $US` from a French browser, and Svelte trips a hydration
mismatch warning the moment the page mounts. The locale is locked in
the formatter; v1 is USD-only by ADR-007. When we ship multi-currency
in Module 13+, the locale becomes a function of the currency, not the
visitor.

The trailing suffix (`/mo` or `/yr`) is concatenated **after** the
formatter runs because it's not part of the currency at all — it's a
billing-interval label. Letting `Intl.NumberFormat` see it would
double the symbols (`$19.00 USD/mo`).

## Marketing copy lives next to the model

`STATIC_TIER_COPY` is the source of truth for the bullet lists each
tier card displays. We could store this in Stripe product metadata,
but:

- Stripe metadata is a flat string-string map; structured bullets
  would have to be JSON-encoded into a single field, which is its own
  maintenance fire.
- Marketing copy changes for marketing reasons (a new feature
  shipped, a wording test, a re-pitch) that have nothing to do with
  billing. Coupling that to a Stripe edit is wrong.
- Numeric caps that show up in copy ("Up to 25 contacts") are
  duplicated from the entitlement enforcement (Lesson 8.5). The
  duplication is intentional — the copy might intentionally round
  ("Unlimited" vs "100,000") and forcing the page to read from the
  enforcement constants would prevent that editorial freedom.

If you need to A/B test copy, swap `STATIC_TIER_COPY` with a function
that takes the visitor's bucket. Don't push this responsibility to
Stripe.

## Tests

Twelve cases in `catalog.test.ts`, all pure (no Stripe, no Supabase):

- Starter is always present and always first
- Empty input still returns three cards (Starter + empty Pro/Business)
- Pro is the only `recommended: true` card
- USD prices format to `$19/mo` / `$190/yr`
- `monthlyEquivalentCents` is `null` for monthly, `1583` for $190/yr
- Yearly hides cleanly when only the monthly row is in the mirror
- Rows with `lookup_key=NULL`, `unit_amount=NULL`, or an unknown
  recurring interval are dropped
- Every fixture lookup key resolves through the catalog (smoke test
  vs `lookup-keys.ts`)
- `formatCurrency` returns the same string the cards print

The unit test is what makes the rest of Module 8 pleasant — every
later lesson can assume the model is correct without simulating a DB.

## Next

Lesson 8.2 wires `buildPricingCatalog` into a real
`/pricing` route, with a Tailwind-styled four-card grid, a monthly /
yearly interval toggle, and conditional CTAs (`Sign up` for guests,
`Dashboard` for authenticated users — `Subscribe` arrives in Module 9
when Checkout lands).
