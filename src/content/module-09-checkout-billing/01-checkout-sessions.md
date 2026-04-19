---
title: "9.1 - Checkout Sessions"
module: 9
lesson: 1
moduleSlug: "module-09-checkout-billing"
lessonSlug: "01-checkout-sessions"
description: "Build the checkout endpoint that creates a Stripe Checkout session and redirects the user to pay."
duration: 18
preview: false
---

## Overview

This is the lesson where SaaS-Pro starts taking money. Everything we've done so far — auth, contacts, the pricing page, Stripe price objects, the webhook skeleton — was setup. We were learning the map. Now we drive the car.

The mechanism we're building is **Stripe Checkout**, specifically the **hosted** variant. When a user clicks "Subscribe" on your pricing page, your server calls Stripe to create a one-time-use URL representing a payment intent. You redirect the browser to that URL. Stripe renders a professionally designed, PCI-compliant, localized-in-40-languages payment form. The user types their card, Stripe takes the money, Stripe sends your server a webhook, and the user lands back on your dashboard with an active subscription.

From your app's perspective, the entire sensitive part of the transaction — card numbers, CVV, 3-D Secure challenges, fraud checks — happens on `checkout.stripe.com`. Your servers never see a card number. Your PCI scope drops from "full PCI-DSS audit required" to "SAQ A" — the lightest self-assessment tier. This is why hosted Checkout is the default recommendation for any SaaS that doesn't have a dedicated payments team.

By the end of this lesson you'll have a single POST endpoint that takes a pricing tier and produces a Checkout URL — the narrow bridge between your app and Stripe's money-movement system.

## Prerequisites

- Module 8 complete — pricing page renders tiers read from `PRICING_LOOKUP_KEYS`.
- Module 7 complete — `getOrCreateCustomer` service lives in `src/lib/server/billing/customers.service.ts`.
- Module 6 complete — the `stripe` client is exported from `src/lib/server/stripe.ts` with `apiVersion: '2026-03-25.dahlia'`.
- `PUBLIC_APP_URL` set in `.env` (e.g., `http://localhost:5173` for dev).
- A Stripe test-mode account with products created for each of your `PRICING_LOOKUP_KEYS`.

## What You'll Build

- A `POST /api/billing/checkout` endpoint.
- Input validation: the body must contain a `lookup_key` from your known set.
- Stripe customer resolution — find or create the customer for `locals.getUser()`.
- Price resolution by lookup key (never by hardcoded price ID).
- Mode detection: `subscription` for recurring prices, `payment` for one-time.
- A fully configured `checkout.sessions.create` call with `success_url`, `cancel_url`, promotion codes, and subscription metadata.
- A JSON response `{ url }` that the pricing page POSTs to and redirects the browser to.

---

## Step 1: Why Hosted Checkout, Not Embedded

Stripe Checkout has three flavors, and the choice shapes your PCI scope for the rest of the product's life:

1. **Hosted Checkout** — Stripe renders the payment page on `checkout.stripe.com`. You redirect there, user pays, Stripe redirects them back. Your servers never see card data. PCI scope: **SAQ A** (minimal).
2. **Embedded Checkout** — Stripe renders the same UI in an iframe hosted inside your page. Card data still never touches your servers. PCI scope: still **SAQ A**. Slightly more integrated feel, slightly more implementation cost.
3. **Payment Element / Elements** — Stripe renders individual input components you compose into your own custom payment page. Card data still doesn't touch your servers (the JS library posts it directly to Stripe). PCI scope: **SAQ A**. Full design control but more code, more edge cases, more QA surface.

We're choosing **Hosted Checkout** because:

- SaaS-Pro is a business, not a design portfolio. The checkout page doesn't sell the product — the pricing page does.
- Stripe maintains Checkout. Apple Pay, Google Pay, Link, SEPA, BNPL, 3-D Secure — all appear automatically as Stripe adds them. You do nothing and get new payment methods for free.
- Stripe localizes Checkout into 40+ languages, automatically based on the user's browser.
- Stripe A/B tests Checkout constantly. You get their conversion-rate improvements without doing work.

