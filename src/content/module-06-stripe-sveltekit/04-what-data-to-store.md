---
title: '6.4 - What Data to Store'
module: 6
lesson: 5
moduleSlug: 'module-06-stripe-sveltekit'
lessonSlug: '04-what-data-to-store'
description: 'Decide what Stripe data to store in Supabase — avoiding rate limits and enabling fast server-side rendering.'
duration: 12
preview: false
---

## Overview

This is the architectural lesson of Module 6. No code — just twelve minutes of careful thinking about a question that every SaaS builder faces and that most answer wrong: **when my app needs to know a user's subscription status, do I ask Stripe every time, or do I keep a copy in my own database?**

The naive answer is "ask Stripe every time — it's the source of truth, right?" The naive answer is wrong. Asking Stripe on every request gets you rate-limited, adds hundreds of milliseconds of latency per page load, and makes your app fail whenever Stripe has an outage (which, yes, does happen — check [status.stripe.com](https://status.stripe.com)).

The right answer: **Stripe is the source of truth. Supabase is our fast, local cache. Webhooks keep them in sync.** Users authenticate through Supabase; every page query reads subscription status from Supabase in a single fast query; Stripe only gets called when the user initiates a billing action (checkout, cancel, update card).

This lesson explains why that architecture is correct, what data belongs in each system, and what the sync contract looks like. Module 7 builds the migrations and service functions — this lesson is the conceptual foundation they rest on.

## Prerequisites

- Lessons 6.1–6.3.1 complete — Stripe client, webhook concepts, endpoint, and `stripe:listen` script all in place.
- Comfort with database tables and foreign keys (Module 1 material).
- Openness to the idea that "cache invalidation" is mostly a solved problem when you design it in from the start.

## What You'll Learn

- Why the "just call Stripe when you need it" approach fails at scale.
- The source-of-truth / read-cache pattern for external-service integrations.
- Exactly which four tables Contactly adds to Supabase: `products`, `prices`, `customers`, `subscriptions`.
- What **not** to store — and why PCI, raw invoices, and checkout sessions are deliberately excluded.
- The sync contract: **webhook → service function → upsert → app reads from Supabase**.

---

## Step 1: The Problem With Always Fetching From Stripe

Imagine Contactly has 10,000 active users. Every single page load needs to know "is this user a Pro subscriber?" to decide whether to show the "Upgrade" banner, whether to allow bulk exports, whether to cap their contacts at 50.

If we fetch from Stripe on every request:

```typescript
// Naive approach — DO NOT DO THIS
export const load = async ({ locals }) => {
	const user = await locals.getUser();
	const subscriptions = await stripe.subscriptions.list({ customer: user.stripeCustomerId });
	return { subscription: subscriptions.data[0] };
};
```

Four problems hit you immediately:

### Problem 1: Rate limits

Stripe's API is rate-limited at roughly **100 reads per second** per account (test mode is even stricter). With 10,000 users, one pageview per second average, you're already at the limit. A traffic spike — say, a blog post lands on Hacker News — and your rate limit trips within seconds. Every request starts returning 429 Too Many Requests. Your app breaks.

### Problem 2: Latency

A call from your server to Stripe's API takes 200–500ms round trip, depending on geography and network conditions. On every page load. Every page that previously rendered in 50ms now takes 250–550ms. Your **server-side rendering** advantage — SvelteKit's killer feature, pages that stream to the browser as fast as possible — is now bottlenecked on a third-party API call you could have avoided.

### Problem 3: Cascading failures

Stripe has had outages. Not often, but the zero isn't zero. When Stripe goes down, if your app calls Stripe on every page load, **your app goes down too**. Users can't log in. Can't view their contacts. Can't do anything — because every load function fails on the Stripe call before it ever reaches your own database.

That's an inexcusable coupling. Your contacts feature has **nothing** to do with billing. A Stripe outage should never block someone from looking at their contact list.

### Problem 4: Impossible to query

Stripe's API lets you filter customers and subscriptions — to a point. But try to answer:

- "How many Pro users signed up in the last 30 days, grouped by day?"
- "Give me every user whose subscription renews this week so I can send a reminder email."
- "Show me a list of all users who canceled but are still in their paid grace period."

Each of these queries would take **thousands** of Stripe API calls, paginating through every subscription, applying your own filtering in application code. Incredibly slow. Stripe isn't a data warehouse; it's a billing engine. Analytics queries on Stripe data need to run against your own database.

---

## Step 2: The Right Architecture — Stripe as Source of Truth, Supabase as Cache

Let's flip the model. We'll store a **denormalized copy** of the Stripe data we care about inside Supabase. Whenever Stripe changes something (new subscription, cancellation, plan change), a webhook fires and updates our Supabase copy. Our app always reads from Supabase.

```
  Write path:

     User action        Stripe                    Webhook       Supabase
     (checkout,         (authoritative            (real-time    (our cache)
      cancel, etc.)     state changes)            sync)
     ──────────────▶   ──────────────▶           ──────────▶   ─────────▶

  Read path:

     User loads a page   Our +page.server.ts    Supabase
                         queries our DB         returns cached
                         ──────────────────▶    subscription ──▶  render
```

Two distinct paths. **Writes go through Stripe.** Reads stay inside our stack.

### Why this works

**Stripe is the source of truth.** If anyone asks "does Alice have a subscription right now?" the authoritative answer lives in Stripe's systems. We never pretend otherwise — if there's ever a disagreement, Stripe wins and our cache is wrong.

**Supabase is a read cache that's kept current by webhooks.** The webhook endpoint (we built it in lesson 6.3) is the dedicated, idempotent sync mechanism. Every Stripe state change → a webhook → an upsert into Supabase → the cache is current within ~seconds.

**Our app reads from Supabase, always.** Fast. Reliable. Under our control. Capable of any SQL query we can imagine. Composable with our own tables (join subscriptions with contacts, filter by user, aggregate by month).

This pattern has a name in distributed systems: **materialized view**. We're materializing Stripe's API into a local relational view tuned for our read patterns. It's one of the oldest, best-understood patterns in database engineering.

### Why writes still go through Stripe

Writes — creating subscriptions, canceling, upgrading, updating card — **must** go through Stripe. It's the source of truth; we can't bypass it. We call Stripe's API, Stripe updates its state, a webhook fires back, our cache syncs. The user only ever sees the end state.

Never write "subscription status: active" directly into Supabase. That desynchronizes the cache from reality. Stripe says the subscription is canceled; our Supabase row says active; our app grants access that Stripe won't bill for. Bug city.

Rule: **the only thing that writes to our Supabase billing tables is the webhook handler.** No feature code — no form action, no button click, no admin interface — writes subscription data directly. If you need to change a subscription, you call Stripe, Stripe calls us back.

---

## Step 3: The Four Tables Contactly Adds

Module 7 writes the actual migration. Here's the shape so you know what we're building toward.

### Table 1: `products`

Represents the **what** — the distinct things you sell. In Contactly, we'll have two products: "Basic" and "Pro."

Key columns:

- `id` (matches Stripe's `prod_...` ID — this is also our primary key)
- `name` — "Basic", "Pro"
- `description`
- `active` — so we can soft-hide discontinued products from pricing pages
- `metadata` — freeform JSONB for any custom tags

Why store products in Supabase? Because the `/pricing` page — a public, high-traffic route — needs to render fast and with no Stripe round-trip. Every visitor who might become a customer sees the pricing page. It's called thousands of times more than any authenticated feature. Fetching from Stripe on every render is the wrong call.

### Table 2: `prices`

A **price** is how a product is sold. One product can have multiple prices (monthly vs annual, USD vs EUR, with-trial vs without-trial). Stripe models this explicitly.

Key columns:

- `id` (matches Stripe's `price_...` ID)
- `product_id` → references `products.id`
- `currency` — "usd", "eur", etc.
- `unit_amount` — amount in smallest currency unit (cents for USD — $10.00 = 1000)
- `interval` — "month", "year"
- `interval_count` — usually 1; could be 3 for "every 3 months"
- `active`

Why separate from products? Because products are **what** you sell; prices are **how** you sell them. "Contactly Pro" (product) can be billed monthly ($10/mo) or annually ($100/yr) — two prices, one product. Storing both tables lets the pricing page show "Save $20 by paying annually!" with a simple join.

### Table 3: `customers`

Stripe's "customer" concept is separate from your app's "user." A Stripe Customer is a billable entity — email address, default payment method, billing history. It may or may not map 1:1 to your app's user.

For Contactly it's 1:1: every user who starts a subscription gets a Stripe Customer. We need to remember which Stripe Customer ID belongs to which user, so the webhook can look up "event.customer = cus_abc, which of our users is that?"

Key columns:

- `user_id` → references `auth.users(id)` (or `profiles(id)`, following our indirection rule)
- `stripe_customer_id` — the `cus_...` ID
- `email` — denormalized for convenience; could just join auth.users

This is the mapping table. It's small, changes rarely, and is the glue between Stripe's world and ours.

### Table 4: `subscriptions`

The big one — this is the table your app reads **most often**. On every authenticated page, we'll look up the current user's subscription row to decide what features they have access to.

Key columns:

- `id` (matches Stripe's `sub_...` ID)
- `user_id` → references user (via profiles)
- `status` — `active`, `trialing`, `past_due`, `canceled`, `unpaid`, `incomplete`
- `price_id` → references `prices.id` (which plan they're on)
- `current_period_start`, `current_period_end` — billing cycle boundaries
- `cancel_at_period_end` — boolean for "they clicked cancel, but haven't expired yet"
- `trial_end` — when their trial ends (if applicable)

Writing a query like "does this user have access to Pro features?" becomes:

```typescript
const { data: subscription } = await locals.supabase
	.from('subscriptions')
	.select('status, price_id')
	.eq('user_id', user.id)
	.single();

const hasPro = subscription?.status === 'active' || subscription?.status === 'trialing';
```

Fast. One query. Always correct (because webhooks keep it fresh). No Stripe round-trip.

---

## Step 4: What We Deliberately Do NOT Store

As important as what we **do** cache is what we don't. Three categories:

### 1. Payment methods (cards)

Card numbers, expiration dates, CVV, billing addresses attached to cards — **never in our database**. Ever.

This is about **PCI compliance**. PCI DSS (Payment Card Industry Data Security Standard) is the legal framework governing handling of card data. Storing card data in your own database requires certification, audits, extensive security controls, and legal liability if leaked.

Stripe exists, in large part, so you don't have to do this. They're a PCI Level 1 service provider; they handle card data on your behalf. Your app never even sees the card number — Stripe Checkout collects it, tokenizes it, stores it, uses it to make charges. You only ever see a token (`pm_...`) that represents the card.

Rule: **card data never enters your codebase, logs, database, or analytics.** If you ever write a `.log(cardNumber)`, delete your hard drive and start over. (Joking. But only barely.)

### 2. Raw invoices

Stripe stores every invoice — monthly billing statements with line items, tax calculations, amounts in each currency, payment attempts. All of it.

We **could** cache invoices in Supabase — but we don't, because:

- We don't display invoice data frequently (most users never look at billing history).
- When they do, they go to the Stripe Customer Portal, which Stripe hosts and keeps current.
- Caching invoices means building UI to render them, handling tax complexity, dealing with currencies, managing credits and refunds. Enormous scope for little user value.

Rule: **let Stripe show invoices via the Customer Portal.** We'll wire up portal redirects in Module 8. Zero custom invoice code.

### 3. Checkout sessions

A "checkout session" is the short-lived object Stripe creates when a user clicks "Upgrade" — it represents an in-progress payment flow. It expires after 24 hours or on completion.

These are ephemeral by design. Caching them would be pointless — by the time your cache is warm, the session is already expired or consumed. And the webhook `checkout.session.completed` fires once per session, giving us a single chance to act. After that, the session is done.

Rule: **handle `checkout.session.completed` in the moment; don't persist the session.** Extract what you need (customer ID, subscription ID) and update your other tables.

---

## Step 5: The Sync Contract

Here's the data flow in full. Commit this to memory — it's the shape of every feature in Modules 7 and 8.

### Write flow (state changes in Stripe)

```
  User action                    Stripe                Webhook endpoint             Supabase
  ─────────────                  ──────                ────────────────             ──────────

  1. Clicks "Upgrade"
     on /pricing
          │
          ▼
  2. Form action calls
     stripe.checkout.sessions
     .create(...)
          │
          ├────────── POST ──────▶
                                  │
                                  │ Creates session
                                  │ Returns URL
          ◀──────── URL ──────────┤
          │
  3. Redirect user to
     Stripe-hosted checkout
          │
          │  (user enters card,
          │   Stripe charges,
          │   redirects back)
                                  │
  4. Stripe fires events:
                                  ├── checkout.session.completed ──▶
                                  ├── customer.subscription.created ──▶
                                  ├── invoice.payment_succeeded ──▶
                                                                    │
                                                              5. Handler:
                                                                 - upsertCustomer
                                                                 - upsertSubscription
                                                                 - log invoice
                                                                 ──────────────▶    stripe_customer_id in customers
                                                                                    subscription row in subscriptions

```

### Read flow (app queries subscription state)

```
  User visits /dashboard       SvelteKit load()         Supabase
  ─────────────────────        ──────────────           ─────────

  1. GET /dashboard
          │
          ▼
  2. locals.getUser()
          │
  3. supabase.from('subscriptions')
     .select(...)
     .eq('user_id', user.id)
     .single()
          │
          ├────────────────── SQL ──────────────────▶

  4. Returns subscription row
     (status, price_id, etc.)
          ◀──────── result ────────────────────────────┤

  5. Render dashboard with
     subscription-aware features
```

Notice the asymmetry: **writes involve Stripe**, **reads stay local**. Stripe is always the source of truth, but the app avoids the API call on every request.

### The contract as a rule

State this as a one-sentence team rule:

> **The only code path that writes to our billing tables (products, prices, customers, subscriptions) is the webhook handler. All other code reads, never writes.**

Enforce this with code review. If someone adds a `supabase.from('subscriptions').update(...)` in a form action, reject the PR. The invariant — webhook is the sole writer — keeps the system coherent. Break the invariant and you'll eventually have stale or desynced data and nobody will be able to reason about why.

---

## Common Mistakes

### Mistake 1: "Let me just write the subscription myself, it'll be faster"

You create a subscription via the Stripe API. The API returns `{ id: 'sub_abc', status: 'active', ... }`. You think "I already have the data — let me insert into my subscriptions table right now."

Two problems:

1. You'd duplicate logic the webhook handler will also run (on the `customer.subscription.created` event that fires minutes later).
2. If the initial insert succeeds but the webhook then fails or differs, your table has two representations of truth.

Let the webhook be the sole writer. The form action's job is to call Stripe and redirect — not to update your own database.

### Mistake 2: Caching too much

It's tempting to also cache payment methods, invoices, charge history, all of it — "just in case." Don't. Every table is a new consistency burden. Every new field is a new webhook handler to maintain. Cache only what you **read on every request** (subscription status, mostly) and fetch the rest on-demand via portal links.

### Mistake 3: Forgetting that `price_id` matters more than you think

When a user upgrades from Basic to Pro, the subscription row's `price_id` changes. If your access-control logic checks `status === 'active'` but not the `price_id`, **basic users get Pro features just by being subscribed to anything**. Always check the price (or product) in access-control logic.

We'll bake this into a helper in Module 8: `canUserAccess(feature, subscription)` that consults both status and price.

### Mistake 4: Not handling the "first load" edge case

What if a user just signed up and is now on `/dashboard` but the webhook hasn't fired yet? The subscriptions query returns 0 rows. Your code needs to handle "no subscription" gracefully — treat them as a free user until the webhook arrives and the row appears.

Design your access-control logic around "subscription OR null." Don't crash on null.

### Mistake 5: Using `service_role` in feature code

The subscriptions table will have RLS policies restricting each user to their own row. You read it via `locals.supabase` (user-scoped), which respects RLS. The webhook handler reads/writes via `supabaseAdmin` (service role, bypasses RLS). Keep the usage **strict**: service role only inside webhook handlers and explicitly admin-only scripts. If feature code needs to read billing data, use `locals.supabase`.

### Mistake 6: Treating the cache as primary

If your Supabase table says "active" but Stripe says "canceled," Stripe wins. Don't argue with Stripe. If a user disputes their subscription status, check Stripe's dashboard first. If there's a drift, your webhook missed an event or failed to process it — investigate logs, replay the event from Stripe's dashboard, re-sync.

The cache is **secondary** truth. Never argue it against the source.

---

## Principal Engineer Notes

### 1. Cache invalidation is solved — when you design it in from the start

"There are only two hard problems in computer science: cache invalidation and naming things." This lesson makes cache invalidation almost trivial because we designed for it: **webhooks invalidate the cache automatically**. Every state change in Stripe produces a webhook that updates Supabase within seconds. We never have to write "cache invalidation logic" because Stripe already does it for us, via the event stream.

The generalization: if you ever integrate a service with a webhook mechanism, use webhooks for cache invalidation. If the service only offers polling, consider whether you actually need the cache — or consider polling a leaderboard-style endpoint every few minutes, accepting the latency.

### 2. Source-of-truth discipline

The software world is full of "two places where the same fact is stored, and they disagree." User Profile in `users` table and in `profiles` table — which has the real email? Subscription in Stripe and in your database — which is live?

The cure is one simple rule: **for every piece of data, name the source of truth, and ensure all other storage is derived from it.** Stripe is the source of truth for subscription state. Supabase is derived. `auth.users` is the source of truth for user identity. `profiles` is derived (via trigger). Your own database rows for contacts — that's the source of truth, because it's **your** domain.

Writing this down ("Stripe is the source of truth for billing") makes it obvious why you never write to subscriptions from feature code. Feature code writes to its own source-of-truth tables. Feature code reads from derived tables. Clear, enforceable, composable.

### 3. Failure modes when webhooks get dropped

What happens if our webhook endpoint is down for 4 hours? Stripe retries with exponential backoff (per lesson 6.2). All events eventually reach us. The cache catches up. During the outage, users who change their billing see a lag between "I upgraded" and "the app shows Pro features" — annoying but not catastrophic.

What if the endpoint is up but buggy — the handler errors silently for a specific event type? Stripe retries for 72 hours, then gives up. The event is permanently missed unless we notice. Our cache diverges from Stripe.

Mitigation:

- **Log every event.** When cache drift is suspected, logs tell you which events arrived.
- **Monitor error rates.** If your webhook handler's error rate spikes, alert on it.
- **Implement a reconciliation job.** Once a day, a background script compares Supabase subscriptions with Stripe's `subscriptions.list` and flags any discrepancies. We'll build this in Module 11 as a scheduled job.

Defense in depth. Webhooks are the primary mechanism; reconciliation catches the rare misses.

### 4. Reconciliation jobs — the safety net

A simple reconciliation script:

```typescript
// Run daily
for await (const stripeSub of stripe.subscriptions.list({ status: 'all' })) {
	const { data: ourSub } = await supabaseAdmin
		.from('subscriptions')
		.select('*')
		.eq('id', stripeSub.id)
		.single();

	if (!ourSub || ourSub.status !== stripeSub.status) {
		await upsertSubscription(stripeSub); // correct the drift
		console.warn('Drift detected:', stripeSub.id);
	}
}
```

In a high-stakes production SaaS, you run this nightly. In a small SaaS, maybe weekly. In a tutorial project, you probably skip it — but know the pattern. The same shape of script (compare source of truth with cache, upsert drifts) works for any integration.

### 5. The "subscriptions" table as the beating heart of your SaaS

Every single access-control decision your app will ever make — for the rest of its life — reads from the `subscriptions` table. It's the single hottest read in the system. Index it well (`user_id` as a btree index; consider a composite index on `(user_id, status)`). Keep it small (one row per user). Denormalize liberally — if checking access requires joining 3 tables, that's a performance tax you pay on every request.

For Contactly's simple billing model (one subscription per user), the table stays small and fast. For complex models (users in multiple teams, each team has a subscription, users inherit access from teams), you'd add a `subscription_access` view or materialized view that pre-computes "which features can this user access" — so the hot path is still a single-row, single-column lookup.

### 6. The cost of not designing this upfront

Every SaaS that's been around long enough has a "refactoring hell" story where the team realized they were calling Stripe on every page, hit rate limits, scrambled to add caching after the fact, discovered their analytics queries were impossible to run, and spent a quarter doing what a week of upfront design would have handled.

The architecture in this lesson — source of truth, cache, webhooks, the sync contract — is boring and correct. Build it in from day one and it never becomes a problem. Try to add it later and you'll pay in double.

This is why the course has a whole module on Stripe **before** any billing feature gets built. The foundation is worth more than the features built on it.

---

## Summary

- Calling Stripe on every request fails for four reasons: rate limits, latency, cascading outages, inability to query.
- The right pattern: **Stripe is source of truth, Supabase is cache, webhooks sync them.**
- Contactly caches four tables in Supabase: `products`, `prices`, `customers`, `subscriptions`.
- We deliberately **don't** store: payment methods (PCI), raw invoices (let Stripe's portal handle them), checkout sessions (ephemeral).
- Write path: user action → Stripe API call → webhook → Supabase upsert.
- Read path: page load → query Supabase → render. Never call Stripe during reads.
- The invariant: **only the webhook handler writes to billing tables.** Feature code reads only.
- Failures are handled by Stripe retries + reconciliation jobs.

## What's Next — and End of Module 6

You now understand the full conceptual shape of Stripe-powered billing in SvelteKit. You have a typed client, a working webhook endpoint, a development-workflow script, and a clear mental model of the data architecture. That's the entire foundation of Module 6.

Module 7 puts it to work: writing the migration for `products`, `prices`, `customers`, `subscriptions`; generating TypeScript types from the migration; writing the service functions (`upsertCustomer`, `upsertSubscription`, etc.) that the webhook handler will call; and testing the full write-read loop end-to-end. Your webhook endpoint's empty `case` blocks — the ones that just log today — get filled in with real persistence code.

Module 8 then builds the user-facing billing features: pricing page, checkout flow, customer portal, upgrade/cancel buttons. The heavy lifting is done. From here it's mostly UI and wiring together the infrastructure you've just built.

You're ready.
