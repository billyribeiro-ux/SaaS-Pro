---
title: '7.4 - Subscriptions Service'
module: 7
lesson: 4
moduleSlug: 'module-07-billing-services'
lessonSlug: '04-subscriptions-service'
description: 'Build the subscriptions service that keeps Supabase in sync with Stripe subscription state.'
duration: 15
preview: false
---

## Overview

This is the lesson where billing becomes real. Products are marketing copy. Customers are address books. Subscriptions are **money** — the live financial relationship between your user and your business. Every feature gate in Contactly will read from the `subscriptions` table, and every one of them needs the data to be accurate within seconds of what Stripe thinks is true.

The subscription service is bigger than the others because subscriptions are bigger than the others. They have seventeen-ish relevant fields, multiple nullable time boundaries, a status machine with eight states, a nested `items` relationship that holds the actual price reference, and — as of Stripe v22 — a breaking API change that relocated two critical timestamp fields from the `Subscription` object to the `SubscriptionItem` inside it. All of that funnels through one `upsertSubscription` function.

We're also introducing `manageSubscriptionStatusChange` — a "fetch-fresh-then-upsert" helper that the webhook handler calls instead of trusting the event payload directly. This is the pattern that saves your bacon when events arrive out of order, when Stripe retries after a state transition, and when multiple events fire in rapid succession during checkout.

By the end of this lesson, your webhook handler will dispatch all six subscription-related events correctly. Every Stripe state change lands in your DB within a second. Your feature gates can start trusting what they read.

## Prerequisites

- Lessons 7.1, 7.2, 7.3 complete.
- `subscriptions`, `prices`, `customers` tables exist and are RLS-protected.
- Products and prices are flowing into your DB via webhook (you tested `stripe trigger product.created` and `stripe trigger price.created`).
- Stripe client initialized with **`apiVersion: '2026-03-25.dahlia'`** — this is the v22 API and it's where the `current_period_start/end` move happened.
- You've read the Stripe v22 migration notes. If not, skim https://stripe.com/docs/upgrades now; the relevant section is "Subscription fields moved to SubscriptionItem."

## What You'll Build

- `src/lib/server/billing/subscriptions.service.ts` with two exported functions: `upsertSubscription` and `manageSubscriptionStatusChange`.
- A `prices` upsert helper (if not already built) so `price.created`/`price.updated` events also land in the DB.
- Updated `src/routes/api/webhooks/stripe/+server.ts` with six new cases routing to the right service call.
- Clean handling of Stripe v22's `SubscriptionItem` restructuring, Unix-to-ISO time conversions, and the deleted-subscription `status = 'canceled'` pattern.

---

## Step 1: Stripe v22's SubscriptionItem Migration — What Changed

In every version of the Stripe API before `2025-11-20.acacia`, a `Subscription` looked like this (abbreviated):

```
Stripe.Subscription {
  id: 'sub_...',
  status: 'active',
  current_period_start: 1713398400,  // ← on the Subscription
  current_period_end: 1716076800,    // ← on the Subscription
  items: {
    data: [
      { id: 'si_...', price: {...}, quantity: 1 }
    ]
  },
  ...
}
```

In v22 (`2026-03-25.dahlia`, which is our pinned version), those two timestamps moved:

```
Stripe.Subscription {
  id: 'sub_...',
  status: 'active',
  // current_period_start / end GONE from here.
  items: {
    data: [
      {
        id: 'si_...',
        price: {...},
        quantity: 1,
        current_period_start: 1713398400,  // ← moved here
        current_period_end: 1716076800     // ← moved here
      }
    ]
  },
  ...
}
```

Why? Because a subscription _can_ have multiple items with staggered billing periods. The old model pretended there was one period per subscription; v22 makes it honest by putting the period on each item.

For Contactly — single-item subscriptions — we read `subscription.items.data[0].current_period_start` and that's our period start. For multi-item subs we'd need a more complex model, but we're not there and likely never will be.

If you ever copy/paste `upsertSubscription` code from the internet and see `subscription.current_period_start`, the code is pre-v22. TypeScript will flag it — `Property 'current_period_start' does not exist on type 'Subscription'` — and you should treat that as a forcing function to read the Stripe docs, not to `@ts-ignore` the error.

