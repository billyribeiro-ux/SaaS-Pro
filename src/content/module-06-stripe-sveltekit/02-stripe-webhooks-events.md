---
title: "6.2 - Stripe Webhooks & Events"
module: 6
lesson: 2
moduleSlug: "module-06-stripe-sveltekit"
lessonSlug: "02-stripe-webhooks-events"
description: "Understand why webhooks are essential for SaaS billing and which events you need to handle."
duration: 15
preview: false
---

## Overview

This is a **concept lesson**. No code to type. No files to create. Just fifteen minutes to carefully reshape how you think about the data flow between your app and Stripe — because if you don't understand this correctly, the next three lessons will feel like magic incantations and you'll ship bugs the next time Stripe changes anything.

Here's the claim: **in a real SaaS, the single most critical piece of infrastructure between your app and your payment processor is a webhook endpoint**. Not the checkout page. Not the pricing page. Not the customer portal. The webhook. Get the webhook right and everything downstream works. Get it wrong and users get charged but their subscription never activates, or users cancel but keep their paid access forever, or a Stripe retry creates three copies of the same subscription in your database.

After this lesson you'll understand:

1. Why webhooks are the only sane way to sync payment state.
2. The full lifecycle of a Stripe event from "user clicks pay" to "your app updates its UI."
3. The six specific events Contactly listens for — and what each one tells you.
4. How Stripe's signature verification defends against forged events.
5. Why your webhook handler must be idempotent, fast, and tolerant of retries.

## Prerequisites

- Lesson 6.1 complete — you have a typed Stripe client.
- Willingness to think carefully about distributed systems for a few minutes.

## What You'll Learn

- The definition of a webhook, and why polling is the wrong alternative.
- The webhook lifecycle: event → HTTP POST → handler → 200 OK → Stripe's retry logic.
- The six Stripe events Contactly handles.
- Webhook signature verification with `STRIPE_WEBHOOK_SECRET` and `constructEvent()`.
- The endpoint URL Stripe expects: `POST /api/webhooks/stripe`.

---

## Step 1: What Is a Webhook (And Why Do We Need One)?

Here's a simple problem. A user, Alice, clicks "Upgrade to Pro" in Contactly. She enters her card. Stripe processes the payment. **Now what?**

Your app needs to know:
- The payment succeeded.
- Alice is now a Pro subscriber.
- Her subscription ID, plan, billing cycle end date, and customer ID are all X, Y, Z.

How does your app learn this?

### The Wrong Answer: Polling

You could write a loop: "every minute, check Stripe's API for new subscriptions and update our database."

This approach is how software worked in 1998. It's wrong for 2026 for four reasons:

1. **Latency.** The user stares at a loading spinner for up to a minute while you wait for the next poll.
2. **Wasted requests.** 99% of your polls return "no change." Stripe rate-limits you. Your server's CPU is burnt on no-ops.
3. **Race conditions.** Between two polls, a subscription could be created **and** canceled. You miss the middle state.
4. **Unscalable.** Ten customers → fine. Ten thousand → you're hammering Stripe's API constantly, burning API rate limits.

Polling is a broken model for event-driven systems. Which is what billing is.

### The Right Answer: Webhooks

A **webhook** inverts the relationship. Instead of your app asking Stripe "anything new?" every minute, **Stripe tells your app the moment something happens.** Stripe makes an HTTP POST request to a URL you provided (`https://contactly.com/api/webhooks/stripe`), carrying a JSON payload describing exactly what just happened.

Mental model: polling = you phone Stripe every minute. Webhooks = Stripe phones you the instant something changes.

The benefits:

1. **Real-time.** Within milliseconds of a payment clearing, your app knows.
2. **Efficient.** Zero wasted calls. You're only notified when there's something to act on.
3. **Complete.** Stripe sends every event, in order. No race conditions, no missed states.
4. **Scales perfectly.** One customer or one million customers — Stripe handles the "who to notify" routing, and your endpoint just processes incoming POSTs.

This is why literally every payment processor, every SaaS integration platform, every CI/CD system uses webhooks. They are **the** mechanism for cross-system event propagation in modern software.

---

## Step 2: The Webhook Lifecycle — Start to Finish

Let's trace what happens when Alice upgrades, step by step:

