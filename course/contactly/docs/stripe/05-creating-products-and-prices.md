# Lesson 5.5 — Creating Products & Prices

The pricing model from Lesson 5.4 is a contract. This lesson turns it
into six real resources in your Stripe test account (2 Products + 4
Prices), driven by a version-controlled JSON file so any engineer on
the team can reproduce the catalog bit-for-bit in seconds.

## Why fixtures, not the Dashboard

A thousand developers click around the Dashboard, get bored halfway,
and ship misconfigured Products with missing tax codes and typos in
the description. Then a month later someone tries to bootstrap a
second test account and nobody remembers what they clicked.

A **fixtures file** (`stripe/fixtures/products.json`) is:

- **Reviewable.** Every change lands in a PR, gets two approvals, and
  has a diff.
- **Reproducible.** Any new test account on any new laptop becomes
  production-identical with one command.
- **Version-controlled.** When we change Pro's description in Q4, we
  change it in this file and commit — the old description lives in
  `git blame`.

This is Infrastructure-as-Code for Stripe, and it's the
principal-engineer default for every SaaS.

## The file

Open [`stripe/fixtures/products.json`](../../stripe/fixtures/products.json).
The Stripe CLI's `fixtures` command reads a JSON document of this
shape:

```json
{
	"fixtures": [
		{ "name": "product_pro",       "path": "/v1/products", "method": "post", "params": { ... } },
		{ "name": "price_pro_monthly", "path": "/v1/prices",   "method": "post", "params": { "product": "${product_pro:id}", ... } },
		...
	]
}
```

Four things to note in our file:

1. **Stable, user-specified product IDs.** `prod_contactly_pro` and
   `prod_contactly_business`, not the Stripe-generated
   `prod_abc123`-style. This means re-running the fixture after a
   successful seed will fail with `resource_already_exists` — which
   is the intended behavior. Idempotency by failing loudly is
   correct for a catalog seed; silent upsert would hide drift.
2. **Prices don't have user-specified IDs.** Prices use Stripe's
   auto-generated `price_xxx` IDs, because re-running the fixture
   after updating a unit amount is a legitimate operation (Prices are
   immutable — Lesson 5.4 — so a "change" is always a new object).
   The `lookup_key` plus `transfer_lookup_key: true` migrates the
   stable key from the old Price to the new one. Old Subscriptions
   keep billing at the old Price; new checkouts use the new one.
3. **Tax code `txcd_10103001`.** The Stripe Tax code for "Software as
   a Service (SaaS) — business use". If you sell something other than
   SaaS, look up the correct code at
   <https://docs.stripe.com/tax/tax-codes>.
4. **`metadata.tier` and `metadata.tier_rank`.** The tier is the
   stable internal identifier (ADR-007) — Contactly's code
   **never** hard-codes Stripe product IDs. The rank is a sort hint so
   a pricing-page renderer can order Pro before Business without
   hard-coding an array.

## Run it

From a terminal authenticated with `stripe login` (Lesson 5.3):

```bash
cd course/contactly
pnpm run stripe:fixtures
```

Which executes:

```bash
stripe fixtures stripe/fixtures/products.json
```

Successful output looks like:

```text
Setting up fixture for: product_pro
Running fixture for: product_pro
Setting up fixture for: price_pro_monthly
Running fixture for: price_pro_monthly
...
```

And the Dashboard (Product catalog → Products, test mode) immediately
shows two new products, each with two attached prices. The Prices
column shows the lookup keys we specified, so you can eyeball that the
naming convention held.

## Verify from the CLI

Eyeballing is not verification. Three one-liners prove the catalog is
the shape we expected:

```bash
stripe products list --limit 5 --active --format json \
  | jq '.data[] | {id, name, metadata}'

stripe prices list --limit 10 --active --format json \
  | jq '.data[] | {lookup_key, unit_amount, currency, "interval": .recurring.interval, tax_behavior, "product": .product}'

# And the one we'll use most: given a lookup key, get the current Price
stripe prices list --lookup-keys contactly_pro_monthly --format json \
  | jq '.data[0]'
```

`jq` is optional but worth installing — `brew install jq`, `apt
install jq`.

## Re-running after a change

The right way to change a price:

1. Edit `unit_amount` in `products.json`.
2. Run `pnpm run stripe:fixtures` — the CLI creates a new Price and
   moves the lookup_key onto it (thanks to `transfer_lookup_key: true`).
3. Commit the JSON change.
4. The old Price still exists in Stripe (immutable, and still billing
   grandfathered Subscriptions) but is no longer referenced by its
   lookup key. Archive it in the Dashboard if you want it to
   disappear from the Product → Prices tab.

The wrong way: open the Dashboard and "edit" the Price. You cannot —
those fields are grayed out. Stripe makes the correct behavior the
only available behavior; this is the platform doing you a favor.

## Re-seeding from scratch

If you need to wipe the Contactly catalog (e.g. test account pollution
from an experiment):

```bash
pnpm run stripe:cleanup   # Lesson 5.7, archives every active Contactly object
```

You cannot actually _delete_ a Stripe Product that has ever had a
Subscription or a successful Invoice against it (the Dashboard button
is disabled). Archival is the supported equivalent; our cleanup script
handles it.

## Hand-off to Lesson 5.6

The fixtures file defines the four lookup keys:

```text
contactly_pro_monthly
contactly_pro_yearly
contactly_business_monthly
contactly_business_yearly
```

Lesson 5.6 makes these a **typed union** in TypeScript, so any future
code path that accepts a lookup key gets autocomplete, and a typo
becomes a compile error instead of a runtime 404.
