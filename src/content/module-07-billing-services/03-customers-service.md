---
title: '7.3 - Customers Service'
module: 7
lesson: 3
moduleSlug: 'module-07-billing-services'
lessonSlug: '03-customers-service'
description: 'Build the customers service — creating Stripe customers and mapping them to Supabase users.'
duration: 12
preview: false
---

## Overview

The products service was a pure mirror — Stripe said something, we copied it into our DB. The customers service is different. It **originates** state: the very first time a Contactly user clicks "Upgrade to Pro," we have to create a Stripe customer _on Stripe's side_ and record the Supabase-to-Stripe mapping in our DB. There's no Stripe webhook driving this; it's our app doing it proactively, right before we open a checkout session for that user.

This lesson is the first service that crosses the Stripe/Supabase boundary in both directions. It reads Supabase first (do we already have a Stripe customer for this user?), writes to Stripe if needed (create the customer), then writes back to Supabase (record the mapping). Three network calls, one conceptually simple operation, a handful of edge cases that eat careless engineers.

By the end, you'll have `getOrCreateCustomer(userId, email)` — called from every checkout endpoint you're going to build in Module 8. It'll return a `stripe_customer_id` string, either by reading an existing one or creating a fresh one.

## Prerequisites

- Lesson 7.2 complete — `products.service.ts` shipped, webhook handler is calling it.
- `customers` table exists with `id uuid` referencing `profiles(id)` as PK and `stripe_customer_id text unique not null`.
- `src/lib/server/stripe.ts` exports the Stripe v22 client.
- `supabaseAdmin` is available at `$server/supabase`.
- You know what `$server` resolves to (`$lib/server`) and why.

## What You'll Build

- `src/lib/server/billing/customers.service.ts` with one exported function: `getOrCreateCustomer(userId, email)`.
- A "read-then-create-then-write" flow that's safe against typical race conditions and surfaces any unexpected ones cleanly.
- A Stripe customer object carrying `metadata.supabase_user_id` for easy reverse-lookup during incident response.

---

## Step 1: The Shape of the Problem

When a user clicks "Upgrade to Pro," your checkout endpoint needs to hand Stripe two things:

1. A **price ID** — "charge this price schedule."
2. A **customer ID** — "charge this specific payer."

The price ID is easy — it's a constant (or a lookup-key read against the `prices` table). The customer ID is where this lesson lives.

Stripe customers are created once per payer. A user who upgrades to Pro, later downgrades, then upgrades again uses the **same** Stripe customer across all three events. Creating a new Stripe customer for every checkout would create duplicate records, duplicate invoice histories, no way to do "my billing history" properly, and a massive phishing vector if that duplicate had payment methods attached to multiple identities.

So every time our app is about to open checkout, we need to answer: **does this user already have a Stripe customer? If yes, return that ID. If no, create one and remember it forever.**

That's the whole function. The complexity is in "remembering it forever" when webhooks, retries, and concurrent tabs are involved.

---

## Step 2: One-to-One User-to-Customer

Let's pin down the invariant: **one Supabase user has at most one Stripe customer**.

This is enforced at three layers:

1. **Schema** — `customers.id` IS `profiles.id` (shared PK). You structurally cannot have two customer rows for one user.
2. **Unique constraint** — `stripe_customer_id text unique not null`. You structurally cannot have two users sharing a Stripe customer.
3. **Service logic** — `getOrCreateCustomer` checks before creating. You don't waste Stripe API calls or create orphan customers on Stripe's side.

All three matter. Layer 3 is fast and common-case. Layer 1 catches logic bugs in layer 3. Layer 2 catches logic bugs in layer 1. The layers are complementary defenses.

---

## Step 3: The Function, End to End

Create `src/lib/server/billing/customers.service.ts`:

```typescript
// src/lib/server/billing/customers.service.ts
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';

export async function getOrCreateCustomer(userId: string, email: string): Promise<string> {
	const { data: existing } = await supabaseAdmin
		.from('customers')
		.select('stripe_customer_id')
		.eq('id', userId)
		.single();

	if (existing?.stripe_customer_id) {
		return existing.stripe_customer_id;
	}

	const customer = await stripe.customers.create({
		email,
		metadata: { supabase_user_id: userId }
	});

	const { error } = await supabaseAdmin
		.from('customers')
		.insert({ id: userId, stripe_customer_id: customer.id });

	if (error) {
		throw new Error(`Failed to store customer mapping: ${error.message}`);
	}

	return customer.id;
}
```