The tradeoff: the page lives on `checkout.stripe.com`, not `yourapp.com`. Branding is limited to logo + colors + font (set in Stripe dashboard). That's a fine tradeoff for almost every SaaS product. If you ever genuinely need a custom payment UI, migrate to Elements later — but you will rarely need to.

---

## Step 2: The Contract Between Pricing Page and Checkout Endpoint

Before we write code, let's nail down the shape of the request.

The pricing page has a "Subscribe" button next to each tier. When clicked, it POSTs to `/api/billing/checkout` with a JSON body:

```json
{ "lookup_key": "pro_monthly" }
```

The server:
1. Verifies the user is logged in.
2. Verifies `lookup_key` is in the allowed set (defense against a malicious client sending `enterprise_free`).
3. Gets or creates the Stripe customer for this user.
4. Looks up the Stripe price matching `lookup_key`.
5. Calls `stripe.checkout.sessions.create(...)`.
6. Returns `{ url: session.url }`.

The client:
1. `fetch`es `/api/billing/checkout`, reads `{ url }`.
2. `window.location.href = url` (or `goto(url)`).
3. Browser is now on `checkout.stripe.com`.

This is deliberately a JSON endpoint, not a form action. Form actions are great for pages that re-render their own results; this endpoint produces a URL to redirect to, and JSON is cleaner for that. We'll see the same pattern again in 9.8 with the billing portal.

---

## Step 3: Why Lookup Keys, Not Price IDs

Stripe gives every price object an ID like `price_1P9abCDeFgHiJkLm`. It's tempting to hardcode those IDs in your config:

```typescript
// DON'T
const PRO_MONTHLY_PRICE_ID = 'price_1P9abCDeFgHiJkLm'
```

Three things go wrong when you do:

1. **Different IDs per environment.** Your test-mode price ID and live-mode price ID are different objects with different IDs. You end up with branching config (`if (isLive) { ... }`) — a nightmare to maintain.
2. **Changing a price breaks your app.** Stripe prices are immutable. To change the Pro plan's price from $29 to $39, you don't edit the price — you **create a new price object with a new ID** and archive the old one. Hardcoded IDs now point at archived prices.
3. **Rotating prices for experiments is impossible.** A/B testing "$29 vs $39 vs $49" means three prices. You'd hardcode all three and deploy new code to switch. Terrible.

**Lookup keys** fix this. A lookup key is a stable, human-chosen string you attach to a price: `pro_monthly`, `starter_yearly`, `enterprise_monthly`. When the price itself needs to change, you:

