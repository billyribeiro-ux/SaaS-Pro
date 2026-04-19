# 13 — Products Service (Module 7.2)

`stripe_products` and `stripe_prices` exist (Module 7.1) but they're
empty. This lesson lands the module that fills them — and keeps them
filled — `src/lib/server/billing/products.ts`.

## What lives in this module

| Export                    | Direction                             | Called from                                    |
| ------------------------- | ------------------------------------- | ---------------------------------------------- |
| `upsertStripeProduct(p)`  | webhook → DB                          | `product.created` / `product.updated` handlers |
| `upsertStripePrice(p)`    | webhook → DB                          | `price.created` / `price.updated` handlers     |
| `deleteStripeProduct(id)` | webhook → DB (archives, never purges) | `product.deleted` handler                      |
| `deleteStripePrice(id)`   | webhook → DB (archives)               | `price.deleted` handler                        |
| `syncStripeCatalog()`     | Stripe API → DB (one-shot backfill)   | `pnpm run stripe:seed` (Module 8.2), recovery  |
| `listActivePlans()`       | DB → caller                           | Pricing page (Module 8.4)                      |

The split into write helpers + a single read helper is intentional:
the pricing page never calls Stripe; webhook handlers never read from
the DB. Each side has exactly one direction of dependency, which
makes the test surface trivial.

## Wiring into the dispatch table

Lesson 6.3 left the dispatch table populated with `console.info`
stubs. Now `stripe-events.ts` actually does work for six new event
types:

```ts
'product.created':  async (e) => upsertStripeProduct(e.data.object as Stripe.Product),
'product.updated':  async (e) => upsertStripeProduct(e.data.object as Stripe.Product),
'product.deleted':  async (e) => deleteStripeProduct((e.data.object as Stripe.Product).id),
'price.created':    async (e) => upsertStripePrice(e.data.object as Stripe.Price),
'price.updated':    async (e) => upsertStripePrice(e.data.object as Stripe.Price),
'price.deleted':    async (e) => deleteStripePrice((e.data.object as Stripe.Price).id),
```

The `SUBSCRIBED_EVENTS` tuple grew accordingly. Per-event coverage
is enforced at compile time by the `EventHandlers` mapped type from
Lesson 6.3 — adding a string to the tuple without adding a handler is
a `tsc` error.

## Two write paths, one DB shape

Every external surface that needs to put a product or price into our
mirror tables routes through `upsertStripeProduct` /
`upsertStripePrice`. There are exactly two callers:

1. **The webhook dispatch table.** Real-time. This is where 99% of
   the writes come from once the system is running.

2. **`syncStripeCatalog()`.** Walks every product and price the
   Stripe account knows about and upserts each. Used to seed an
   empty mirror, used during disaster recovery, and used after
   reseeding test mode (when a long flight of webhooks would have
   missed delivery).

There is no third caller — no SQL `INSERT` in a `+page.server.ts`,
no UI-driven catalog editor (Stripe is the editor). Centralizing the
write path keeps the `productRowFor` / `priceRowFor` translation
honest in exactly one place.

## Two pure helpers worth highlighting

```ts
function productRowFor(product: Stripe.Product): ProductInsert { ... }
function priceRowFor(price: Stripe.Price): PriceInsert { ... }
```

Both are **pure functions** — they take a Stripe payload, return a
DB-row-shaped object, no I/O. That separation:

- Makes the unit tests trivial (no Supabase mock needed for the
  translation layer; the Supabase mock only matters for the upsert
  call wrapping it).
- Lets us add future fields to the schema without touching the I/O
  helpers — only the row builder grows.
- Matches the pattern we'll use again in `customers.ts` and
  `subscriptions.ts`.

`priceRowFor` carries one piece of validation worth calling out:

```ts
if (price.type === 'recurring' && !price.recurring) {
	throw new Error(`[products] price ${price.id} reports type='recurring' but recurring is null...`);
}
```

