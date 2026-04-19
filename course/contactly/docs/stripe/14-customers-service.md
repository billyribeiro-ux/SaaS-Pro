# 14 — Customers Service (Module 7.3)

`stripe_customers` exists since Module 6.4 — it maps each Contactly
user to the Stripe `cus_…` that bills them. This lesson lands the
service that fills the table and keeps it in sync:
`src/lib/server/billing/customers.ts`.

Per ADR-002 this mapping is **per-user**, not per-organization. A
user who joins three organizations still has exactly one
`stripe_customer_id`; the entitlements they pay for travel with them.

## The single entry point: `ensureStripeCustomer`

There is one supported way to obtain "the Stripe customer for user X"
across the entire codebase:

```ts
const customerId = await ensureStripeCustomer({ userId, email });
```

The contract is:

- If `stripe_customers` already has a row for this `userId`, return
  the cached `stripe_customer_id`. Zero Stripe API calls. ~2 ms.
- Otherwise, create a Stripe customer (with an idempotency key so
  concurrent calls coalesce), upsert the mapping, return the new id.
  One Stripe API call. ~150-300 ms.

Two design choices keep this honest:

### Read-first, create-second

The cache check happens _before_ any Stripe API call. The hot path
(returning visitor opens checkout again) costs one indexed Postgres
read and is the dominant traffic pattern. Reversing the order — call
Stripe with idempotency-key, let it tell us about the existing
customer, then update the cache — also works but burns a Stripe API
call per checkout open which adds up against the rate limit.

### Idempotency keys, not lock tables

If two parallel requests for the same `userId` both miss the cache,
both `customers.create` calls would land at Stripe and create _two_
customers — one of which loses the `stripe_customers` upsert race
and ends up orphaned (no row in our DB pointing at it; a ghost in
the dashboard with no traffic ever billed against it).

The fix is the second argument to `customers.create`:

```ts
{
	idempotencyKey: `ensure-customer-user-${userId}`;
}
```

Stripe holds idempotency keys for 24 hours. Any second `create` call
with the same key during that window returns the **exact same
customer object** that the first call produced. The two parallel
calls collapse server-side at Stripe; both winners receive the same
`cus_…`; both upserts target the same row; the second is a no-op
courtesy of `onConflict: 'user_id'`.

We use a deterministic key (`ensure-customer-user-${userId}`) rather
than a UUID precisely so concurrent calls collide. UUIDs would
defeat the idempotency entirely.

## The webhook handlers

| Event              | Handler                 | Behavior                                                  |
| ------------------ | ----------------------- | --------------------------------------------------------- |
| `customer.created` | `handleCustomerCreated` | Upsert if `metadata.user_id` is set; warn-and-skip if not |
| `customer.updated` | `handleCustomerUpdated` | Update cached `email` by `stripe_customer_id`             |
| `customer.deleted` | `handleCustomerDeleted` | Physical DELETE of the local mapping                      |

### Why `customer.created` is mostly a duplicate

The most common reason `customer.created` fires is our own
`ensureStripeCustomer` call moments earlier — the upsert in the
service races the upsert in the webhook handler, and `onConflict:
'user_id'` makes that race a no-op.

Why subscribe at all? **Out-of-band creation.** A support agent in
the Stripe Dashboard can create a customer manually (e.g. to issue a
manual invoice). If they set `metadata.user_id` on the new customer,
the webhook adopts the mapping into our table. If they don't (the
common case for one-off customers that aren't tied to a user), we
log a warning and skip — never invent a mapping out of thin air.

### Out-of-band UPDATE: the email-edit case

`customer.updated` fires for any change to a customer record. The
most common edit Contactly cares about is **email**: a support agent
correcting a typo, the Customer Portal collecting a new email during
a payment-method update. We store the email as a snapshot column on
`stripe_customers` (it's the address Stripe will dispatch invoices
to), and this handler keeps that snapshot fresh.

Other Stripe-side changes (default payment method, address, tax
exemption…) don't have a column on our table — we don't need to
mirror them locally because the Customer Portal renders them straight
from Stripe on demand.

### Why `customer.deleted` is a hard delete

Unlike products and prices (which we soft-delete because historical
rows reference them), the `stripe_customers` row is purely a forward
mapping: `user_id → stripe_customer_id`. Once the Stripe customer is
gone, the mapping points at a 404. Better to drop the row so the
next `ensureStripeCustomer` call rebuilds a fresh mapping with a
brand-new customer.

Historical data (subscriptions, events) lives in dedicated tables and
references the `stripe_customer_id` _string_ directly — it doesn't
need the mapping row to render an old invoice's customer email.

## Why no `withIdempotencyKey` on the webhook upserts?

The dispatch table in `stripe-events.ts` already runs every event
through `recordStripeEvent` (Lesson 6.4) — a `customer.created`
event delivered three times by Stripe runs the upsert exactly once
because the second and third deliveries return `'already-processed'`
and skip dispatch entirely.

Idempotency keys on `customers.create` are about a different race:
two of _our_ requests for the same user, neither yet committed. The
webhook delivery race is solved at the storage layer.

## Test surface

`customers.test.ts` covers (with the Supabase + Stripe SDK both
mocked):

- `ensureStripeCustomer`:
  - cache hit → no Stripe call, no upsert
  - cache miss → Stripe `customers.create` with the idempotency key,
    upsert with `onConflict: 'user_id'`
  - cache miss without `email` → `email` omitted from the create body
  - cache-read failure → throws (caller surfaces 5xx)
  - upsert failure after a successful create → throws
- `handleCustomerCreated`:
  - happy path with `metadata.user_id` → upsert
  - missing `metadata.user_id` → warn + skip, no upsert
- `handleCustomerUpdated`:
  - email update by `stripe_customer_id`
  - DB error → throws
- `handleCustomerDeleted`:
  - physical delete by `stripe_customer_id`
  - DB error → throws

Total in this file: 11 assertions. Combined with the catalog suite
the running unit-test count is **55** (up from 44).

## What's next

Module 7.4 lands `subscriptions.ts` — the last service. It owns:

- `customer.subscription.created/updated/deleted/trial_will_end`
  webhook handlers, mirroring into `stripe_subscriptions`
- `getActiveSubscription(userId)` — the read used by the account
  page and every entitlement check
- `tierForUser(userId)` — the lookup-key-aware resolver that turns
  "user has this active subscription" into "user has tier `pro`"

After 7.4 the dispatch table from Lesson 6.3 has every stub replaced
with a real handler.