1. Create the new price in Stripe.
2. Transfer the lookup key to the new price (Stripe's `transfer_lookup_key: true` parameter, or "Move lookup key" in the dashboard).

Your code keeps asking for `pro_monthly`. The underlying price ID changed — your code doesn't care. Test-mode and live-mode both have a `pro_monthly` lookup key; your code works identically in both. Pricing becomes a **runtime configuration concern**, not a build-time deploy concern.

Our config file (from Module 8) defines the allowed set:

```typescript
// src/lib/config/pricing.config.ts (excerpt)
export const PRICING_LOOKUP_KEYS = {
  starterMonthly: 'starter_monthly',
  proMonthly: 'pro_monthly',
  enterpriseMonthly: 'enterprise_monthly'
} as const
```

`Object.values(PRICING_LOOKUP_KEYS)` gives us `['starter_monthly', 'pro_monthly', 'enterprise_monthly']` — the closed set of strings we'll validate the request body against.

---

## Step 4: The Endpoint File

Create `src/routes/api/billing/checkout/+server.ts`:

```typescript
// src/routes/api/billing/checkout/+server.ts
import { json, redirect, error } from '@sveltejs/kit'
import { stripe } from '$server/stripe'
import { getOrCreateCustomer } from '$server/billing/customers.service'
import { PRICING_LOOKUP_KEYS } from '$config/pricing.config'
import { PUBLIC_APP_URL } from '$env/static/public'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = await locals.getUser()
  if (!user) error(401, 'Unauthorized')

  const { lookup_key } = await request.json()

  const validKeys = Object.values(PRICING_LOOKUP_KEYS)
  if (!validKeys.includes(lookup_key)) {
    error(400, 'Invalid pricing tier')
  }

  const customerId = await getOrCreateCustomer(user.id, user.email!)

  const prices = await stripe.prices.list({
    lookup_keys: [lookup_key],
    active: true,
    limit: 1
  })

  const price = prices.data[0]
  if (!price) error(400, 'Price not found')

  const mode = price.type === 'one_time' ? 'payment' : 'subscription'

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    mode,
    success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_APP_URL}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
    ...(mode === 'subscription' && {
      subscription_data: {
        metadata: { user_id: user.id }
      }
    })
  })

  if (!session.url) error(500, 'Failed to create checkout session')

  return json({ url: session.url })
}
```

Now let's walk through every line and decision.

### Line 1: imports

```typescript
import { json, redirect, error } from '@sveltejs/kit'
```

Three helpers from SvelteKit, each with a different control-flow contract:

- **`json(body)`** — returns a `Response` with `Content-Type: application/json` and the body serialized. Normal return value.
- **`redirect(status, location)`** — **throws** internally; the caller never gets a return value. We're not using it in this endpoint (we return a URL instead of redirecting server-side), but importing it signals intent and keeps the pattern consistent across files.
- **`error(status, message)`** — **throws** a `HttpError`. SvelteKit catches it and returns a JSON error response. This is how we short-circuit from deep inside the handler.

One thing to internalize: you **don't** `return error(...)`. You just call it. Control flow never continues past it. Same for `redirect`.

### Lines 2–5: server-side imports

```typescript
import { stripe } from '$server/stripe'
import { getOrCreateCustomer } from '$server/billing/customers.service'
import { PRICING_LOOKUP_KEYS } from '$config/pricing.config'
import { PUBLIC_APP_URL } from '$env/static/public'
```

- **`$server/stripe`** — our Stripe client from Module 6, with `apiVersion: '2026-03-25.dahlia'` and the secret key loaded from env.
- **`$server/billing/customers.service`** — the customer-resolution service from Module 7. It handles the "do we have a Stripe customer for this user yet? If not, create one and persist it" logic so we don't duplicate it across endpoints.
- **`$config/pricing.config`** — the allowed-lookup-keys set from Module 8.
- **`PUBLIC_APP_URL` from `$env/static/public`** — used to build absolute URLs for Stripe to redirect back to. Stripe will not accept relative URLs; they need the full scheme + host.

The `$server` and `$config` aliases are declared in our `svelte.config.js` (Module 1). Using them instead of `$lib/server/...` and `$lib/config/...` keeps imports short and our intent explicit.

### Line 8: the handler signature

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
```

SvelteKit routes `+server.ts` files by HTTP verb. `export const POST` handles POST requests; `GET`, `PUT`, `PATCH`, `DELETE` are their own exports. We only need POST here — creating a session is a state-changing operation (an object is created in Stripe) and GET is reserved for safe, idempotent reads.

`RequestHandler` typing comes from the auto-generated `./$types` file. Destructuring `{ request, locals }` gives us the standard `Request` object and SvelteKit's per-request `locals` container.

### Lines 9–10: auth gate

```typescript
const user = await locals.getUser()
if (!user) error(401, 'Unauthorized')
```

`locals.getUser()` is the auth helper we built in Module 2 — it reads the session cookie, validates the JWT with Supabase, and returns the user or null. If null, we throw a 401.

**Why not validate at the hook level?** You could. But the hook's job is to expose `getUser()` to downstream code, not to decide which routes require auth. Some routes are public (pricing page, marketing pages, health checks). Per-route auth checks keep the policy local to the route — easier to reason about, easier to audit.

### Lines 12–17: body parsing and input validation

```typescript
const { lookup_key } = await request.json()

const validKeys = Object.values(PRICING_LOOKUP_KEYS)
if (!validKeys.includes(lookup_key)) {
  error(400, 'Invalid pricing tier')
}
```

`request.json()` parses the POST body as JSON. If the body isn't valid JSON, it throws — SvelteKit's default error handler catches and returns a 400. Good enough for this endpoint.

We could use Zod here (and in a production polish pass we would), but this endpoint has exactly one field with a closed set of allowed values — the plain `.includes()` check reads more directly than a full Zod schema. Principal-engineer judgement call: for two or more fields, reach for Zod; for one field with a closed set, a direct check is fine.

**Why validate at all? The price lookup would fail anyway if `lookup_key` is bogus.** Yes, but:
1. "Price not found" is a confusing error for a user who typed a valid-looking URL. "Invalid pricing tier" is more diagnostic.
2. Validating locally avoids making a Stripe API call for requests we know are bad. Stripe API calls cost time (~100–300ms) and count against your rate limit.
3. Defense in depth: if a future code path wires Stripe calls before validation, our validation still runs first.

### Line 19: customer resolution

```typescript
const customerId = await getOrCreateCustomer(user.id, user.email!)
```

`getOrCreateCustomer` (from Module 7) does:

1. Query our local `customers` table for a row with `id = user.id`.
2. If exists → return its `stripe_customer_id`.
3. If not → call `stripe.customers.create({ email, metadata: { user_id } })`, insert the row, return the new `stripe_customer_id`.

We need a customer ID up front because we pass it to `checkout.sessions.create`. Without it, Stripe would create a brand-new anonymous customer every time the user hits checkout, and we'd have to reconcile them post-webhook. By resolving the customer first, we guarantee one customer per user forever.

**Why `user.email!`?** Supabase's user object has `email: string | undefined` — email is optional in the type because OAuth flows can produce users without emails. In our setup, registration requires email, so we know it's present. The `!` is the TypeScript "trust me, it's not null" operator. Honest, acceptable here.

### Lines 21–28: price lookup

```typescript
const prices = await stripe.prices.list({
  lookup_keys: [lookup_key],
  active: true,
  limit: 1
})

const price = prices.data[0]
if (!price) error(400, 'Price not found')
```

`stripe.prices.list({ lookup_keys: [...] })` searches for prices by the stable lookup key. We pass `active: true` to skip archived prices, and `limit: 1` because we expect exactly one match (lookup keys are unique per active price within your account).

The response is a `Stripe.ApiList<Stripe.Price>` with a `.data` array. If no price matches, `.data[0]` is undefined — we 400 with a clear message.

Why not cache this price lookup? Prices change rarely, and a cache would get stale when you rotate prices in Stripe. The API call is ~200ms, which is fine for a user-initiated action that's about to redirect them anyway. If you really need to optimize, cache in-memory with a 60-second TTL — but measure first.

### Line 30: mode detection

```typescript
const mode = price.type === 'one_time' ? 'payment' : 'subscription'
```

Stripe prices are either `one_time` (charged once, e.g., lifetime deal, credits pack) or `recurring` (charged on a schedule). Checkout sessions need to be told which mode to use:

- `mode: 'payment'` → a single-charge session. Success creates a `payment_intent` and `invoice` but no subscription.
- `mode: 'subscription'` → a recurring session. Success creates a `subscription` object that bills on the price's interval (month, year, etc.) until canceled.

By deriving `mode` from the price type, we keep the endpoint flexible. If you later add a lifetime deal as a one-time price with lookup key `lifetime`, this endpoint handles it with zero changes.

### Lines 32–44: the session creation call

```typescript
const session = await stripe.checkout.sessions.create({
  customer: customerId,
  line_items: [{ price: price.id, quantity: 1 }],
  mode,
  success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${PUBLIC_APP_URL}/pricing?checkout=cancelled`,
  allow_promotion_codes: true,
  ...(mode === 'subscription' && {
    subscription_data: {
      metadata: { user_id: user.id }
    }
  })
})
```

This is the meaty call. Each field:

- **`customer: customerId`** — pins the session to a known Stripe customer so subsequent charges and subscriptions hang off the same customer record. Without this, Stripe would create a new anonymous customer at each checkout.

- **`line_items: [{ price: price.id, quantity: 1 }]`** — what the user is buying. Checkout supports multiple line items, but for SaaS we're almost always selling one subscription at a time. Quantity 1 is the default for per-seat SaaS (per-seat-scales-linearly setups would pass a dynamic quantity).

- **`mode`** — the `'payment'` or `'subscription'` we computed above.

- **`success_url`** — where Stripe sends the user after successful payment. Three things to know:

  - Stripe replaces `{CHECKOUT_SESSION_ID}` with the actual session ID. This lets the success page call `stripe.checkout.sessions.retrieve(session_id)` to show the user exactly what they bought, before the webhook has necessarily arrived. (The webhook is the source of truth for what lands in your DB, but showing a "thanks!" page doesn't need to wait for it.)
  - The literal string is `{CHECKOUT_SESSION_ID}` — not a template variable you interpolate. Pass it to Stripe exactly. Stripe performs the substitution.
  - The URL must be absolute. Hence `PUBLIC_APP_URL`.

- **`cancel_url`** — where Stripe sends the user if they click the back arrow or close the checkout page. We send them back to the pricing page with `?checkout=cancelled` so we could show a friendly "changed your mind? That's fine — when you're ready..." message.

- **`allow_promotion_codes: true`** — renders a "Add promotion code" link on Checkout. Users who have a promo code can apply it; everyone else doesn't see an input field cluttering the UI. Default for production SaaS.

- **`subscription_data: { metadata: { user_id } }`** — only included when `mode === 'subscription'`. This writes `user_id` into the **subscription's** metadata (not the session's). Why both? The webhook that handles `customer.subscription.created` receives the subscription object; having `user_id` in its metadata lets our handler instantly correlate the subscription to our user. Without it, we'd have to look up via `customer` → `customers` table → `user_id`, which is an extra round-trip. Metadata is free to set, cheap to read later.

  The `...(mode === 'subscription' && { ... })` conditional spread adds the field only for subscription mode. One-time `payment` mode doesn't accept `subscription_data` (Stripe returns an error if you pass it).

### Lines 46–47: success-case guard

```typescript
if (!session.url) error(500, 'Failed to create checkout session')

return json({ url: session.url })
```

`stripe.checkout.sessions.create` returns a `Session` object. The `url` field is typed as `string | null` in Stripe's TypeScript types because some session modes (embedded, redirect-less flows) don't have a URL. For hosted mode — which is what we're using — it's always present, but the type doesn't know that.

We handle the `null` case with a 500 (this should be impossible; if it happens, something is deeply wrong), then return JSON.

The client receives `{ url: 'https://checkout.stripe.com/c/pay/cs_test_...' }` and redirects the browser there.

---

## Step 5: Wiring the Pricing Page Button

The pricing page in Module 8 has a "Subscribe" button per tier. Here's how the click handler looks (we'll refine it next module):

```svelte
<script lang="ts">
  import { goto } from '$app/navigation'

  let submitting = $state<string | null>(null)

  async function subscribe(lookup_key: string) {
    submitting = lookup_key
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookup_key })
      })

      if (!response.ok) {
        const { message } = await response.json()
        alert(message)
        return
      }

      const { url } = await response.json()
      window.location.href = url
    } finally {
      submitting = null
    }
  }
</script>

<button onclick={() => subscribe('pro_monthly')} disabled={submitting !== null}>
  {submitting === 'pro_monthly' ? 'Redirecting...' : 'Subscribe'}
</button>
```

**Why `window.location.href = url`, not `goto(url)`?** `goto` is SvelteKit's client-side navigation helper — it works for internal URLs. `checkout.stripe.com` is external; we need a full page navigation. `window.location.href` does that.

---

## Step 6: Test the Flow End to End

Start dev server + Stripe CLI webhook listener:

```bash
pnpm dev
# in another terminal
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

Navigate to `http://localhost:5173/pricing`, click the "Subscribe" button for Pro Monthly. You should land on `checkout.stripe.com`. Use a test card (we cover these exhaustively in 9.5):

- Card: `4242 4242 4242 4242`
- Expiry: any future date, e.g. `12/34`
- CVV: any three digits, e.g. `123`
- ZIP: any, e.g. `12345`

Submit. Stripe processes the payment, you get redirected to `/dashboard?checkout=success&session_id=cs_test_...`. In the Stripe CLI terminal you'll see the stream of webhook events: `checkout.session.completed`, `customer.subscription.created`, `invoice.payment_succeeded`. Your webhook handler (Module 7) persists them; your `subscriptions` table should now have a row.

If any step fails, check the Stripe dashboard → Developers → Events for the server-side trace, and your dev terminal for SvelteKit logs. The `Logs` tab of every Stripe object shows exactly what API calls hit it — priceless for debugging.

---

## Common Mistakes

- **Hardcoded price IDs.** `price: 'price_1P9abc...'` instead of looking up by `lookup_key`. Breaks the moment you rotate prices or move to live mode. Lookup keys are the stable abstraction.

- **Forgot `customer: customerId`.** If you omit it, Stripe creates a new customer for every checkout. Your user ends up with five Stripe customer records, five different `stripe_customer_id` values, five subscriptions that don't reconcile. Always pass `customer`.

- **Used a relative `success_url`.** Stripe requires absolute URLs. `/dashboard` is invalid. Use `${PUBLIC_APP_URL}/dashboard`.

- **Interpolated `{CHECKOUT_SESSION_ID}`.** The literal string `{CHECKOUT_SESSION_ID}` is what Stripe expects. If you wrote `` `${session.id}` `` (which isn't even in scope yet), you'd get a broken URL. Pass it as-is; Stripe substitutes.

- **Returned `{ session }` instead of `{ url }`.** Exposing the whole session object includes the customer email, metadata, and payment details. The client only needs the URL. Minimize the response surface.

- **Put user-level metadata in the session instead of the subscription.** `checkout.sessions.create({ metadata: {...} })` is session-level metadata, not subscription-level. Our webhook handles subscription events, not session events, so the metadata we want available later belongs on `subscription_data.metadata`.

- **Used `redirect(303, url)` in the handler.** Would work in a form action; doesn't work in a JSON-returning endpoint you call via `fetch`. `fetch` follows redirects by default but reports the final response, not the redirect target — the client can't easily extract the URL to navigate the top-level window to. Return JSON with the URL and let the client navigate.

---

## Principal Engineer Notes

1. **Hosted Checkout is a business decision, not just a technical one.** You're delegating the card-handling UX to Stripe in exchange for PCI scope reduction and continuous improvement. The tradeoff gets better over time — Stripe rolls out Link, Apple Pay, Google Pay, BNPL automatically. Think of hosted Checkout as a subscription to payments infrastructure.

2. **`{CHECKOUT_SESSION_ID}` in the success URL is the trick that makes the success page useful before webhooks land.** Webhooks are eventually consistent — they could arrive 100ms later or 30 seconds later. If your dashboard tries to read the fresh subscription from your DB immediately on redirect, it might not be there yet. Retrieve the session from Stripe with the session ID to show authoritative details ("Thanks for subscribing to Pro!") in the meantime. The webhook remains the source of truth for writes to your DB.

3. **Idempotency keys protect you from double-charges in retries.** We didn't pass an `idempotencyKey` option to this call because `checkout.sessions.create` is idempotent-safe in one direction — calling it twice with the same parameters creates two sessions, which is fine (a user might create a session, change their mind, come back). If you were calling something like `paymentIntents.create` in a loop, pass an `idempotencyKey` derived from something stable (e.g., `invoice.id + retry_count`) to ensure the same call never double-charges. Read Stripe's idempotency docs if you haven't.

4. **The back-button-after-cancel path matters more than you'd think.** Users regularly open Checkout, type half their card, and close the tab. They come back to your pricing page hours later — with `?checkout=cancelled` in the URL from their last attempt, and they might click Subscribe again. Your button handler must handle this gracefully: a new session is created fine (sessions are cheap, Stripe doesn't charge for unused sessions), but make sure you're not showing stale error messages from the previous cancellation.

5. **The `customer: customerId` parameter is doing more than you think.** It not only identifies the payer — it pre-fills email and billing address on Checkout, it ties the resulting subscription to the right customer, and it enables Stripe's auto-retry for payment methods the customer has on file. Skipping it would lose all three.

6. **Webhook signature verification is what makes this architecture safe.** If a malicious actor could POST fake `checkout.session.completed` events to your webhook endpoint, they could grant themselves subscriptions. Verification (covered in Module 7) means only Stripe can tell your system "this payment happened." Make sure your webhook handler is rejecting unsigned requests before you go to production.

---

## What's Next

Lesson 9.2 adds free trials. You'll learn the two main trial strategies (card-required vs no-card) and when each one fits, and you'll extend this endpoint to support both. Then 9.3 brings in Stripe test clocks so you can compress a 14-day trial into a single test run, and 9.4 prevents users from farming trials by creating new accounts. The checkout endpoint you just built is the seed — the next six lessons grow it into a production-grade subscription lifecycle.
