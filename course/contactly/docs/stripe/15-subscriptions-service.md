# 15 — Subscriptions Service (Module 7.4)

The dispatch table from Lesson 6.3 still has stub bodies for the
`customer.subscription.*` events. This lesson lands the last service
that turns those stubs into real database writes — and the two
read-side helpers that every authenticated page in the app will hit:

```ts
upsertSubscription(subscription); // webhook → DB
handleSubscriptionDeleted(subscription); // webhook → DB
handleSubscriptionTrialWillEnd(subscription); // webhook → email later

getActiveSubscription(userId); // DB → page
tierForUser(userId); // DB → page (entitlement)
```

After this lesson, the bridge from "Stripe says you subscribed" to
"the contact-list cap relaxes for you" is fully closed.

## API version 2026-03-25.dahlia: period fields moved

A quirk worth understanding before reading the code. In the API
version we pinned in Lesson 6.1, `current_period_start` and
`current_period_end` were **removed from the Subscription object and
moved to subscription items**. The Stripe changelog calls it a
breaking change.

Concretely:

```ts
// Pre-2025-03 (Acacia and earlier):
subscription.current_period_start;
subscription.current_period_end;

// 2025-03 (Basil) onwards, including 2026-03-25 (Dahlia):
subscription.items.data[0].current_period_start;
subscription.items.data[0].current_period_end;
```

Contactly subscriptions are always single-item (one Pro or Business
price each), so we read item `[0]` and treat its period as the
subscription's period:

```ts
function readItemPeriod(subscription: Stripe.Subscription) {
	const item = subscription.items?.data?.[0];
	if (!item) return { currentPeriodStart: null, currentPeriodEnd: null };
	/* … */
}
```

If a subscription ever has zero items (a transient state Stripe's
schema permits), we leave the period columns null and log a warning
rather than crash the webhook.

## The `rowFor(subscription)` translator

Translation from Stripe payload to local row is its own function for
the same reason as `productRowFor` and `priceRowFor`: pure function,
trivially unit-testable, single source of truth for what each column
gets.

It's the only function in the file that performs **filtering** —
returning `null` instead of a row in two cases:

1. **Unknown status.** `Stripe.Subscription.status` is wider than
   our enum because Stripe can grow their union before we do. An
   unknown status (`'something_new_stripe_added'`) returns `null`,
   logs a warning, and the upsert path skips entirely. Stripe gets a
   200, no DB write happens, no 500 retry storm starts. The next
   migration that adds the new status to our enum + service will
   accept the next delivery.

2. **No `stripe_customers` mapping.** A subscription whose customer
   isn't in our cache means a customer was created out-of-band
   without `metadata.user_id`. Skip silently — there's no user to
   attribute the subscription to.

Otherwise, the row is a faithful copy of the subscription, with:

- `tier_snapshot` = the price's `metadata.tier` (audit only — the
  entitlement decision uses lookup keys, see below).
- `cancel_at_period_end`, `trial_start/end`, `canceled_at`,
  `cancel_at` — all the cancellation metadata the account page needs
  to render "your subscription ends on …".

## The two FK races

Subscription writes can hit two different FK violations and we
handle them differently:

### `price_id` not in the mirror (`23503`, foreign_key_violation)

The `price.created` webhook for a brand-new Pro/Business price might
arrive AFTER the `customer.subscription.created` webhook for the
first customer who subscribed to it. The mirror has no row in
`stripe_prices` yet; the FK on `stripe_subscriptions.price_id`
fails.

Same defensive pattern as `upsertStripePrice` (which handles the
same race against `stripe_products`):

```ts
if (error.code === '23503') {
	const price = await stripe().prices.retrieve(row.price_id);
	await upsertStripePrice(price);
	/* retry exactly once */
}
```

Bounded to ONE retry. A second FK miss means the price genuinely
doesn't exist in Stripe and the throw is correct.

### Two active subscriptions for one user (`23505`, unique_violation)

The `stripe_subscriptions_one_active_per_user` partial unique index
from Lesson 7.1 guarantees a user can't have two trialing/active/
past_due subscriptions at once. The checkout endpoint (Module 9.1)
will refuse to create a second, but if Stripe ever delivers a
subscription that would violate this — bug, race, manual
`stripe.subscriptions.create` from the dashboard, whatever — we
**throw loudly** rather than try to recover:

```ts
if (error.code === '23505') {
	throw new Error('DUPLICATE active subscription for user; refusing to mirror...');
}
```

Why not auto-cancel one? Because the right action depends on
context: refund the new one, refund the old one, escalate to
support. The handler can't decide. The throw produces a 500 → Stripe
retries → we keep refusing → an alarm fires (Module 12.4 wires Sentry
to webhook 5xx) → a human looks at it. That's the correct flow for an
"impossible" event: refuse the write and ring the bell.

