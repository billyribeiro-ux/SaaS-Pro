---
title: "6.3 - Create Webhook Endpoint"
module: 6
lesson: 3
moduleSlug: "module-06-stripe-sveltekit"
lessonSlug: "03-create-webhook-endpoint"
description: "Build the Stripe webhook endpoint in SvelteKit with signature verification and event handlers."
duration: 18
preview: false
---

## Overview

Last lesson was concepts. This lesson is code. By the end of it Contactly will have a fully working, signature-verified, event-dispatching webhook endpoint at `POST /api/webhooks/stripe`. Every event Stripe sends will be received, verified, logged, and acknowledged.

One important framing: **the handler we write today is a skeleton, not the final form.** Each case statement in the switch logs the event but doesn't yet update the database. That's deliberate. Filling in `upsertSubscription`, `upsertCustomer`, and the other service functions depends on the `subscriptions` and `customers` tables, which we'll create in Module 7. Today we're building the transport layer. Module 7 builds the persistence layer. Separating them means you can test the webhook delivery pipeline (is Stripe reaching us? are signatures verifying?) before worrying about data models.

This sequencing is a gift — not everyone gets to work in well-planned codebases. Savor it.

## Prerequisites

- Lesson 6.1 complete — `src/lib/server/stripe.ts` exists with a typed client.
- Lesson 6.2 understood — you know what webhooks are, why they matter, and what events we care about.
- `STRIPE_SECRET_KEY` in `.env`. `STRIPE_WEBHOOK_SECRET` will be added in lesson 6.3.1; for now, put a placeholder `STRIPE_WEBHOOK_SECRET=whsec_placeholder` so the import succeeds.
- `$server` alias configured (`$lib/server`) in `svelte.config.js`.

## What You'll Build

- A single file: `src/routes/api/webhooks/stripe/+server.ts`.
- A `POST` handler that reads the raw body, verifies the signature, parses the event, and dispatches on type.
- Correct error responses: 400 for signature failures, 500 for handler errors, 200 for success and unknown events.
- Console logs that let you trace every event through your system.

---

## Step 1: Why `+server.ts` — SvelteKit's API Route File

SvelteKit has three file types inside a route folder:

- `+page.svelte` — renders an HTML page.
- `+page.server.ts` — actions and `load` for a page.
- `+server.ts` — a pure API endpoint. No UI. Handles HTTP methods directly.

For webhooks, we want the third. A webhook endpoint has no UI — it's a programmatic receiver. You export named functions (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) from `+server.ts`, and SvelteKit routes requests to them by method.

Our endpoint only handles POST. No GET, no PUT. If someone sends a GET (a curious human typing the URL in a browser), SvelteKit auto-returns 405 Method Not Allowed. We don't have to write anything for that — the absence of a `GET` export **is** the 405 response.

### Why `/api/webhooks/stripe/` and not just `/webhooks/stripe/`?

The `/api` prefix is a convention, not a requirement. It signals to readers and to any reverse proxy configuration "this route is not user-facing." Future you might configure CloudFront or Cloudflare to apply different caching rules to `/api/*` (no cache, no edge optimization) — having the prefix makes that trivial.

The `/webhooks/` subdirectory leaves room for other inbound integrations: `/api/webhooks/github`, `/api/webhooks/slack`, `/api/webhooks/resend`. They share the convention of "code we didn't write is sending us POSTs" and deserve to be grouped.

---

## Step 2: Create the File

```bash
mkdir -p src/routes/api/webhooks/stripe
touch src/routes/api/webhooks/stripe/+server.ts
```

Open `src/routes/api/webhooks/stripe/+server.ts`. It's empty. Here's the full file we're about to write — copy this into your editor:

```typescript
// src/routes/api/webhooks/stripe/+server.ts
import { json, error } from '@sveltejs/kit'
import { stripe } from '$server/stripe'
import { supabaseAdmin } from '$server/supabase'
import { STRIPE_WEBHOOK_SECRET } from '$env/static/private'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return json({ error: 'No signature' }, { status: 400 })
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>

  try {
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        console.log('Checkout completed:', session.id)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object
        console.log('Subscription changed:', subscription.id, subscription.status)
        break
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        console.log('Subscription deleted:', subscription.id)
        break
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        console.log('Invoice paid:', invoice.id)
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        console.log('Invoice failed:', invoice.id)
        break
      }
      default:
        console.log('Unhandled event type:', event.type)
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return json({ received: true })
}
```

That's the whole file. Let's walk through it line by line.

---

## Step 3: Walking Through the Imports

