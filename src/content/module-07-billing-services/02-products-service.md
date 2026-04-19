---
title: '7.2 - Products Service'
module: 7
lesson: 2
moduleSlug: 'module-07-billing-services'
lessonSlug: '02-products-service'
description: 'Build the products service that syncs Stripe product data into Supabase via webhooks.'
duration: 12
preview: false
---

## Overview

You have tables. You have a webhook endpoint. What you don't yet have is a **service layer** — the thin, typed, testable functions that sit between the webhook and the database. Module 7 is going to build four such functions (one per table), starting with the simplest: `upsertProduct`.

A service function is not a route handler. It's not a webhook handler. It's not an API client. It's the bit of code that knows one thing well: "given a fresh `Stripe.Product`, make my Supabase `products` table agree with it." That's it. It doesn't know about HTTP. It doesn't know about webhooks. It doesn't know about UIs. This separation is what makes billing code reviewable, testable, and boring — in the good way.

By the end of this lesson, every `product.created` and `product.updated` event arriving at `/api/webhooks/stripe` will flow through `upsertProduct` and land as a row in your `products` table. You'll have ten-ish lines of logic behind a function signature that a teammate could audit in thirty seconds.

## Prerequisites

- Lesson 7.1 complete — `products` table exists with `text` PK and RLS.
- `src/lib/server/stripe.ts` exports the Stripe client (`apiVersion: '2026-03-25.dahlia'`) from Module 6.
- `src/lib/server/supabase.ts` exports `supabaseAdmin` — the service-role client. If you haven't built it yet, it's a `createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })`.
- `$server` path alias resolves to `$lib/server` (check `svelte.config.js` and `vite.config.ts` / `tsconfig.json`).
- Webhook handler at `src/routes/api/webhooks/stripe/+server.ts` that already verifies the signature and decodes the event.

## What You'll Build

- A new file `src/lib/server/billing/products.service.ts` exporting one function: `upsertProduct(product: Stripe.Product)`.
- A safe, idempotent upsert using `supabaseAdmin` that runs outside any user's RLS context.
- Updated webhook dispatch in `src/routes/api/webhooks/stripe/+server.ts` — two new event cases calling the service.
- A mental model for idempotent webhook handlers that you'll reuse for customers, prices, and subscriptions in the rest of this module.

---

## Step 1: Why a Separate `billing/` Folder?

Open `src/lib/server/` in your editor. You probably have `stripe.ts`, `supabase.ts`, maybe a `utils/` folder. We're adding a new subfolder:

```
src/lib/server/
├── billing/
│   ├── products.service.ts       ← this lesson
│   ├── customers.service.ts      ← lesson 7.3
│   └── subscriptions.service.ts  ← lesson 7.4
├── stripe.ts
└── supabase.ts
```

Why group billing services into their own folder?

1. **Cohesion.** Every file in `billing/` does one thing — keep Supabase in sync with Stripe. Anyone auditing billing logic knows exactly where to look.
2. **Import boundary.** Later, when we write tests, we can mock the whole `billing/` module with one line. Granular mocking of individually-imported functions is tedious.
3. **Documentation by filesystem.** A new engineer on the project sees `billing/` and immediately understands the code structure. No comments needed.
4. **Room to grow.** If we later add `billing/checkout.service.ts`, `billing/portal.service.ts`, `billing/invoices.service.ts`, they have a natural home without reorganizing everything else in `src/lib/server`.

The `.service.ts` suffix isn't magical — SvelteKit doesn't care — but it's a convention that tells readers "this file exports stateless async functions that interact with external systems."

---

## Step 2: Why `supabaseAdmin`, Not `locals.supabase`?

Every other write in Contactly goes through `locals.supabase`, which carries the user's JWT and is subject to RLS. Writes to `contacts` succeed only because the RLS policy `auth.uid() = user_id` passes.

But **webhook handlers have no user**. A webhook is an HTTP request from Stripe's servers to yours, triggered asynchronously after some user action (or after an internal Stripe event that has nothing to do with any specific user — like a product edit made by you in the Stripe dashboard). There's no logged-in user. There's no JWT. `auth.uid()` returns null.