## `getActiveSubscription` and `tierForUser`

The two read helpers form the entire public read API of the billing
layer for authenticated pages:

```ts
const sub = await getActiveSubscription(user.id);
if (sub?.cancel_at_period_end) showRenewalNotice();

const tier = await tierForUser(user.id);
if (tier === 'starter') showUpgradePrompt();
```

`getActiveSubscription` filters on
`status in (trialing, active, past_due)` — the same set as the
partial unique index. The index makes `.maybeSingle()` safe at the
DB level.

`tierForUser` chains:

1. `getActiveSubscription` — null → return `'starter'`.
2. Read the subscription's `price_id` from `stripe_prices` to get
   the `lookup_key`.
3. If `lookup_key` is one of our four known keys, parse it through
   `parseLookupKey` (from Lesson 5.6) and return the `tier`.
4. If unknown or null, **fall back to `'starter'`** with a warning.

The fall-to-starter on unknown lookup keys is deliberate: feature
gates **fail closed**. If a future price gets attached to a
subscription before we've updated `LOOKUP_KEYS`, the user sees the
free tier rather than getting accidentally entitled to features. The
warning makes the desync loud in logs so it doesn't sit quietly.

### Why not read `tier_snapshot` directly?

The `tier_snapshot` column on `stripe_subscriptions` is a copy of
`price.metadata.tier`. Reading it for entitlement would skip the
join through `stripe_prices` — faster, fewer query, attractive.

We don't, because a tier rename in Stripe (renaming the metadata
value from `business` to `team`, say) would silently change every
user's tier without a code change. The lookup-key path forces tier
changes to come through code, where a `parseLookupKey` won't return
something the rest of the codebase doesn't know about. The snapshot
stays as an audit / analytics column.

## Updated dispatch table

After this lesson, every event in `SUBSCRIBED_EVENTS` has a real
handler:

| Event                                  | Handler                                |
| -------------------------------------- | -------------------------------------- |
| `product.created` / `.updated`         | `upsertStripeProduct` (7.2)            |
| `product.deleted`                      | `deleteStripeProduct` (7.2)            |
| `price.created` / `.updated`           | `upsertStripePrice` (7.2)              |
| `price.deleted`                        | `deleteStripePrice` (7.2)              |
| `customer.created`                     | `handleCustomerCreated` (7.3)          |
| `customer.updated`                     | `handleCustomerUpdated` (7.3)          |
| `customer.deleted`                     | `handleCustomerDeleted` (7.3)          |
| `customer.subscription.created`        | `upsertSubscription` (7.4)             |
| `customer.subscription.updated`        | `upsertSubscription` (7.4)             |
| `customer.subscription.deleted`        | `handleSubscriptionDeleted` (7.4)      |
| `customer.subscription.trial_will_end` | `handleSubscriptionTrialWillEnd` (7.4) |
| `checkout.session.completed`           | console-stub → wired in Module 9.1     |
| `invoice.paid`                         | console-stub → wired in Module 9.5     |
| `invoice.payment_failed`               | console-stub → wired in Module 9.5     |

Three stubs remain — `checkout.session.completed`, `invoice.paid`,
and `invoice.payment_failed`. Those land alongside their natural
lessons in Module 9 (checkout flow, dunning, payment-failure UX).

## Test surface

`subscriptions.test.ts` adds 17 assertions covering:

- `upsertSubscription`: row mapping, unknown status skip, missing
  customer mapping skip, no-item throw, FK-on-price backfill+retry,
  unique-violation throw (the second-active-sub guard), generic DB
  error throw, trial fields mirroring.
- `handleSubscriptionTrialWillEnd`: logs only, no DB write (the email
  side-effect lands in Module 9.4).
- `getActiveSubscription`: row when present, null when not, throw on
  DB error.
- `tierForUser`: starter for no-sub, pro for `contactly_pro_*`,
  business for `contactly_business_*`, starter-fallback (with warn)
  for unknown lookup key, starter-fallback for missing price.

Total unit tests after this lesson: **72** (8 files), up from 55.

## What's next

Module 7 is complete. The bridge from Stripe events → our database →
the user's tier is in place. Module 8 builds on it:

- **8.1 — Create Products & Prices.** Run the fixtures locally and
  watch the catalog mirror fill via webhooks (you've already done
  this once in Lesson 5.5; this time the mirror tables will pick it
  up automatically).
- **8.2 — Seeding Stripe Data.** A `pnpm run stripe:seed` script
  that wraps `stripe:fixtures` + `syncStripeCatalog()` into one
  reproducible step.
- **8.3 / 8.4 — Pricing page config + render.** Reads `listActivePlans()`
  from Module 7.2 and renders the plan ladder.