---

## Step 2: Add a `prices` Service

Before subscriptions, we need to be mirroring prices too — otherwise `subscriptions.price_id` foreign-keys to rows that don't exist yet. Add a small `upsertPrice` helper.

You can put this in its own file (`prices.service.ts`) or in `products.service.ts` — we'll do the latter for brevity since both are marketing-data upserts:

```typescript
// src/lib/server/billing/products.service.ts
import type Stripe from 'stripe';
import { supabaseAdmin } from '$server/supabase';

export async function upsertProduct(product: Stripe.Product): Promise<void> {
	const { error } = await supabaseAdmin.from('products').upsert({
		id: product.id,
		name: product.name,
		description: product.description ?? null,
		active: product.active,
		metadata: product.metadata,
		updated_at: new Date().toISOString()
	});
	if (error) {
		throw new Error(`Failed to upsert product ${product.id}: ${error.message}`);
	}
}

export async function upsertPrice(price: Stripe.Price): Promise<void> {
	const { error } = await supabaseAdmin.from('prices').upsert({
		id: price.id,
		product_id: typeof price.product === 'string' ? price.product : price.product.id,
		active: price.active,
		currency: price.currency,
		type: price.type,
		unit_amount: price.unit_amount,
		interval: price.recurring?.interval ?? null,
		interval_count: price.recurring?.interval_count ?? 1,
		lookup_key: price.lookup_key,
		metadata: price.metadata,
		updated_at: new Date().toISOString()
	});
	if (error) {
		throw new Error(`Failed to upsert price ${price.id}: ${error.message}`);
	}
}
```

Two small-but-important moves:

- **`price.product` is `string | Stripe.Product`** depending on whether the field was expanded. We handle both with a `typeof` check. When the webhook sends unexpanded events, it's the string ID; when we fetch with `expand: ['items.data.price.product']`, it's the full object. Either way we extract the ID.
- **`price.recurring` is nullable** for one-time prices. The `?.` chain handles that; we null out `interval` if it's not a recurring price.

---

## Step 3: The `upsertSubscription` Function

Create `src/lib/server/billing/subscriptions.service.ts`:

```typescript
// src/lib/server/billing/subscriptions.service.ts
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import type Stripe from 'stripe';

export async function upsertSubscription(subscription: Stripe.Subscription): Promise<void> {
	const { data: customer } = await supabaseAdmin
		.from('customers')
		.select('id')
		.eq('stripe_customer_id', subscription.customer as string)
		.single();

	if (!customer) {
		throw new Error(`No user found for customer ${subscription.customer}`);
	}

	const item = subscription.items.data[0];

	const { error } = await supabaseAdmin.from('subscriptions').upsert({
		id: subscription.id,
		user_id: customer.id,
		status: subscription.status,
		price_id: item?.price.id ?? null,
		quantity: item?.quantity ?? 1,
		cancel_at_period_end: subscription.cancel_at_period_end,
		cancel_at: subscription.cancel_at
			? new Date(subscription.cancel_at * 1000).toISOString()
			: null,
		canceled_at: subscription.canceled_at
			? new Date(subscription.canceled_at * 1000).toISOString()
			: null,
		current_period_start: item?.current_period_start
			? new Date(item.current_period_start * 1000).toISOString()
			: new Date().toISOString(),
		current_period_end: item?.current_period_end
			? new Date(item.current_period_end * 1000).toISOString()
			: new Date().toISOString(),
		ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
		trial_start: subscription.trial_start
			? new Date(subscription.trial_start * 1000).toISOString()
			: null,
		trial_end: subscription.trial_end
			? new Date(subscription.trial_end * 1000).toISOString()
			: null,
		metadata: subscription.metadata
	});

	if (error) {
		throw new Error(`Failed to upsert subscription ${subscription.id}: ${error.message}`);
	}
}

export async function manageSubscriptionStatusChange(subscriptionId: string): Promise<void> {
	const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
		expand: ['items.data.price.product']
	});
	await upsertSubscription(subscription);
}
```

Let's break it apart.

### Step 3a: Resolve user from customer