```
  Alice's Browser                Contactly App              Stripe
  ───────────────                ─────────────              ──────
                                                              
  1. Clicks "Upgrade to Pro"                              
      │                                                   
      └──────── POST /upgrade ────▶                        
                                  │                        
  2.                              │ Creates Checkout Session
                                  │ via stripe.checkout.    
                                  │ sessions.create(...)   
                                  │                         
                                  └──── POST /v1/checkout/sessions ──▶
                                                                       │
                                                        Returns session URL◀
                                                                       │
  3.                              │ Receives URL           
      ◀────────── Redirect ───────┘                        
      │                                                    
  4. Browser navigates to Stripe Checkout (Stripe-hosted page)          
      │                                                    
      └─────── Enter card info ──────────────────────────▶  
                                                           │
                                                           ┌─────▶ Stripe processes payment
                                                           │         (charges the card)
                                                           │
  5.                              ◀─── POST /api/webhooks/stripe ──┐
                                                           │        │
                                                           │   "checkout.session.completed"
                                                           │
                                  │ Handler processes event
                                  │ Updates Supabase        
                                  │                         
                                  ├──── 200 OK ────────▶    
                                                           │
  6. Browser redirects back to Contactly /dashboard         
      ◀─────── Thank-you page ────┘                         
```

Six steps. The key insight is step 5 — the webhook — happens **in parallel** with step 6 (browser redirect). Stripe does not rely on Alice's browser making it back to your app. Even if Alice closes her tab mid-redirect, the webhook still fires, and your database still updates.

This decoupling is essential. It means:

- **Payment state is independent of user navigation.** Network flakes, tab crashes, mobile browser quirks — none break billing.
- **Your frontend doesn't need to "call Stripe to confirm."** Stripe already told the backend.
- **Multiple events can fire per payment.** A single subscription create fires `checkout.session.completed`, `customer.subscription.created`, and `invoice.payment_succeeded` — three separate webhook deliveries — each triggering a different piece of logic.

---

## Step 3: The Retry Contract

What if your webhook endpoint is down? Or slow? Or buggy?

**Stripe retries.** That's the whole contract.

When Stripe POSTs to your webhook URL, it expects to receive a **2xx HTTP response** (usually 200). If it does:

- Stripe considers the event **delivered**. It marks the delivery successful in its internal log and moves on.

If it doesn't (no response, or 4xx, or 5xx, or timeout after 30 seconds):

- Stripe considers the event **undelivered**. It queues a retry.
- Retries use **exponential backoff**: roughly 1 hour, then 2 hours, then 4 hours, then 8 hours, up to ~72 hours of attempts (the exact schedule is documented on Stripe's site and evolves).
- If every retry fails, Stripe eventually gives up and marks the event as permanently failed. You can replay it manually from the Stripe dashboard.

Two implications for your code:

### Implication 1: Respond with 200 fast

Stripe's timeout is generous (30 seconds) but you don't want to hold the connection open for complex processing. If your webhook handler does heavy work — sends emails, generates PDFs, recomputes analytics — the naive implementation blocks Stripe's request and risks timeout.

The pattern: **parse → verify → enqueue → return 200.** Push the heavy lifting into a background job. Your webhook handler does just enough work to persist the event and acknowledge receipt.

For Contactly (small scale, fast database writes), we can afford to do the full work inline. For a larger SaaS, you'd introduce a queue.

### Implication 2: Your handler MUST be idempotent

"Idempotent" means: **running the handler twice with the same input produces the same final state as running it once.** Because Stripe retries, you **will** receive the same event multiple times. Your code must tolerate this.

Examples of non-idempotent code:

```typescript
// BAD: if we process this event twice, we grant 2 months of Pro access
await extendSubscription(userId, { days: 30 })
```

```typescript
// BAD: creates a duplicate row in the subscriptions table
await supabase.from('subscriptions').insert({ stripe_id: sub.id, ... })
```

Examples of idempotent code:

```typescript
// GOOD: sets the end date to an exact value; re-running sets the same value
await supabase.from('subscriptions').update({
  current_period_end: new Date(sub.current_period_end * 1000).toISOString()
}).eq('stripe_id', sub.id)
```

```typescript
// GOOD: upsert — inserts or updates, never duplicates
await supabase.from('subscriptions').upsert({
  stripe_id: sub.id,
  user_id,
  status: sub.status,
  ...
}, { onConflict: 'stripe_id' })
```

**Upserts are your best friend in webhook handlers.** Use them everywhere. In Module 7 we'll build service functions (`upsertSubscription`, `upsertCustomer`, etc.) that bake idempotency into the data layer so you don't have to think about it per-event.

---

## Step 4: The Six Events Contactly Handles

Stripe fires **hundreds** of different event types. You ignore 99% of them. Contactly subscribes to exactly six:

### 1. `checkout.session.completed`

**Fires when:** a user successfully completes a Stripe Checkout flow (enters valid card, payment clears).

**Payload:** `Stripe.Checkout.Session` — includes the customer ID, subscription ID (if a subscription was created), line items, payment status.

**Why we care:** this is the **"user has paid, set them up"** signal. Contactly uses this event to:
- Retrieve the new customer and subscription IDs.
- Create or update the `customers` row linking `user_id ↔ stripe_customer_id`.
- Insert the initial `subscriptions` row.

### 2. `customer.subscription.created`

**Fires when:** a subscription is created on a Stripe customer — including via Checkout, API, or the billing portal.

**Payload:** `Stripe.Subscription` — full subscription object with status, items (price IDs), periods, metadata.

**Why we care:** source of truth for "this customer now has a subscription." Contactly upserts the `subscriptions` table with the current status.

**Overlaps with `checkout.session.completed`?** Yes — a typical Checkout flow fires both. This is fine because our handlers are idempotent. Each event is useful in contexts where the other doesn't fire (e.g., creating a subscription purely via API won't fire `checkout.session.completed`).