```typescript
import { json, error } from '@sveltejs/kit'
import { stripe } from '$server/stripe'
import { supabaseAdmin } from '$server/supabase'
import { STRIPE_WEBHOOK_SECRET } from '$env/static/private'
import type { RequestHandler } from './$types'
```

- **`json, error` from `@sveltejs/kit`** — SvelteKit's helpers for returning typed HTTP responses. `json(payload, { status })` builds a JSON Response with a given status code. `error(status, message)` throws a typed error; we're not using it here because we want to return structured error bodies to the client.
- **`stripe` from `$server/stripe`** — the client we built in lesson 6.1. We use it for signature verification (`stripe.webhooks.constructEvent`).
- **`supabaseAdmin` from `$server/supabase`** — the service-role Supabase client. RLS is bypassed here, which is what we need: webhooks run as "Stripe," not as any specific user. We'll use this in Module 7 when the case blocks do real database writes. Imported here now because our subsequent lessons will populate it; leaving the import in place as a forward-looking signal costs nothing.
- **`STRIPE_WEBHOOK_SECRET` from `$env/static/private`** — the `whsec_...` key that signs every event. Same `$env/static/private` discipline we used for `STRIPE_SECRET_KEY` — build-time, server-only, type-safe.
- **`type { RequestHandler } from './$types'`** — SvelteKit auto-generates this type for every route. It describes the exact shape of the event parameter (request, locals, params, etc.) for **this specific route**. Using it gives us full IntelliSense on `{ request }`.

---

## Step 4: The Signature Header

```typescript
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
```

### Line 1: the handler signature

`export const POST: RequestHandler = async ({ request }) => { ... }`

Four things to unpack:

1. **`export const POST`** — SvelteKit looks for an exported function named after the HTTP method. `POST` for POST requests. Other methods (GET, PUT, etc.) aren't defined, so SvelteKit returns 405.
2. **`: RequestHandler`** — typing the function as `RequestHandler` gives us a typed `event` parameter. Destructuring `{ request }` works because `RequestHandler`'s parameter shape includes `request: Request`.
3. **`async`** — our body uses `await`. Standard.
4. **`{ request }`** — destructures from the SvelteKit `RequestEvent`. `request` is a standard Web `Request` object (the platform-native type, same as you'd get in a Service Worker or Cloudflare Worker).

### Line 2: `const body = await request.text()`

**This is the single most important line in the file.**

`request.text()` returns the raw body as a UTF-8 string. Every byte Stripe sent, preserved exactly.

**Why not `request.json()`?** Because webhook signature verification operates on the **exact byte sequence** Stripe used when computing the HMAC. If you do:

```typescript
const body = await request.json()   // parses JSON
const serialized = JSON.stringify(body)  // re-serializes
stripe.webhooks.constructEvent(serialized, ...)  // FAILS
```

The re-serialization can reorder keys, change whitespace, re-escape strings differently. The resulting bytes won't match what Stripe signed. Signature verification fails. Your endpoint rejects every legitimate event.

Always `request.text()` first. Parse later if needed (the SDK does this for you inside `constructEvent`).

### Line 3: `const signature = request.headers.get('stripe-signature')`

Stripe sends the signature in a header named `Stripe-Signature` (HTTP headers are case-insensitive; `.get('stripe-signature')` matches any casing). The value looks like:

```
t=1672531200,v1=5257a869e7ecebeda...
```

Two parts: `t=` (timestamp) and `v1=` (signature). The Stripe SDK parses both.

---

## Step 5: Early Return for Missing Signature

```typescript
if (!signature) {
  return json({ error: 'No signature' }, { status: 400 })
}
```

If the request has no signature header, it can't be from Stripe. Return 400 Bad Request. Some things to note:

- **400, not 401.** The request is malformed (missing required header), not unauthorized. 400 is the right class.
- **Structured JSON body.** Even in error cases, we return JSON, not plain text. Makes it parseable if someone's tooling is consuming the error (e.g., curl | jq for debugging).
- **Short-circuit early.** Don't proceed to signature verification when the signature itself is absent.

---

## Step 6: Signature Verification

```typescript
let event: ReturnType<typeof stripe.webhooks.constructEvent>

try {
  event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)
} catch (err) {
  console.error('Webhook signature verification failed:', err)
  return json({ error: 'Invalid signature' }, { status: 400 })
}
```

### The type declaration

```typescript
let event: ReturnType<typeof stripe.webhooks.constructEvent>
```

This is a TypeScript trick. `ReturnType<T>` extracts the return type of a function type. `typeof stripe.webhooks.constructEvent` gets us the type of the `constructEvent` method. Combined, we're asking TypeScript: "what does `constructEvent` return? Make `event` that type."

The alternative — `let event: Stripe.Event` — would also work. Why did we use `ReturnType`? Two reasons:

1. If Stripe ever refines the return type (e.g., `Stripe.Event & { someNewField: string }`), we automatically pick it up.
2. It shows off TypeScript's type-inference tools — worth knowing for the rest of your career.

Either form is fine in practice. Pick whichever you prefer; I'll switch to `Stripe.Event` in future lessons for brevity.

### The try/catch

`constructEvent` does three things:

1. Computes HMAC-SHA256 of `body` with `STRIPE_WEBHOOK_SECRET`.
2. Compares to the signature in the header.
3. If they match, parses the body as JSON and returns a typed `Stripe.Event`. If they don't match (or the timestamp is too old, or the body is malformed), **throws**.

So wrap it in try/catch. On throw, log the error server-side (for your debugging) and return 400 to Stripe. The client (well, Stripe itself) doesn't get your internal error — they get `"Invalid signature"` and the 400 status. That's all they should see; detailed error messages are an information leak to anyone who's forging requests.

On success, `event` is now a fully-typed `Stripe.Event`. TypeScript knows exactly what fields are available, including the discriminated union on `event.type`.

---

## Step 7: The Switch Block — Type-Narrowing Magic

```typescript
try {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      // TypeScript knows: session is Stripe.Checkout.Session
      console.log('Checkout completed:', session.id)
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object
      // TypeScript knows: subscription is Stripe.Subscription
      console.log('Subscription changed:', subscription.id, subscription.status)
      break
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object
      console.log('Subscription deleted:', subscription.id)
      break
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object
      // TypeScript knows: invoice is Stripe.Invoice
      console.log('Invoice paid:', invoice.id)
      break
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object
      console.log('Invoice failed:', invoice.id)
      break
    }
    default:
      console.log('Unhandled event type:', event.type)
  }
} catch (err) {
  console.error('Webhook handler error:', err)
  return json({ error: 'Webhook handler failed' }, { status: 500 })
}
```

### Type narrowing — why this works

`Stripe.Event` is a **discriminated union**. That means:

```typescript
type Event =
  | { type: 'checkout.session.completed', data: { object: Stripe.Checkout.Session } }
  | { type: 'customer.subscription.created', data: { object: Stripe.Subscription } }
  | { type: 'invoice.payment_succeeded', data: { object: Stripe.Invoice } }
  | ... // many more
```

When you `switch (event.type)` and enter `case 'checkout.session.completed':`, TypeScript **narrows** the type of `event` to the variant where `type === 'checkout.session.completed'`. Inside that case, `event.data.object` is correctly typed as `Stripe.Checkout.Session` — with all its fields (customer, amount_total, line_items, metadata) available and autocompleted.

This is gorgeous. Type narrowing means:

- No manual casts (`as Stripe.Checkout.Session`).
- No runtime type checks.
- Compile errors if you try to access a field that doesn't exist on this event's object.
- IntelliSense shows the correct fields for each case.

It's the reward for pinning `apiVersion` in lesson 6.1 — the SDK ships matching types for the API version.

### Why the braces?

```typescript
case 'checkout.session.completed': {
  const session = event.data.object
  // ...
  break
}
```

The `{ }` block creates a new lexical scope. Without them, declaring `const session` in case 1 and `const session` in case 2 would error — same scope, duplicate `const`. With braces, each case has its own scope, and every case can declare its own variables with familiar names (`session`, `subscription`, `invoice`).

It's a mild stylistic habit but it's the right default for switches that declare variables in each case.

### Combining cases

```typescript
case 'customer.subscription.created':
case 'customer.subscription.updated': {
  const subscription = event.data.object
  // ...
  break
}
```

Two case labels, one body. The two events have the **same** payload type (`Stripe.Subscription`), and the handling logic is the same: upsert the latest subscription state into the database. No reason to duplicate the code.

This is "fall-through" — case 1 falls into case 2, which has the body. The first case is empty (just the label). Totally fine; in fact, the `no-fallthrough` ESLint rule has a specific exemption for empty case labels because this pattern is so common.

### The default case

```typescript
default:
  console.log('Unhandled event type:', event.type)
```

If Stripe ever sends an event we don't handle (they occasionally add new types, or you might accidentally subscribe to more than you intended), we log it and fall through to the final `return json({ received: true })` with status 200.

**Critical:** no `return json({ error: ... }, { status: 400 })` for unknown events. An unknown event is not an error; it's just "we chose not to handle this." Return 200 to tell Stripe "yes, I got it, stop retrying."

### Try/catch around the whole switch

```typescript
try {
  switch (...) { ... }
} catch (err) {
  console.error('Webhook handler error:', err)
  return json({ error: 'Webhook handler failed' }, { status: 500 })
}
```

If any of the case bodies throws (e.g., in Module 7 when we call `upsertSubscription` and the database is temporarily unreachable), we log the error and return 500. Stripe interprets 500 as "try again later" and queues a retry.

Why 500 and not 400? 400 implies bad input — Stripe would interpret it as "my event was malformed, don't retry." 500 says "server error, try again" — exactly what we want for transient failures.

---

## Step 8: The Success Response

```typescript
return json({ received: true })
```

Default status is 200 when you omit the `{ status }` option. The body is a minimal `{ received: true }` — Stripe doesn't read the body on success, it only checks the status. We include the body for our own convenience (when debugging with curl, getting `{ received: true }` back is reassuring).

Keep this one line. Don't be tempted to add "metadata": this response lives in Stripe's delivery log and you don't want it to bloat.

---

## Step 9: Verify the File Works

Start the dev server:

```bash
pnpm dev
```

Try a GET request:

```bash
curl -i http://localhost:5173/api/webhooks/stripe
```

You should get:

```
HTTP/1.1 405 Method Not Allowed
```

That's SvelteKit politely saying "I don't route GETs on this endpoint." Exactly right.

Try a POST without a signature:

```bash
curl -i -X POST http://localhost:5173/api/webhooks/stripe \
  -H 'Content-Type: application/json' \
  -d '{"fake": "event"}'
```

You should get:

```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"error":"No signature"}
```

The signature check rejected it, as designed. To POST with a fake signature:

```bash
curl -i -X POST http://localhost:5173/api/webhooks/stripe \
  -H 'Content-Type: application/json' \
  -H 'Stripe-Signature: t=1,v1=invalid' \
  -d '{"fake": "event"}'
```

You should get:

```
HTTP/1.1 400 Bad Request
{"error":"Invalid signature"}
```

Signature verification failed (as it should — the signature is garbage).

To send a **real** event from Stripe's side, you need the Stripe CLI running locally — which is the whole topic of the next lesson, 6.3.1. We'll get to actual event delivery there.

---

## Common Mistakes

### Mistake 1: Using `request.json()` instead of `request.text()`

```typescript
const body = await request.json()  // WRONG
const event = stripe.webhooks.constructEvent(JSON.stringify(body), ...)
```

Signature verification will fail for every event. This is the #1 webhook bug across the internet. Don't become a statistic.

### Mistake 2: Returning 400 or 500 for unknown event types

```typescript
default:
  return json({ error: 'Unknown event' }, { status: 400 })  // WRONG
```

Stripe will retry this event for 72 hours. Every retry reruns your handler. Return 200 with a log line.

### Mistake 3: Reading the body before signature verification

```typescript
const body = await request.text()
const parsed = JSON.parse(body)
console.log('Event:', parsed.type)  // BAD: logging unverified event
// ... later: signature verification
```

Never inspect the body of an unverified request. An attacker could flood your logs with bogus event types. Verify first, then process.

### Mistake 4: Wrapping `redirect()` from a page action in this handler

Not applicable here — `+server.ts` doesn't have form actions — but worth a general reminder: `redirect()` throws. Don't swallow it in a catch. In our webhook, there's no redirect anyway; we return JSON responses directly.

### Mistake 5: Forgetting to handle `supabaseAdmin` errors in Module 7

Once you start calling `supabaseAdmin.from(...).upsert(...)`, you must check the `{ error }` it returns and throw if present. Otherwise silent failures — database write didn't happen, but your handler returns 200, and Stripe never retries. Users pay, their subscription never activates, and your logs are clean.

We'll write that logic carefully in Module 7. For now, the skeleton is clean.

### Mistake 6: Forgetting to use `break` in switch cases

JavaScript switch cases fall through by default. A missing `break` means the next case's code also runs.

```typescript
case 'checkout.session.completed': {
  const session = event.data.object
  console.log('Checkout:', session.id)
  // missing break!
}
case 'customer.subscription.created': {
  // This runs too, because of fall-through.
  // But `subscription` is `Stripe.Subscription`, while `event.data.object` is still narrowed to
  // `Stripe.Checkout.Session` — TypeScript yells, correctly.
}
```

TypeScript catches this because of strict type narrowing — each case expects its own object type. But in non-strict setups, this is a classic bug. Always `break`.

---

## Principal Engineer Notes

### 1. `+server.ts` is not bundled with your pages

Each `+server.ts` becomes its own serverless function (on Vercel, Netlify, Cloudflare Pages) or its own route handler (on Node servers). It's independently deployed, independently scaled. Adding a new webhook endpoint doesn't bloat your page bundle size. This is one of SvelteKit's cleaner architectural wins.

### 2. Why reject GET explicitly (by not handling it)

Someone will eventually paste your webhook URL into a browser. They'll get 405. Good — they shouldn't be able to cause side effects by visiting a URL. Side effects require POST because POST is semantically "make a change." Leaving GET undefined is the correct way to express "this endpoint can't be safely GETted."

If you wanted a health-check endpoint (useful for uptime monitoring), add it at a separate URL: `/api/health` with a `GET` that returns 200 and an "OK" body. Don't mix concerns.

### 3. Body-parsing gotchas with SvelteKit

SvelteKit's `request` is the Web standard `Request` object. It can be consumed **once**. After `await request.text()`, the body stream is drained. If you try to `await request.json()` afterwards, it throws "body already used."

For webhook endpoints this is fine — we call `request.text()` once and hold the result as `body`. But it's the reason people get bitten trying to log the body "just for debugging" before verification. Pick one consumption method, use it.

### 4. Why webhooks deserve their own subdirectory

As your SaaS grows you'll add webhooks from Resend (email delivery status), Intercom (support messages), maybe Plaid or Stripe Connect. Each gets its own `+server.ts` under `/api/webhooks/<provider>/`. The shared convention — raw body, verify signature, dispatch on type — becomes a team muscle memory. New engineers read `stripe/+server.ts` and know exactly where to put the `resend/+server.ts` by convention.

Architecture is communication. Directory structure is architecture.

### 5. Observability: structured logs aren't optional

Every `console.log` in this file is going to show up in your production logs. When (not if) a user says "my subscription didn't activate," you'll go to those logs. Make sure they contain enough to diagnose:

- Event type.
- Stripe event ID (for cross-referencing with Stripe's own logs).
- Relevant object IDs (subscription, customer, invoice).
- Any errors, with stack traces.

The current skeleton logs at the informational level. When you wire in real service calls, add error-level logs for failures (`console.error`). When you ship to prod, wrap console calls in a structured logger (pino, winston, or a Datadog/Axiom SDK) that emits JSON with proper severity and metadata. For Contactly's scope, plain console is enough.

### 6. Testability: extract the handler, not the whole route

If you want to unit-test the switch dispatch, it's tempting to move the whole thing into a separate `handleWebhookEvent(event: Stripe.Event)` function and test it directly. For Contactly we won't — the lesson-level code is small enough that an integration test (mock Stripe, POST to the real endpoint, verify database state) is a better investment. But for a larger codebase, factoring out the switch body is the right move. The `+server.ts` becomes a thin transport layer; the real logic lives in `src/lib/server/webhooks/stripe.ts` and is unit-tested in isolation.

Keep this in mind. When the `case` blocks grow to dozens of lines each, refactor.

---

## Summary

- Created `src/routes/api/webhooks/stripe/+server.ts` — the single file that handles every inbound Stripe event.
- Exported only `POST`; GET (and every other method) auto-returns 405 because it's not defined.
- Used `request.text()`, not `request.json()`, to preserve the exact bytes required for signature verification.
- Short-circuited missing signatures with a clean 400 response before touching any verification logic.
- Wrapped `stripe.webhooks.constructEvent()` in try/catch and returned 400 with a generic `"Invalid signature"` message on failure.
- Dispatched on `event.type` with a typed switch — TypeScript narrows `event.data.object` to the correct type per case.
- Grouped `customer.subscription.created` and `customer.subscription.updated` because they share a handler.
- Returned 200 for all success cases **including** unknown event types; Stripe only retries non-2xx.
- Wrapped the switch in a try/catch that returns 500 on handler errors so Stripe retries transient failures.

## What's Next

We have a webhook endpoint. Stripe doesn't know about it yet. Lesson 6.3.1 sets up the Stripe CLI's `stripe listen` command — the tool that forwards events from your Stripe account to `localhost:5173/api/webhooks/stripe` during development. We'll wrap the whole invocation in a `pnpm stripe:listen` script so your daily workflow stays one terminal command away.