```typescript
const { data: customer } = await supabaseAdmin
	.from('customers')
	.select('id')
	.eq('stripe_customer_id', subscription.customer as string)
	.single();

if (!customer) {
	throw new Error(`No user found for customer ${subscription.customer}`);
}
```

Stripe's subscription object has `customer: string | Stripe.Customer | DeletedCustomer` (again, depends on expansion). In webhook payloads it's the string `cus_...`, so `subscription.customer as string` is safe — and we need the string anyway to match on our `stripe_customer_id` column.

We query `customers` by `stripe_customer_id` to get the Supabase `profiles.id` (stored as `customers.id` because of the shared PK). This is the mapping that 7.3 earned us.

If no matching customer row exists, we throw. Why? Because subscriptions should only arrive for users we've already provisioned. If we're seeing a Stripe subscription for a customer we don't know about, something is broken — maybe an edge case where a Stripe dashboard operator created a subscription by hand, or our `getOrCreateCustomer` flow failed but somehow checkout completed anyway. Either way, we want to loud-fail so Stripe retries and ops sees the error.

We could alternatively soft-fail and create the customer row on the fly by calling `stripe.customers.retrieve` and backfilling. For now, throwing is the conservative choice — it keeps our data model clean.

### Step 3b: Extract the subscription item

```typescript
const item = subscription.items.data[0];
```