Let's go slowly.

### Imports

```typescript
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
```

Two server-only imports — the Stripe client and the admin Supabase client. `$server` is our alias for `$lib/server`. Both files are server-only; any accidental import into a client component would fail at build time. That's by design — no Stripe secret keys in the browser, no service-role token in the browser, ever.

We don't need `import type Stripe from 'stripe'` here because we're not type-annotating any parameter or return with a Stripe-specific type. The Stripe SDK's `stripe.customers.create()` return type flows through automatically.

### Function signature

```typescript
export async function getOrCreateCustomer(userId: string, email: string): Promise<string>;
```

Two parameters:

- **`userId`** — the Supabase user's UUID (`profiles.id`). Passed by the caller, who gets it from `locals.getUser()`. Never accept `userId` from client input — always derive it from the session on the server.
- **`email`** — the user's email, also read from the session. Stripe needs it to generate receipts and communicate about billing events (card expiration warnings, etc.). It doesn't have to match the profile's email forever (users can change one without the other), but at creation time it's a sensible default.

Return type `Promise<string>` — just the Stripe customer ID. We don't return the whole row, because the caller only needs the ID to pass into the next Stripe API call (usually `stripe.checkout.sessions.create({ customer: ..., ... })`).

### Step 3a: Look up the existing row

```typescript
const { data: existing } = await supabaseAdmin
	.from('customers')
	.select('stripe_customer_id')
	.eq('id', userId)
	.single();
```

This reads the single row for the given `userId`. Three notes:

- **`.select('stripe_customer_id')`** — we only need this one column. Don't `select('*')` when you need one field; it's wasted bytes over the wire and a subtle information-leak risk if other columns ever get added. Select what you use.
- **`.eq('id', userId)`** — because `customers.id` is the PK (and is `profiles.id`), this is a direct primary-key lookup. O(log n), very fast.
- **`.single()`** — tells Supabase "return at most one row as an object" (rather than an array). If zero rows match, `.single()` returns `{ data: null, error: PostgrestError }` with `error.code === 'PGRST116'` (no rows).

We intentionally **destructure only `data`**, not `error`. Why? Because "no row found" is a _normal_ outcome of this query — the user hasn't upgraded before. We don't want to error on that. By ignoring the error and checking `existing?.stripe_customer_id` below, we treat "no row" and "genuine error" the same way — we continue to create a new customer. In the genuinely-broken case (say the DB is down), the next Stripe call would succeed but the subsequent insert would fail, and _that_ failure we throw on.

If you're uncomfortable with that logic (and many engineers rightfully are), you can make it explicit:

```typescript
const { data: existing, error: lookupError } = await supabaseAdmin
	.from('customers')
	.select('stripe_customer_id')
	.eq('id', userId)
	.maybeSingle(); // returns null instead of error for no-rows

if (lookupError) {
	throw new Error(`Failed to look up customer for user ${userId}: ${lookupError.message}`);
}
```

That's the more rigorous version. For this lesson we'll stick with the simpler form because the insert below has its own error guard — but know the variant exists. `maybeSingle()` is generally preferable when "no row" is expected.

### Step 3b: Short-circuit if found

```typescript
if (existing?.stripe_customer_id) {
	return existing.stripe_customer_id;
}
```

Optional chaining handles both cases:

- `existing` is `null` (no row) → the `?.` short-circuits → falsy → no early return.
- `existing` is `{ stripe_customer_id: 'cus_ABC' }` → `existing.stripe_customer_id` is truthy → early return.

We don't call Stripe. We don't insert anything. We just return the ID we already have. This is the hot path — it fires on every checkout after the first. Cheap, fast, no network to Stripe.

### Step 3c: Create a Stripe customer

```typescript
const customer = await stripe.customers.create({
	email,
	metadata: { supabase_user_id: userId }
});
```

We call Stripe's API to create a new customer. The return value is a `Stripe.Customer` object with `.id` like `cus_QT9xH...`.

Two fields we pass:

- **`email`** — so Stripe's receipts, dunning emails, and Customer Portal know who they're talking to.
- **`metadata.supabase_user_id: userId`** — the reverse pointer. Our DB knows Stripe's ID (via `customers.stripe_customer_id`); we also want Stripe's record to know our user's ID. This metadata shows up in the Stripe dashboard, in webhook payloads, and in every API response. If an engineer is on an incident-response call at 2am debugging "why does this Stripe customer have the wrong email," the metadata tells them which Contactly user to look up.