### 3. `customer.subscription.updated`

**Fires when:** a subscription changes — plan upgrade/downgrade, trial conversion, card update, renewal, Stripe reactivates a canceled subscription.

**Payload:** `Stripe.Subscription` — the current state of the subscription.

**Why we care:** keeps our cache in sync when anything changes. User upgrades from Basic to Pro? This event fires with the new price ID. User's trial ends and converts to paid? This fires. Renewal extends the period? This fires.

The beauty: we don't need to enumerate every possible change. We just upsert the latest subscription state into our database. The event tells us "something changed, here's the new state."

### 4. `customer.subscription.deleted`

**Fires when:** a subscription is canceled (either immediately or at the end of the period, after the period actually expires). Think of this as "the subscription is truly over now."

**Payload:** `Stripe.Subscription` — final state, with `status: 'canceled'`.

**Why we care:** time to revoke the user's paid access. Contactly updates the `subscriptions` row to `status: 'canceled'`. Our UI logic (which we'll build in Module 8) reads the subscription status on every request and renders different UI for canceled users.

### 5. `invoice.payment_succeeded`

**Fires when:** an invoice is paid — including the first payment of a new subscription and every renewal afterwards.

**Payload:** `Stripe.Invoice` — invoice ID, amount paid, period, subscription reference.

**Why we care:** useful for billing history UIs ("show me my past invoices"), analytics, and for triggering in-app effects like "unlock premium features for another 30 days" confirmations. Minimal for Contactly — we mostly rely on the subscription events — but we log it for observability.

### 6. `invoice.payment_failed`

**Fires when:** a scheduled renewal payment fails (card declined, insufficient funds, expired card).

**Payload:** `Stripe.Invoice` — with `status: 'open'` and a record of the failure.

**Why we care:** **this is where you save revenue.** A failed payment doesn't immediately cancel the subscription — Stripe will retry the card on a schedule (configurable: up to 4 attempts over ~3 weeks). During this window, the subscription is in `status: 'past_due'`.

Your job in this event: notify the user. Send an email, show a banner in-app, give them a link to the customer portal to update their card. Every 24 hours a user sits in `past_due` without updating their card, you lose them. Recovering failed payments is one of the highest-ROI features you'll ever build.

(Contactly's in-app email notification is in a later module; for now the webhook just logs the event. We have the hook; we'll wire it up once the email infrastructure is in place.)

### The events we deliberately ignore

Stripe fires events like `charge.succeeded`, `payment_intent.succeeded`, `invoice.created`, `customer.updated`, `product.updated`, `price.created`, etc. We don't subscribe to most of them because:

- Their data is already included in the six events we do subscribe to.
- Handling redundant events is noise — more chances for bugs, more to test.
- Less is more. A minimal, well-reasoned webhook surface is safer than "listen to everything."

The rule: subscribe only to events you have a specific handler for. Any event you don't care about shouldn't reach your endpoint.

---

## Step 5: Webhook Signature Verification

Here's a problem. Your webhook endpoint is at a public URL — `https://contactly.com/api/webhooks/stripe`. **Anyone on the internet** can send a POST to that URL.

A malicious actor could forge a request that looks like it came from Stripe. The payload claims "user X just paid $10,000, grant them lifetime Pro access." Your handler updates the database. Free lifetime Pro, no payment, on a request that never touched Stripe.

The defense: **webhook signatures**.

Here's how it works:

1. When you configure a webhook endpoint in Stripe (or with `stripe listen`), Stripe gives you a secret, prefixed `whsec_...`. Call it `STRIPE_WEBHOOK_SECRET`.
2. Every time Stripe POSTs to your endpoint, it computes an HMAC-SHA256 signature of the request body using this secret. It sends the signature in a header: `Stripe-Signature: t=..., v1=...`.
3. Your endpoint receives the request. Before trusting any of it, you re-compute the HMAC using the same secret and the same body. Compare against the header.
4. If they match, the request genuinely came from Stripe (or from someone who has your secret, which is also dangerous but a separate problem). If they don't match, reject with HTTP 400.

The Stripe SDK exposes this as `stripe.webhooks.constructEvent(body, signature, secret)`. It returns the parsed event object on a valid signature or throws an error on invalid/forged.

**Two critical implementation details** that we'll cover in lesson 6.3:

1. **Read the raw body, not JSON.** Signature verification requires the **exact byte sequence** Stripe sent. Parsing with `request.json()` would re-serialize and potentially change whitespace/key order, breaking the signature. Use `request.text()`.
2. **Never trust an unverified event.** Verify first, then access `event.data.object`. Don't even log the event type before verification — that's how subtle bugs sneak in.

The signature is your only defense. Forget it and you leak money.

---

## Step 6: The Endpoint URL

Contactly's webhook endpoint will live at:

```
POST https://<your-domain>/api/webhooks/stripe
```

Locally during development, this is `http://localhost:5173/api/webhooks/stripe`. In production, it's whatever domain you deployed to.

A few conventions baked into that URL choice:

- **`/api/...`** — a conventional prefix for programmatic endpoints. Distinguishes from user-facing routes.
- **`/webhooks/...`** — a subdirectory for inbound webhook handlers. You may add more integrations later (GitHub, Slack, Intercom) — each gets its own file under `/webhooks/`.
- **`/stripe`** — the specific source. Not `/billing` or `/payments`. Be explicit. A future-you with three webhook integrations will appreciate it.
- **`POST` method only** — webhooks are always POST. Your `+server.ts` file will export only a `POST` handler; GET requests (say, a curious person typing the URL in a browser) return 405 Method Not Allowed.

---

## Common Mistakes

### Mistake 1: Parsing the body with `request.json()`

```typescript
const event = await request.json()  // WRONG
// Signature verification will fail because the body bytes have been consumed
// and re-serialization differs from what Stripe sent.
```

Always `await request.text()` for webhook endpoints. Verify the signature against the raw string, then parse.

### Mistake 2: Subscribing to every Stripe event

Stripe offers a "listen to all events" option in dashboard setup. Don't. Your endpoint gets flooded with events for things it doesn't care about, every one of them burns CPU parsing them, and you'll miss actually-important events in the noise.

Subscribe narrowly. Our six are enough for a full subscription SaaS.

### Mistake 3: Assuming events arrive in order

Stripe tries hard to deliver events in order, but distributed systems don't guarantee it. You might receive `customer.subscription.updated` before `customer.subscription.created` if network paths differ.

Your handlers must tolerate out-of-order delivery. For Contactly, this means: **always upsert the latest state, never assume a prior state existed.** The `customer.subscription.updated` handler should happily create the subscriptions row if it doesn't exist yet — because the `.created` event might arrive next.

### Mistake 4: Returning a non-2xx status for unhandled event types

```typescript
default:
  return json({ error: 'Unknown event' }, { status: 400 })  // WRONG
```

Stripe will retry. Repeatedly. For 72 hours. For events you **chose not to handle**. Always return 200 for events you don't care about. Stripe needs to know the event was received successfully, even if your business logic was a no-op.

### Mistake 5: Doing slow work inline

```typescript
// Handler takes 25 seconds because it calls 5 APIs and renders a PDF.
// Stripe timed out at 30s. Retry coming.
```

Webhook handlers should be fast (sub-second). Heavy work belongs in a queue. For Contactly's scale a database upsert is fast enough, but the principle is important as you grow.

### Mistake 6: Logging the event body before verification

```typescript
console.log('Received event:', await request.json())  // BAD
const event = stripe.webhooks.constructEvent(...)      // too late
```

Unverified events should not enter your logs, your database, or your analytics. Treat them as hostile input. Verify first, then process.

---

## Principal Engineer Notes

### 1. Idempotency at scale is a system-design property, not a per-handler detail

Every event handler for every webhook for every service should be idempotent. This is less about writing `INSERT ... ON CONFLICT` statements and more about **designing data models where "the same event twice" is indistinguishable from "the event once."**