For Contactly, every subscription has exactly one item. Even so, we use optional chaining downstream (`item?.price.id ?? null`) because a defensive habit is cheaper than a rare production crash. If Stripe ever sends us a zero-item subscription (which would be pathological, but let's not crash), we get null fields rather than a runtime error.

### Step 3c: The upsert payload — field by field

```typescript
id: subscription.id,
user_id: customer.id,
status: subscription.status,
price_id: item?.price.id ?? null,
quantity: item?.quantity ?? 1,
```

- `id` — Stripe subscription ID, our PK.
- `user_id` — resolved from the customers lookup.
- `status` — one of `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`. Pass through as-is.
- `price_id` — the price this sub is billing against. Foreign-keys to `prices.id`. Null if no items (shouldn't happen, but defensive).
- `quantity` — for per-seat pricing. Default 1.

```typescript
cancel_at_period_end: subscription.cancel_at_period_end,
cancel_at: subscription.cancel_at
  ? new Date(subscription.cancel_at * 1000).toISOString()
  : null,
canceled_at: subscription.canceled_at
  ? new Date(subscription.canceled_at * 1000).toISOString()
  : null,
```

- `cancel_at_period_end` — boolean, always present.
- `cancel_at` — when the scheduled cancellation takes effect. Nullable.
- `canceled_at` — when the cancellation was requested. Nullable.

**The `* 1000` is doing critical work.** Stripe returns timestamps as **Unix seconds** (number of seconds since 1970-01-01 UTC). JavaScript `Date` expects **milliseconds** since the same epoch. Convert with `* 1000`. Forget, and `new Date(1713398400)` gives you January 20, 1970 instead of April 2024.

`.toISOString()` formats the resulting Date into the ISO-8601 string Postgres `timestamptz` accepts: `"2024-04-17T20:00:00.000Z"`.

The conditional pattern — `value ? new Date(value * 1000).toISOString() : null` — is **mandatory for nullable Stripe timestamps**. `new Date(null * 1000)` is `new Date(0)`, which is epoch zero — wrong. You must short-circuit on null before converting.

```typescript
current_period_start: item?.current_period_start
  ? new Date(item.current_period_start * 1000).toISOString()
  : new Date().toISOString(),
current_period_end: item?.current_period_end
  ? new Date(item.current_period_end * 1000).toISOString()
  : new Date().toISOString(),
```

Here we read from `item` (the `SubscriptionItem`) — the **v22 location** for these fields. Fall back to `new Date().toISOString()` if absent, because these columns are `not null` in our schema. The fallback is a safety net; in practice every real Stripe subscription has period boundaries.

```typescript
ended_at: subscription.ended_at
  ? new Date(subscription.ended_at * 1000).toISOString()
  : null,
trial_start: subscription.trial_start
  ? new Date(subscription.trial_start * 1000).toISOString()
  : null,
trial_end: subscription.trial_end
  ? new Date(subscription.trial_end * 1000).toISOString()
  : null,
metadata: subscription.metadata
```

Same pattern for the rest: null-guard, then convert. `metadata` is a passthrough — Stripe's dict becomes our jsonb.

### Step 3d: The error guard

```typescript
if (error) {
	throw new Error(`Failed to upsert subscription ${subscription.id}: ${error.message}`);
}
```

Same pattern as every other service: throw, let the webhook handler return 500, let Stripe retry.

### Step 3e: `manageSubscriptionStatusChange`

```typescript
export async function manageSubscriptionStatusChange(subscriptionId: string): Promise<void> {
	const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
		expand: ['items.data.price.product']
	});
	await upsertSubscription(subscription);
}
```

Two decisions here.

**Why fetch instead of trusting the event payload?**

Webhook events contain a **snapshot** of the object at event-time. If three events fire in quick succession (`invoice.paid`, `customer.subscription.updated`, `customer.subscription.updated`), and they arrive at our server out of order, we could process them in the wrong sequence and end up with stale data.

`manageSubscriptionStatusChange` bypasses this by **fetching the current state from Stripe at handler-time** — guaranteeing we write the latest state, regardless of which event triggered us. If event 1 and event 2 both fire this helper, they both fetch the same (or newer) Stripe state, and both upserts converge on the correct final state. Idempotent and ordering-tolerant.

The cost is one extra API call per webhook (inside Stripe's rate limits easily, even at high traffic). The benefit is correctness.

**Why `expand: ['items.data.price.product']`?**

By default, Stripe returns `items[].price` as just an ID string. We want the full price object so we can extract `price.id` without another API call — and once we have the price, we want the `product` object expanded too so a later feature (like "which plan is this user on?" that wants the product name) can read it from the same payload.

Expansion is Stripe's way of saying "send me the nested object inline." Each level of `.` is one degree of nesting: `items.data.price.product` means "expand `price`, then within `price` expand `product`." You can do up to four levels in a single request.

We don't _need_ the product expanded for `upsertSubscription` itself — we never touch `product.name` in this function — but the cost of expanding is negligible and it positions us for future features. (Alternative: expand only what you immediately need, and trust that later features can ask for more. Valid take. We're going with the fatter expansion here for consistency with most Stripe-sample code.)

---

## Step 4: The Webhook Handler — All Six Cases

Now wire every subscription-related event into the service functions. Here's the full, updated `+server.ts`:

```typescript
// src/routes/api/webhooks/stripe/+server.ts
import { json, error } from '@sveltejs/kit';
import { stripe } from '$server/stripe';
import { upsertProduct, upsertPrice } from '$server/billing/products.service';
import {
	upsertSubscription,
	manageSubscriptionStatusChange
} from '$server/billing/subscriptions.service';
import { STRIPE_WEBHOOK_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';
import type Stripe from 'stripe';

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) error(400, 'Missing stripe-signature header');

	const rawBody = await request.text();

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		error(400, `Webhook signature verification failed: ${message}`);
	}

	try {
		switch (event.type) {
			case 'product.created':
			case 'product.updated': {
				await upsertProduct(event.data.object);
				break;
			}

			case 'price.created':
			case 'price.updated': {
				await upsertPrice(event.data.object);
				break;
			}

			case 'customer.subscription.created':
			case 'customer.subscription.updated':
			case 'customer.subscription.deleted': {
				await manageSubscriptionStatusChange(event.data.object.id);
				break;
			}

			case 'checkout.session.completed': {
				const session = event.data.object;
				if (session.mode === 'subscription' && session.subscription) {
					const subscriptionId =
						typeof session.subscription === 'string'
							? session.subscription
							: session.subscription.id;
					await manageSubscriptionStatusChange(subscriptionId);
				}
				break;
			}

			default:
				console.log(`Unhandled event type: ${event.type}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error(`Webhook handler error for ${event.type}:`, message);
		error(500, message);
	}

	return json({ received: true });
};
```

Six (really, seven) events handled. Let's go through each.

### `product.created` / `product.updated`

Calls `upsertProduct`. Covered in 7.2.

### `price.created` / `price.updated`

Calls `upsertPrice`. Same pattern as products — idempotent upsert of marketing-data.

Why not also `product.deleted` and `price.deleted`? Because Stripe doesn't actually delete products or prices; it archives them (`active: false`). The update handler catches the archive automatically. There is a `price.deleted` event for truly-removed test-mode prices, but handling it would mean cascading to subscriptions, and we don't want to delete a subscription just because its price was archived — existing subs keep their price reference until they end. For production: no action needed.

### `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`

All three fall through to `manageSubscriptionStatusChange(event.data.object.id)`. We explicitly do _not_ pass `event.data.object` to `upsertSubscription` directly — we pass the ID and let the fetcher refetch fresh state.

Why? Two reasons we already touched on:

1. Events can arrive out of order. Fetching gives us the latest state regardless.
2. `event.data.object` may not have the fields expanded the way we want — fetching with `expand: [...]` guarantees we have `items.data.price.product` available for future lookups.

Note: even on `customer.subscription.deleted`, we don't delete the row. We re-upsert with `status = 'canceled'` and `ended_at = <now>`. The Stripe subscription still exists in Stripe's archives — we keep our mirror for historical queries ("was this user a subscriber last March?" becomes a simple query).

### `checkout.session.completed`

This one's a bit different. When a user completes checkout, Stripe sends `checkout.session.completed` _before_ `customer.subscription.created` in most cases. The session object carries a `subscription` field pointing at the just-created subscription.

```typescript
const session = event.data.object;
if (session.mode === 'subscription' && session.subscription) {
	const subscriptionId =
		typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
	await manageSubscriptionStatusChange(subscriptionId);
}
```

A few guards:

- `session.mode === 'subscription'` — because `checkout.session.completed` also fires for `payment` mode (one-time purchases). We don't care about those right now; only subscription checkouts trigger the helper.
- `session.subscription` exists — defensive; should always be set for subscription mode.
- The `typeof` narrowing handles the same expand ambiguity as `price.product`.

Calling `manageSubscriptionStatusChange` from `checkout.session.completed` is our **belt-and-suspenders** — if the `customer.subscription.created` event gets delayed, rejected, or lost (rare but possible), the checkout event runs the same fetch-and-upsert and the DB gets populated anyway. Both events target idempotent code, so running both is harmless and running only one still succeeds.

---

## Step 5: Test With Stripe CLI Triggers

```bash
# Trigger each kind of event
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger checkout.session.completed
```

For each, you should see:

1. A `200 OK` response in the `stripe listen` terminal.
2. A new or updated row in the `subscriptions` table in Studio.

Note that Stripe's `trigger` command builds synthetic fixture data, which may fail the customer lookup (the fixture's `customer` won't exist in your `customers` table). That's fine — the expected behavior in that case is our function throws "No user found for customer..." and the webhook returns 500, and Stripe retries a handful of times before giving up. To test a full round-trip, do a real checkout flow in a browser against your local server (we build that in Module 8). For now, a 500 response from a synthetic trigger proves your code path is exercised.

---

## Common Mistakes

### Mistake 1: Reading `current_period_start` from the `Subscription` object

```typescript
// WRONG — pre-v22 code
current_period_start: new Date(subscription.current_period_start * 1000).toISOString();
```

Doesn't exist on `Stripe.Subscription` in v22 (`2026-03-25.dahlia`). TypeScript flags this. Correct is `subscription.items.data[0].current_period_start`.

### Mistake 2: Forgetting `* 1000` on Unix timestamps

```typescript
// WRONG
cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at).toISOString() : null;
```

Stripe gives seconds; JS Date takes milliseconds. Your `cancel_at` becomes January 20, 1970. Every Stripe timestamp needs `* 1000`.

### Mistake 3: `new Date(null * 1000)` — no null guard

```typescript
// WRONG
cancel_at: new Date(subscription.cancel_at * 1000).toISOString();
```

If `cancel_at` is null, `null * 1000` is `0`, `new Date(0)` is epoch, and your DB ends up with `1970-01-01` as the cancel time. Always guard: `value ? new Date(value * 1000).toISOString() : null`.

### Mistake 4: Passing `event.data.object` to `upsertSubscription` from the webhook

```typescript
// WRONG
case 'customer.subscription.updated': {
  await upsertSubscription(event.data.object)
  break
}
```

Works most of the time. Fails when events arrive out of order. Use `manageSubscriptionStatusChange(event.data.object.id)` which refetches — that's the whole point of the helper.

### Mistake 5: Deleting the subscription row on `customer.subscription.deleted`

```typescript
// WRONG
case 'customer.subscription.deleted': {
  await supabaseAdmin.from('subscriptions').delete().eq('id', event.data.object.id)
  break
}
```

Now your historical queries ("was user X ever a subscriber?") are broken forever. Stripe keeps canceled subscriptions in its archive; you should too. `manageSubscriptionStatusChange` correctly refetches the canceled-but-still-existing subscription and upserts `status = 'canceled'`.

### Mistake 6: Not expanding `items.data.price.product` when fetching

```typescript
// Possibly OK for now, but limiting
const subscription = await stripe.subscriptions.retrieve(subscriptionId);
```

Stripe returns `items.data[].price` as a string ID by default. If a later feature wants the product name, you'd have to make a separate API call to resolve it. Expanding at fetch time costs zero extra round-trips (Stripe does the join server-side) and positions you for future reads.

### Mistake 7: Accepting a `userId` that doesn't match the Stripe customer

If somehow two `customers` rows had different `stripe_customer_id` values but the same `id` (which would violate our PK uniqueness), `upsertSubscription` would pick up the wrong user. Our PK prevents this. But the lesson is: do not resolve `user_id` by any method other than looking up via `stripe_customer_id`. Don't pass `userId` as a separate parameter to this function — that's a trust-the-caller trap.

---

## Principal Engineer Notes

### The `SubscriptionItem` migration is a glimpse of real API evolution

Stripe's shift of `current_period_start/end` to `SubscriptionItem` wasn't arbitrary — it was Stripe acknowledging that their data model was wrong, and fixing it. Subscriptions with heterogeneous items (different billing frequencies, different start dates) were being shoehorned into a single-period model that couldn't represent them.

As a principal engineer, your job is to _anticipate_ these kinds of schema evolutions in external systems and design for adaptability:

- Keep your DB schema flexible for the common case (single-item subs → one period column pair).
- Write your service layer such that migrating to a new model is localized (one file change, not a codebase-wide grep).
- Read the changelog when upgrading major versions. Don't just bump package.json and pray.

We did the work here: our `upsertSubscription` reads from `item?.current_period_start`, so when v23 moves things again, the change is surgical. If we'd spread the conversion logic through ten route handlers, we'd have ten places to fix.

### Time units are a classic source of silent corruption

The `* 1000` mistake is _so_ common in Stripe integrations that a large fraction of all "my dates are wrong" bugs you'll see in online forums trace back to it. Defense-in-depth:

1. Name parameters carefully. `subscription.current_period_end` should be typed as "Unix seconds" and JS `Date(x)` as "milliseconds" — these are different units, and our code crosses the boundary explicitly with `* 1000` and a comment clarifies it.
2. Centralize the conversion. You could write a small helper — `function unixToIso(s: number | null): string | null { return s === null ? null : new Date(s * 1000).toISOString() }` — and use it everywhere. For this lesson we inline the check because the pattern is consistent and hiding it in a helper would obscure the key idea. For a larger codebase, pull it out.
3. Test boundary conditions: null → null, zero → zero, real timestamp → right ISO date.

### `expand` and the N+1 pattern in API calls

Stripe's expand parameter prevents N+1 API-call patterns. Consider: you fetch a subscription, see it has 50 items, want the product name for each. Without expansion, that's 50 additional `stripe.products.retrieve` calls. With `expand: ['items.data.price.product']`, it's one call.

Rule: if you're going to read a field, expand it once at fetch time rather than lazily on access. Stripe charges you nothing for expansion (and it's fast — they resolve server-side from their own in-memory graph). The cost is a slightly larger response body; negligible for anything under hundreds of items.

This is the same principle as SQL eager loading vs. lazy loading. Eager is almost always right when you know you need the data.

### Eventual consistency at the subscription level

Our webhook → fetch → upsert pipeline has a latency profile:

- Stripe state changes at T=0.
- Webhook fires at T=0+~50ms.
- Our server receives it at T=0+~200ms (network + TLS).
- `manageSubscriptionStatusChange` calls Stripe at T=~250ms; Stripe responds with current state at T=~500ms.
- DB upsert completes at T=~600ms.

So within about a second of any Stripe state change, our DB reflects it. For feature gating ("is this user allowed to see Pro features?"), that's fine. For a checkout-completion confirmation page ("your subscription is now active!"), a freshly-completed checkout might hit the page before the webhook lands.

The solution: on checkout success pages, use **polling** or **server-side fetch-through** to confirm the subscription exists before showing it. Or: fetch the subscription directly from Stripe on the confirmation page, bypassing the mirror — the mirror will converge shortly after. Either is acceptable; Stripe's sample code tends to use direct-fetch for the confirmation page and rely on the mirror for subsequent reads.

### Handling deleted subscriptions as `status = 'canceled'`

When a subscription ends, Stripe fires `customer.subscription.deleted`. Counterintuitively, the subscription object still exists in Stripe — you can still `stripe.subscriptions.retrieve(sub_id)` and get back a full object with `status: 'canceled'`. "Deleted" here means "ended"; the record persists.

Our database follows the same model: a canceled subscription stays in the `subscriptions` table with `status = 'canceled'` forever (or until the user deletes their account, which cascades via the `user_id` foreign key). This lets us answer historical questions:

- "What's our churn rate this month?" — count rows where `canceled_at` falls in this month.
- "Did user X ever pay us?" — `exists(select 1 from subscriptions where user_id = X)`.
- "Reactivate this user's old plan" — look up their most-recent canceled subscription, re-create a new subscription on the same price.

Hard-deleting would throw this away. Soft-canceling gives you history for free.

The exception: if a user actually deletes their account, the cascade erases their subscriptions (GDPR compliance). For active customers, we never manually delete subscription rows — only flip the status.

### The bigger pattern: service layer as a typed adapter

Stand back and look at what `src/lib/server/billing/` has become:

- `products.service.ts` — `upsertProduct`, `upsertPrice`
- `customers.service.ts` — `getOrCreateCustomer`
- `subscriptions.service.ts` — `upsertSubscription`, `manageSubscriptionStatusChange`

Five functions. Each small, idempotent, strictly typed, testable in isolation. Each consumes one precise Stripe type and produces zero or one side-effect. The webhook handler is a thin dispatcher that maps event types to service calls. The checkout endpoint (Module 8) will be a thin orchestrator that composes these services into a user-facing flow.

This is the **typed adapter layer** pattern. It sits between two systems (Stripe and Supabase) and translates their models into each other. It's not clever, it's not abstract, it's not framework-heavy. It's just five functions that each do one thing. And it's the single biggest reason billing code ever feels manageable in a production SaaS — because the moment you deviate from "small typed adapter functions," you start paying compounding complexity taxes for years.

When you inherit a billing codebase that's 4,000 lines of nested callbacks, spaghetti promises, and "let me just add one more if here," the refactoring path back to sanity looks exactly like what you just built.

---

## Summary

- Built `upsertSubscription(subscription)` handling all 17 relevant fields, including Stripe v22's `SubscriptionItem`-scoped period timestamps.
- Built `manageSubscriptionStatusChange(id)` as a fetch-fresh-then-upsert helper that handles out-of-order events correctly.
- Correctly converted Unix seconds to ISO strings, with null-guards for every nullable timestamp.
- Added six webhook cases — product, price, three subscription lifecycle events, and `checkout.session.completed` — all flowing through the service layer.
- Understood why canceled subscriptions persist in our DB with `status = 'canceled'` rather than being deleted.
- Finalized the service-layer shape for the rest of the course — five small, typed, idempotent functions behind a dispatcher.

## What's Next

Module 7 is complete: webhooks are wired, services are written, data is flowing. In Module 8 you'll build the user-facing flows that consume this layer — the pricing page that reads `products` and `prices` to render cards, the checkout endpoint that calls `getOrCreateCustomer` and opens a Stripe Checkout session, the success page that verifies the subscription landed, and the Customer Portal link that lets users self-serve cancellations. Every one of those is thin because this module did the hard work. The billing layer is quietly load-bearing — which is the best compliment a billing system can earn.