Stripe's `metadata` dict accepts string keys and string values. Don't put objects or arrays in there — Stripe will reject them. UUIDs are already strings; we're fine.

Notice we do not set `name`, `phone`, `address`. Stripe prefers `email` as the minimum identifier. If we later collect billing address at checkout, Stripe populates those fields automatically from the checkout form. We don't need to duplicate effort.

### Step 3d: Persist the mapping

```typescript
const { error } = await supabaseAdmin
	.from('customers')
	.insert({ id: userId, stripe_customer_id: customer.id });

if (error) {
	throw new Error(`Failed to store customer mapping: ${error.message}`);
}
```

We `insert` (not `upsert`) because we got here only after confirming no row exists. If somehow a row _does_ exist at this moment — meaning we raced with another concurrent request for the same user — the insert fails on primary-key violation. The error message surfaces as `duplicate key value violates unique constraint "customers_pkey"`.

In that race case, we've created a Stripe customer that we failed to persist, which means we've leaked a Stripe customer record. That's ugly. But it's not a correctness bug — the next call to `getOrCreateCustomer` will see the row the winning request created, return that ID, and the leaked Stripe customer just sits orphaned in Stripe's database, costing nothing. We'll talk about how to reduce the odds of this in the Principal Engineer notes.

### Step 3e: Return

```typescript
return customer.id;
```

Give the caller the Stripe ID. Done.

---

## Step 4: When Do We Call This?

`getOrCreateCustomer` is called from the checkout endpoint, which you'll build in Module 8. The shape is:

```typescript
// src/routes/api/checkout/+server.ts (Module 8)
import { json } from '@sveltejs/kit';
import { stripe } from '$server/stripe';
import { getOrCreateCustomer } from '$server/billing/customers.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) throw error(401, 'Unauthorized');

	const { priceId } = await request.json();

	const customerId = await getOrCreateCustomer(user.id, user.email);

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		mode: 'subscription',
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: '...',
		cancel_url: '...'
	});

	return json({ url: session.url });
};
```

Two things to notice now:

1. `user.id` and `user.email` come from the authenticated session — not from request input. The user cannot trick us into creating a customer with someone else's email.
2. The call happens _before_ `checkout.sessions.create`. By the time we hand off to Stripe, we've guaranteed a customer ID is ready to hand over.

This is the only place `getOrCreateCustomer` will be called in the normal flow. It is _not_ called from webhook handlers — we never proactively create Stripe customers in reaction to inbound events. Only when the user themselves takes a checkout action.

---

## Step 5: Test the Happy Path