If we tried to write to `products` using `locals.supabase` from a webhook, every `RLS` policy would evaluate against a null user and (correctly) reject the write. Even if we wrote policies that allowed `auth.uid() is null`, we'd be opening a huge hole: any anonymous request could hit those endpoints and mutate data.

The right tool is **`supabaseAdmin`** — a client authenticated with the service-role key, which bypasses RLS entirely. Service-role writes are trusted because they come from our own server code, running on our own servers, with our secret key that never leaves the environment.

The rule: **webhook-driven writes use `supabaseAdmin`. User-driven writes use `locals.supabase`**. Two clients, two contexts, zero ambiguity.

---

## Step 3: The `upsertProduct` Function

Create `src/lib/server/billing/products.service.ts`:

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
```

Twelve lines including the import block. Let's go through every one.

### The imports

```typescript
import type Stripe from 'stripe';
import { supabaseAdmin } from '$server/supabase';
```

`import type Stripe from 'stripe'` is a **type-only import**. We don't use the `Stripe` constructor here — we only use its `Stripe.Product` type annotation. Type-only imports are erased during compilation, so this line has zero runtime cost. It also tells IDE tooling "don't bundle the full Stripe SDK into any client bundle that accidentally imports this file" (which won't happen because we're in `/server`, but the type-only annotation is still correct hygiene).

`import { supabaseAdmin } from '$server/supabase'` uses the `$server` path alias, which resolves to `$lib/server`. Remember: you must never import from `$lib/server` into a client component. SvelteKit enforces this at build time — it'll fail the build if something crossable imports a server-only file. `$server/supabase` is server-only; our service is server-only; clean.

### The signature

```typescript
export async function upsertProduct(product: Stripe.Product): Promise<void>;
```

The parameter is `Stripe.Product` — the exact type Stripe's SDK gives us when an event's `data.object` is a product. This is the single most important line of the function. TypeScript will now:

- Autocomplete every field Stripe puts on a product.
- Refuse to let us access a field that doesn't exist (typos caught at compile time).
- Warn us if Stripe's types evolve in a breaking way (SDK upgrade surfaces the diff).

The return type is `Promise<void>` — we don't return the inserted row. The caller doesn't need it. Webhook handlers don't do anything with the result; they only care whether the upsert succeeded. Keeping the return type minimal is a service-layer discipline: expose only what callers consume.

### The upsert

```typescript
const { error } = await supabaseAdmin.from('products').upsert({
	id: product.id,
	name: product.name,
	description: product.description ?? null,
	active: product.active,
	metadata: product.metadata,
	updated_at: new Date().toISOString()
});
```

`supabaseAdmin.from('products')` returns a query builder for the `products` table. Because `database.types.ts` is generated, TypeScript knows the exact column types — no `any`, no drift.

`.upsert(row)` translates to SQL `INSERT ... ON CONFLICT (id) DO UPDATE SET ...`. The conflict target is determined by the primary key of the table — for `products`, that's `id` (the Stripe product ID). So:

- If no row exists with this `id`, insert it. First time we've seen this product.
- If a row exists, update every provided column. Product has been edited in Stripe; we refresh our mirror.

That's **idempotency**: calling `upsertProduct` twice with the same payload is safe. Calling it a hundred times is safe. Stripe's webhook delivery guarantees are "at least once," meaning duplicate events happen routinely — especially if our server returns non-200 once and Stripe retries. Idempotency is how we survive duplicate delivery without double-writing.

Let's walk the fields:

- `id: product.id` — Stripe's product ID. This is the upsert key.
- `name: product.name` — required string; always present on a `Stripe.Product`.
- `description: product.description ?? null` — Stripe's type is `string | null`. We explicitly coerce to `null` if it's nullish, because `undefined` in a Supabase upsert would be ignored (left unchanged), which is _not_ what we want. If a product's description gets cleared in Stripe, we need to clear it in our mirror too. Upserting `null` replaces the column; upserting `undefined` leaves the column alone. The difference matters.
- `active: product.active` — boolean, always present.
- `metadata: product.metadata` — Stripe's metadata dict, stored as `jsonb`. Always present (Stripe returns an empty object `{}` if the user set no metadata).
- `updated_at: new Date().toISOString()` — we set this on every upsert. We could let the DB default handle it on inserts, but on updates we need to bump it manually — Postgres won't update a `default now()` column on its own during UPDATE.

### The error handling

```typescript
if (error) {
	throw new Error(`Failed to upsert product ${product.id}: ${error.message}`);
}
```

Supabase's JS client returns `{ data, error }` — it does not throw. We throw ourselves on error, because the webhook handler's `try/catch` should trigger a non-200 response to Stripe, which in turn triggers retry. Swallowing an error means the webhook returns 200 to Stripe, Stripe considers the delivery successful, and our database silently falls out of sync.

The thrown error message includes the `product.id` so the logs are actionable: you know which product failed and why, without having to cross-reference the request.

---

## Step 4: Wire the Webhook Handler

Open `src/routes/api/webhooks/stripe/+server.ts`. You already have the verified event from Module 6 — probably a big `switch (event.type)` block that currently has `console.log` placeholders. We're adding two real cases.

Add the import at the top:

```typescript
import { upsertProduct } from '$server/billing/products.service';
```

Inside the switch, replace the product placeholders with:

```typescript
case 'product.created':
case 'product.updated': {
  await upsertProduct(event.data.object)
  break
}
```

Four things happening here. Let's be explicit about each.

### Case fallthrough — intentional

```typescript
case 'product.created':
case 'product.updated': {
```

Both event types call the same handler. That's intentional: our `upsertProduct` is idempotent and behaves correctly whether the product is new or pre-existing. We could write two separate cases with the same body, but fallthrough is cleaner and communicates "these two events produce identical handling."

### Block scoping

The `{` ... `}` around the case body is a **block scope**. It's not strictly necessary for a two-line case, but it's a TypeScript best practice when cases have local variables (later we'll have cases like `case 'customer.subscription.updated': { const sub = event.data.object; ... }`) — without the block, `const` declarations would leak into the switch scope and collide across cases. Habitual braces prevent a whole class of weird bugs.

### `event.data.object` is strongly typed

```typescript
await upsertProduct(event.data.object);
```

Stripe's SDK overloads the `Event` type such that within a narrowed case — `event.type === 'product.created'` — TypeScript knows `event.data.object` is a `Stripe.Product`. That's why we don't need an explicit cast. The type narrowing happens on the string literal of `event.type`, so `case 'product.created':` is all we need to get the precise type.

(If you ever find yourself writing `as Stripe.Product` in a webhook handler, something is off in your event typing and you should fix that rather than cast.)

### `break` — critical

```typescript
break;
```

Without `break`, execution falls through to the next case. That's how we made `case 'product.created':` and `case 'product.updated':` share a body: the first case has no `break`, so it falls into the second. But after the upsert runs, we _must_ break, or we'd fall through into whatever case comes next (maybe `customer.created` — which would then try to run with a `Stripe.Product` as its `event.data.object`, and everything breaks).

Cases without `break` are a classic JS footgun. Always `break`. Always.

---

## Step 5: The Full Webhook Handler So Far

After this lesson your `+server.ts` looks roughly like this (the non-product cases are still placeholder logs — we'll fill them in during 7.3 and 7.4):

```typescript
// src/routes/api/webhooks/stripe/+server.ts
import { json, error } from '@sveltejs/kit';
import { stripe } from '$server/stripe';
import { upsertProduct } from '$server/billing/products.service';
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

			// price, customer, and subscription cases added in 7.3 and 7.4.

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

A few notes on the overall shape — these are patterns you'll keep for the whole module:

- **Signature verification first, handler body second.** If the signature isn't valid, we return 400 immediately — don't even parse the event. This is non-negotiable security: without it, anyone who guesses your webhook URL can feed you fake events.
- **`await request.text()`, not `.json()`.** Stripe's `constructEvent` requires the exact raw request body including whitespace. Converting to JSON first and back rehydrates with different spacing, and the HMAC breaks.
- **Wrap the switch in `try/catch` that returns 500 on failure.** This is how Stripe learns to retry. A 5xx response triggers retry; a 2xx response means "got it, don't retry." We want retry on service errors (DB down, timeout), not on logic errors (unknown event type). Hence the default case just logs.
- **Return `{ received: true }`.** The payload doesn't matter — Stripe only cares about the status code. But returning JSON is a polite default for HTTP handlers.

---

## Step 6: Test End-to-End

Boot the dev server and the Stripe CLI listener:

```bash
# Terminal 1
pnpm dev

# Terminal 2
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

Copy the `whsec_...` shown by `stripe listen` and set it in your `.env` as `STRIPE_WEBHOOK_SECRET`, then restart `pnpm dev`. (If you already did this in Module 6, skip.)

In a third terminal, trigger a test product event:

```bash
stripe trigger product.created
```

Watch Terminal 2: you should see `product.created` flash by with a `200 OK` response. Now open Studio at `http://localhost:54323` → Table Editor → `products`. There should be a single row with a `prod_...` ID, a test name, and `active = true`.

Run it again:

```bash
stripe trigger product.created
```

Still one row. The second call upserted the same product ID — idempotency worked. If `updated_at` is newer than `created_at`, that's the upsert firing the update path.

Edit a real product in the Stripe dashboard (change the name). Within a second, your Supabase row updates to match. You now have a live, bidirectional mirror for product metadata.

---

## Common Mistakes

### Mistake 1: Using `locals.supabase` in a webhook handler

```typescript
// WRONG
const { error } = await locals.supabase.from('products').upsert({ ... })
```

Webhook handlers don't have a logged-in user. `locals.supabase` is tied to the request's auth cookies, which Stripe's servers don't send. The client ends up in anon mode, and the RLS policy (which we correctly did not write for writes) rejects the insert. Use `supabaseAdmin` for every webhook-driven write.

### Mistake 2: Forgetting to coerce `undefined` to `null`

```typescript
// WRONG
description: product.description,
```

`product.description` can be `null` (Stripe's type). If Stripe passes `null`, Supabase writes `null` — correct. But if we're ever handed an object where the field is `undefined` (from a test fixture, say), Supabase silently skips the column, and we keep the old description. The bug only shows up when someone clears the description in Stripe and it doesn't clear in our mirror. `?? null` forces the column to be written explicitly.

### Mistake 3: Returning 200 on error

```typescript
// WRONG
try {
	await upsertProduct(event.data.object);
} catch (err) {
	console.error(err); // swallows the error
}
return json({ received: true }); // tells Stripe "success"
```

Now our DB is out of sync and Stripe thinks everything's fine. No retry. Forever out of sync. Re-throw or return 500 so Stripe retries.

### Mistake 4: Not using `Stripe.Product` as the parameter type

```typescript
// WRONG
export async function upsertProduct(product: any) { ... }
```

`any` disables every type safety benefit. If Stripe adds a field, or renames one, or you access `product.nmae`, TypeScript shrugs. `Stripe.Product` is the typed contract with the SDK; use it.

### Mistake 5: Writing the handler inline in the webhook file

It's tempting to skip the `products.service.ts` file and put the upsert directly inside the `case 'product.created':` block. Resist. The service layer exists so:

- You can unit-test `upsertProduct` without spinning up an HTTP request.
- You can call it from non-webhook contexts (e.g., a "resync from Stripe" admin button in lesson 7.5+).
- The webhook handler stays readable — a dispatch map, not a logic dump.

Every line of inline webhook logic is a line you can't reuse.

### Mistake 6: Using a snake_case field where Stripe provides camelCase (or vice versa)

Stripe's v22 SDK uses `snake_case` everywhere in the payloads (because Stripe's JSON API is snake_case). Our database is snake_case. The mapping is 1:1 for products. But for other objects (subscriptions, especially) you'll see `cancel_at_period_end` in both places, and also `trialEnd` does not exist — it's always `trial_end`. Trust the Stripe SDK's types. Don't guess.

---

## Principal Engineer Notes

### Idempotency is the defining property of good webhook handlers

Webhooks are a distributed systems problem dressed up as a REST endpoint. Stripe promises **at-least-once delivery** of events — meaning you _will_ receive the same event twice, at some frequency, forever. Common reasons:

- Your server returned a non-2xx status; Stripe retries after exponential backoff.
- Stripe's side hiccuped and queued a duplicate.
- You deployed during a burst and lost in-flight acks.

The only sane handler is one where **processing the same event twice produces the same final state as processing it once**. That's idempotency. `upsert` with a primary-key conflict target is the simplest way to achieve it for mutation events. For side effects (like emails, which can't be "unsent"), you need a deduplication store — we'll build one in a later module.