This invariant is enforced again at the database level by the
`stripe_prices_recurring_consistency` check constraint from Lesson
7.1. Catching it at the application layer makes the error message
reference the offending price id, which is a human-readable handle;
the DB constraint would only mention the constraint name. Belt and
braces.

## Out-of-order delivery: the FK race

Stripe ships webhooks in roughly the order they happen, but DOES NOT
guarantee strict ordering across resource types. Concretely: a brand-
new price's `price.created` may arrive _before_ its parent product's
`product.created` — the price webhook hits our endpoint, we try to
upsert into `stripe_prices`, and the FK to `stripe_products(id)`
fails because we don't have the product yet.

`upsertStripePrice` handles this defensively:

```ts
if (error.code === '23503') {
	// foreign_key_violation
	const product = await stripe().products.retrieve(productId);
	await upsertStripeProduct(product); // backfill the parent
	/* retry the price upsert exactly once */
}
```

One Stripe round-trip on the rare race is far cheaper than:

- Buffering the price webhook and replaying it (state to manage,
  bug surface).
- Returning 500 and relying on Stripe's retry to coincidentally
  arrive after the product webhook (timing-dependent, fragile).

The retry is bounded to **one attempt**. If the second upsert also
hits FK, the parent really doesn't exist in Stripe (data corruption
on Stripe's side, vanishingly rare) and we throw a clear error.

## Soft-delete on `*.deleted`

`product.deleted` and `price.deleted` _do not_ DELETE the local row.
They flip `active = false`. Two reasons:

1. `stripe_subscriptions.price_id` may still reference an archived
   price — for example, a customer signed up two years ago at the
   old grandfathered rate that we've since archived. Their
   subscription row + invoice rendering still need the price's name
   and amount. Hard-deleting would break those joins.

2. Stripe's data model archives rather than purges; we mirror that.

`listActivePlans()` filters on `active = true` for both the price
and the joined product, so archived rows transparently disappear from
the pricing page without any extra logic.

## `listActivePlans()`: the only public reader

```ts
export type ActivePlanRow = {
	price_id: string;
	lookup_key: string | null;
	unit_amount: number | null;
	currency: string;
	recurring_interval: 'day' | 'week' | 'month' | 'year' | null;
	product_id: string;
	product_name: string;
	product_description: string | null;
	product_metadata: Json;
};

export async function listActivePlans(): Promise<ActivePlanRow[]>;
```

Returns one row per active recurring price, joined with its (active)
product, sorted by `metadata.tier_rank` ascending and then `monthly`
before `yearly`. The pricing page (Module 8.4) renders this list
directly — no further sort, no further filter. The result type is
the **only** thing the pricing page ever sees from the billing layer,
which gives us a clean refactor surface if we ever want to switch the
storage from Postgres to Redis or whatever else.

## Test surface

`products.test.ts` covers, with the Supabase client mocked at the
`withAdmin` boundary:

- `upsertStripeProduct`: row mapping, DB error throws, `tax_code`
  expanded-object handling.
- `upsertStripePrice`: row mapping, one-time price, malformed-recurring
  rejection, FK-miss → backfill → retry, non-FK error throws,
  retry-still-fails throws.
- `deleteStripeProduct` / `deleteStripePrice`: archive-not-purge,
  failure throws.
- `listActivePlans`: sort order, inactive-product filter, DB-error
  throws.

The webhook receiver's existing test (`server.test.ts`) doesn't need
to change — the dispatch table change is invisible from its viewpoint
(it tests "valid event → 200; invalid signature → 400"). The
`stripe-events.test.ts` file picks up the new mock so the dispatch
iteration still works.

## What's next

Module 7.3 lands `customers.ts` — the `ensureStripeCustomer(userId)`
lazy creation flow plus `customer.created/updated/deleted` webhook
handlers. After that, Module 7.4 lands `subscriptions.ts`, which
finally turns `customer.subscription.*` from a `console.info` stub
into a real entitlement-aware mirror.