There's no Stripe CLI trigger for "create Stripe customer" — Stripe doesn't send a webhook for that flow (technically `customer.created` fires, but it's usually after the fact of our own creation). Instead, write a one-off test script or call the function from a `+server.ts` endpoint you throw away after verifying.

Create a temporary debug endpoint:

```typescript
// src/routes/api/debug/customer/+server.ts (delete after testing)
import { json } from '@sveltejs/kit';
import { getOrCreateCustomer } from '$server/billing/customers.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user?.email) return json({ error: 'not authed' }, { status: 401 });

	const id = await getOrCreateCustomer(user.id, user.email);
	return json({ stripe_customer_id: id });
};
```

Hit it twice:

```bash
curl -X POST http://localhost:5173/api/debug/customer \
  -H 'Cookie: <paste your dev auth cookie>'
```

First call:

- Creates a Stripe customer (visible in Stripe Dashboard → Customers).
- Inserts a row in Supabase `customers` table.
- Returns `{ stripe_customer_id: 'cus_...' }`.

Second call with the same user:

- Finds the existing row.
- Does not call Stripe (check Stripe's logs to confirm).
- Returns the same ID.

Idempotency verified. Delete the debug endpoint.

---

## Common Mistakes

### Mistake 1: Accepting `userId` from the client

```typescript
// WRONG
const { userId, email } = await request.json();
const customerId = await getOrCreateCustomer(userId, email);
```

Any user can POST with someone else's `userId` and create Stripe customers in their name. Always derive `userId` and `email` from `locals.getUser()` on the server.

### Mistake 2: Using `upsert` instead of `insert` for the mapping

```typescript
// WRONG
await supabaseAdmin.from('customers').upsert({
	id: userId,
	stripe_customer_id: customer.id
});
```

Looks safer ("what if the row already exists?"), but actually hides a race-condition bug. If we got to this line, we already checked the row didn't exist. If it now exists, _something happened between our SELECT and this upsert_, and we probably created a second Stripe customer that now won't be remembered. We want that to fail loudly (so we can see the race in logs and add a cleanup job for the orphan), not silently overwrite.

### Mistake 3: Forgetting the `metadata.supabase_user_id`

```typescript
// WRONG
const customer = await stripe.customers.create({ email });
```

You save a line now, you pay for it later at 2am when a Stripe dispute lands and you're staring at `cus_QT9xH...` wondering which user that is. Metadata back-links are an incident-response investment. Always set them on every Stripe object you create.

### Mistake 4: Not using `single()` or `maybeSingle()`

```typescript
// WRONG
const { data: existingRows } = await supabaseAdmin
	.from('customers')
	.select('stripe_customer_id')
	.eq('id', userId);

if (existingRows?.length > 0) {
	return existingRows[0].stripe_customer_id;
}
```

Works, but `existingRows[0]` is a sin waiting to happen when something else appends to the query (like ordering or limits get reordered). `.single()` / `.maybeSingle()` make the "at most one row" expectation structurally obvious and return a single object. It's the right abstraction for a PK lookup.

### Mistake 5: Catching the insert error and continuing

```typescript
// WRONG
const { error } = await supabaseAdmin.from('customers').insert({ ... })
if (error) {
  console.warn('could not save mapping, oh well', error)
}
return customer.id
```

Now the user has a Stripe customer that your app has never heard of. Next checkout, `getOrCreateCustomer` creates _another_ Stripe customer. You now have two orphans in Stripe and still none in your DB. The bug compounds. Throw.

### Mistake 6: Calling this from a webhook handler

`getOrCreateCustomer` is for user-initiated flows (checkout). Webhooks that need to resolve "what user does this Stripe customer belong to?" should instead _look up_ `customers` by `stripe_customer_id` (we'll do this in 7.4's `upsertSubscription`). Webhook handlers should never mutate Stripe state proactively — that's a recipe for feedback loops.

---

## Principal Engineer Notes

### Why store the mapping in a dedicated `customers` table vs. a column on `profiles`?

You could add `profiles.stripe_customer_id text unique` and avoid the `customers` table altogether. Why didn't we?

Two reasons:

1. **Separation of concerns.** `profiles` is about identity (name, avatar, email). `customers` is about billing (Stripe linkage). When you later add billing-specific columns — `default_payment_method_id`, `tax_id`, `billing_address` — they belong on a billing table, not smeared across `profiles`. Cleaner ownership, cleaner exports ("here are all our profiles"), cleaner access control.
2. **Minimal surface.** `profiles` is read on every page load (nav bar avatar, etc.). You don't want every `profiles` query to shlep a bunch of never-used Stripe fields. A separate table keeps the hot path small.

Starting with `customers` as a separate table costs you nothing — same number of SQL statements, same performance, and you get the above benefits for free.

### Race conditions: two tabs, one user, one click each

Picture Alice opening the pricing page in two browser tabs. She clicks "Upgrade to Pro" in Tab 1 and, half a second later, clicks it in Tab 2. Both requests arrive at the server nearly simultaneously. Both hit `getOrCreateCustomer(alice.id, alice.email)`. Both do the `SELECT` before either has `INSERT`ed. Both see no row. Both call `stripe.customers.create`. Both try to `INSERT`.

Now:

- Stripe has created **two** customers for Alice (`cus_A` and `cus_B`), each independently.
- The first INSERT wins; Alice's DB row is (`id=alice_uuid`, `stripe_customer_id=cus_A`).
- The second INSERT fails with `duplicate key value violates unique constraint "customers_pkey"` (because `id` is the PK). Our `throw` fires; Stripe customer `cus_B` is now an orphan.
- Tab 1 returns `cus_A`; Tab 2 returns a 500.

Three observations:

1. **The orphan is annoying, not catastrophic.** `cus_B` sits in Stripe with no payment methods, no charges, no subscriptions. You can delete it with a script later, or leave it there forever — it costs nothing.
2. **Tab 2's 500 is bad UX.** The user sees a failed checkout. They click again; this time `SELECT` returns the row; they get `cus_A`; checkout opens fine.
3. **You can reduce the window.** Use a transaction with `SELECT ... FOR UPDATE` on `profiles.id` to serialize the check-and-insert. Supabase's JS client doesn't expose transactions natively, so you'd either write a Postgres function or upgrade to the direct-Postgres driver. For Contactly's traffic level, the simple race is fine; for a higher-volume SaaS, the transactional variant is worth it.

Decision: ship the simple version. Log the duplicate-key errors. Write a cleanup script that finds orphan Stripe customers (no subscriptions, no charges, no matching row in our `customers`) and deletes them monthly. It's a far better use of engineering time than chasing 1-in-10,000 races from day one.

### The metadata back-link is incident response gold

`metadata.supabase_user_id` is easy to overlook and expensive to backfill. Every object you create on Stripe's side — customers, subscriptions, checkout sessions, products — should carry a pointer back to the relevant entity in your DB. Reasons:

- **Support tickets.** User says "why was I charged twice?" Support reads the Stripe dashboard, sees the customer's metadata, clicks through to the Supabase user. Thirty-second lookup instead of three-minute grep.
- **Deletion flows.** GDPR erasure: a user requests account deletion. You need to find every Stripe object linked to them. Without metadata back-links, you'd need to maintain a separate ledger of Stripe-side state per user — exactly what `customers` and `subscriptions` already do, but that only helps if the objects are already in your DB. For objects that never got mirrored (orphans, for instance), the metadata is the only way to find them.
- **Auditing.** "Show me all Stripe customers created by this user's signup flow." Stripe's dashboard has metadata search. Trivial.

Cost: one `metadata` field on every API call. Benefit: every incident is thirty seconds shorter. Always include.

### Deduplication via DB UNIQUE + try/catch is a pattern

The pattern we're using — "let the database's unique constraint be the deduplication authority, and handle the constraint violation gracefully" — is a general-purpose technique. It appears everywhere in backend systems:

- Creating an idempotent email-notification record (dedup key = `user_id + notification_type + day`).
- Processing a payment webhook without double-crediting (dedup key = Stripe's event ID).
- Preventing double-signups on the same email (dedup key = `lower(email)`).

The lesson: **when you need at-most-once semantics across concurrent writers, express it as a DB constraint.** App-level locking is hard, race-prone, and unreviewable. DB constraints are declarative, unambiguous, and enforced by a process that has zero bugs (compared to your app code, which has a few).

### When to call this service from the server vs. trigger via webhook

We call `getOrCreateCustomer` directly from the checkout endpoint — synchronously, before opening checkout. We _don't_ use Stripe's `customer.created` webhook to populate our `customers` table. Why?

Because the webhook arrives **after** we need the data. The timeline:

1. User clicks Upgrade.
2. Our server calls `getOrCreateCustomer` → creates Stripe customer → inserts row.
3. Server calls `stripe.checkout.sessions.create({ customer: ... })` → opens checkout.
4. (Sometime later) Stripe sends `customer.created` webhook.

If we waited for step 4 to populate our DB, step 3 would have nothing to reference. Synchronous creation is the right flow here.

We _could_ also listen to the `customer.created` webhook and upsert defensively, which would repair cases where our sync flow fails at step 2. For Contactly we don't bother — the orphan is handled separately. For a more complex system (Stripe customers created by many flows, not just checkout), belt-and-suspenders via webhook is worth adding.

---

## Summary

- Built `getOrCreateCustomer(userId, email)` — the first bi-directional service that originates Stripe state rather than mirroring it.
- Used a "SELECT first, INSERT on miss" pattern, with the DB's PK uniqueness as the ultimate deduplication authority.
- Set `metadata.supabase_user_id` on every Stripe customer so incident responders can reverse-lookup.
- Understood race conditions between concurrent checkout attempts and why the simple version is fine at Contactly's scale.
- Internalized: webhook handlers never create Stripe state; synchronous endpoints do.

## What's Next

Subscriptions are where Stripe's domain model gets interesting. In Lesson 7.4 you'll build `upsertSubscription` — the big one — and meet Stripe v22's breaking change that moved `current_period_start` and `current_period_end` off the `Subscription` object and onto the `SubscriptionItem` nested inside. You'll also build `manageSubscriptionStatusChange`, which refetches state from Stripe before upserting, as the defense against stale webhook payloads. After 7.4 your webhook handler will be complete — every event that matters will flow through the service layer and land in your DB.