Write idempotency into every webhook handler from day one. Retrofitting it later, after you've had an incident, is painful.

### Service-layer functions should be boring

Look at `upsertProduct` again. There's no cleverness. No optimization. No surprise. It takes a Stripe product, it writes to the DB, it throws on failure. An engineer can audit it in thirty seconds and go home.

That's the goal. Billing code is the place where cleverness kills you — the bug that causes a customer to get charged twice, or not at all, is typically born in a "look at this elegant abstraction" moment. Keep billing services flat, imperative, boring. Every service in this module is going to look exactly like this one.

### `ON CONFLICT DO UPDATE` semantics — what gets updated?

Supabase's `.upsert({ columns })` maps to:

```sql
insert into products (id, name, description, active, metadata, updated_at)
values ($1, $2, $3, $4, $5, $6)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      active = excluded.active,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at;
```

Only the columns you include in the upsert object are updated. `created_at` — which we don't pass — remains untouched on the existing row. That's why `created_at` reflects the original insert time, not each update. If you ever want to exclude _specific_ columns from being updated on conflict, Supabase exposes `onConflict` and `ignoreDuplicates` options; we won't need them here.

### Retry safety and eventual consistency

Because `upsertProduct` is idempotent and retryable, a flaky database connection — we get an error, Stripe retries five minutes later, now the DB is fine — just works. Our mirror converges to the right state eventually. "Eventually consistent" is the right description: at any given instant, Stripe and Supabase might disagree for a few seconds, but they re-converge on every event.