The canonical pattern: use the external system's ID as a **unique key** in your table, and write upserts. Stripe's `sub_...` ID is the unique key for a subscription row; the first event creates it, all subsequent events update it, duplicates merge into the same row. You never have to think about deduplication.

The anti-pattern: using your own auto-incrementing ID or a synthetic composite key. Now you need explicit dedup logic (hash of the event, check if we've seen it before, maintain a processed-events table). That logic can be wrong. The external-ID-as-key pattern can't.

Contactly's `subscriptions` table will use `stripe_subscription_id` as the primary key (or a unique constraint). This bakes idempotency into the schema. You'll see the migration in Module 7.

### 2. Replay attacks and timestamp windows

Webhook signatures prevent forgery but not replay. A valid Stripe signature on a real event stays valid forever. An attacker who intercepts a webhook (hard, over TLS, but not impossible) could replay it a week later.

Stripe mitigates this with a **timestamp** in the signature (`t=...`). The SDK's `constructEvent` checks the timestamp is within a recent window (default 5 minutes). Events older than that are rejected even if the signature is valid.

For almost all use cases, the SDK's default tolerance is right. If you need tighter windows, `constructEvent` accepts a custom tolerance parameter. If you're not sure, default.

### 3. Eventually consistent, not instantly consistent

Users are used to "I clicked pay, it worked, my app updated immediately." Webhooks are **eventually consistent** — there's always a delay between "Stripe processed the payment" and "your database reflects it," measured in seconds.

For Contactly that's fine — the user is redirected to the dashboard, which fetches the latest subscription from our database (kept fresh by webhooks). By the time they see the page, the data is there.

If it ever isn't (webhook hasn't fired yet), the user sees stale data briefly, then on refresh it's correct. Livable. What's **not** livable is using client-side Stripe calls to check "did the payment work?" — that's where race conditions and doubled charges come from.

**Rule: your UI reads from your database. Your database is synced from webhooks. Stripe is the source of truth; you are its cache.**

### 4. At-least-once delivery semantics

Stripe guarantees **at-least-once** delivery. Every event will be delivered to your endpoint at least once. Possibly more than once (retries after a transient failure).

Implication: your handler must be idempotent (covered). Corollary: you should never rely on "I received this event, so it won't come again." Treat every webhook as potentially-a-duplicate.

### 5. Observability: every event deserves a structured log

Your webhook handler is a black box from outside. The only way to debug production issues is logs. Log every received event with structured fields:

```typescript
console.log({
  webhook: 'stripe',
  event_id: event.id,
  event_type: event.type,
  livemode: event.livemode,
  created: event.created
})
```

When a user reports "my subscription never activated," you grep logs for their Stripe customer ID, see the events received, correlate with Stripe's dashboard, find the broken step. Without logs, you're flying blind.

Log format should be JSON for ingestion into Datadog, Axiom, or similar. For local dev, human-readable is fine. Either way — log **something** for every event.

### 6. A single endpoint is an observability chokepoint — use it

All six events flow through one file. That's an advantage. You can:

- Add a single `console.log({ webhook: 'stripe', type: event.type, id: event.id })` at the top of the handler and instantly see every event as it arrives.
- Add a counter/metrics export to track event rates.
- Add a circuit breaker to disable billing if error rates spike.

Centralizing billing integration behind one endpoint makes it easy to reason about, monitor, and protect. Resist the temptation to scatter Stripe code across your codebase. One endpoint. One file. One place to look when something is wrong.

---

## Summary

- **Webhooks** are how Stripe tells your app "something happened." They replace polling in every nontrivial integration.
- The lifecycle: user pays → Stripe charges → Stripe POSTs event to your endpoint → you process → return 200 → Stripe marks delivered.
- Non-200 response → Stripe retries with exponential backoff over ~72 hours.
- Contactly handles six events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- Webhook signature verification — HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`, checked via `stripe.webhooks.constructEvent(body, signature, secret)` — is the only defense against forged events.
- The endpoint URL: `POST /api/webhooks/stripe`. One endpoint, all events.
- Handlers must be **idempotent**, **fast**, and **tolerant** (always 200 for unknown types).

## What's Next

Lesson 6.3 is the payoff. We'll write the actual webhook endpoint — `src/routes/api/webhooks/stripe/+server.ts` — with signature verification, a typed switch over the six event types, and correct status codes for every failure mode. The concepts from this lesson become fifty lines of production-grade TypeScript.