Some billing systems try to be strictly synchronous (read-through to Stripe on every dashboard render). We don't. We accept eventual consistency, which means:

- Feature gates should tolerate "just-expired" states for a few seconds — worst case, user retains access for 60 seconds after their sub ends. Fine.
- Pricing displays lag product edits by a few seconds — Stripe sends `product.updated`, we mirror it, the UI re-renders. Fine.
- In-flight checkouts write to Stripe first; the webhook writes to us _after_. The "checkout success" page might need to wait for a moment or poll until the subscription row appears.

These tradeoffs are fine for a SaaS app. They'd not be fine for a high-frequency trading system. Know which industry you're in.

### Testing this without Stripe

A principal-engineer approach to this function's test coverage:

- **Unit test `upsertProduct`** with a mocked `supabaseAdmin` — assert it calls `.upsert` with the correct payload given a synthetic `Stripe.Product` fixture. One test covers the success path, one covers the error-re-throw path. Takes 10 minutes to write, runs in milliseconds, catches 90% of future regressions.
- **Integration test** the webhook handler with Stripe's test event payloads — we'll build this in Module 11.

The unit test is the high-value one. It runs in CI every push and pins the contract between our service and the Stripe type.

---

## Summary

- Created the `src/lib/server/billing/` folder — cohesive home for all Stripe-sync services.
- Built `upsertProduct(product: Stripe.Product)` — a twelve-line idempotent upsert using `supabaseAdmin`.
- Understood why webhook-driven writes bypass RLS by using the service-role client.
- Wired the webhook handler to call `upsertProduct` on `product.created` and `product.updated`.
- Verified end-to-end with `stripe trigger product.created` and Studio.
- Adopted the service-layer pattern: boring, typed, testable, reusable.

## What's Next

In Lesson 7.3 you'll build `customers.service.ts` — a `getOrCreateCustomer(userId, email)` function that's slightly more interesting. It reads first, writes conditionally, and crosses both Stripe and Supabase in a single call. It's the first service that's not just a mirror; it actively creates Stripe-side state. That's where we'll talk about race conditions and why `UNIQUE` on `stripe_customer_id` saves us.
