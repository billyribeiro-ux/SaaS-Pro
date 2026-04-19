---
title: "9.8 - Deliver Customer Portal"
module: 9
lesson: 8
moduleSlug: "module-09-checkout-billing"
lessonSlug: "08-deliver-customer-portal"
description: "Build the billing portal endpoint and add the Manage Subscription button to the account page."
duration: 10
preview: false
---

## Overview

The customer portal is configured (9.7). Now we deliver it to users. The work is minimal: one server endpoint that creates a portal session, and one button on the account page that calls the endpoint and redirects the browser.

Think of this as the mirror of 9.1. `POST /api/billing/checkout` creates a Checkout session and returns the hosted URL; `POST /api/billing/portal` creates a portal session and returns the hosted URL. Same shape, different Stripe object. Same client-side handling (`fetch`, then `window.location.href = url`).

What makes this worth a dedicated lesson — not a paragraph — is the decisions around *who* gets the button, *when* they see it, *what* happens if they click it without a subscription, and *how* you gracefully handle the return. Ten minutes of code, but each line expresses a choice.

## Prerequisites

- Lesson 9.7 complete — customer portal configured in Stripe dashboard.
- Module 7 complete — `customers` table with `stripe_customer_id` persisted per user.
- `supabaseAdmin` from Module 4 available.

## What You'll Build

- `POST /api/billing/portal` endpoint.
- "Manage subscription" button on `/account`.
- Conditional rendering: button only shows if the user has a Stripe customer.
- Graceful error handling for users who somehow reach the endpoint without billing history.

---

## Step 1: The Endpoint

Create `src/routes/api/billing/portal/+server.ts`:

```typescript
// src/routes/api/billing/portal/+server.ts
import { json, error } from '@sveltejs/kit'
import { stripe } from '$server/stripe'
import { supabaseAdmin } from '$server/supabase'
import { PUBLIC_APP_URL } from '$env/static/public'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  const user = await locals.getUser()
  if (!user) error(401, 'Unauthorized')

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (!customer?.stripe_customer_id) error(400, 'No billing account found')

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${PUBLIC_APP_URL}/account`
  })

  return json({ url: session.url })
}
```

Walkthrough:

### Imports

- **`json, error`** — standard SvelteKit return and throw helpers. No `redirect` needed; this endpoint returns a URL for the client to navigate to.
- **`stripe`** — our Stripe client.
- **`supabaseAdmin`** — service-role Supabase client (bypasses RLS). We're reading on behalf of the authenticated user using their validated `user.id`; we don't need their JWT.
- **`PUBLIC_APP_URL`** — for the return URL.

### Auth gate

```typescript
const user = await locals.getUser()
if (!user) error(401, 'Unauthorized')
```

Identical pattern to 9.1. No session, no portal.

### Customer lookup

```typescript
const { data: customer } = await supabaseAdmin
  .from('customers')
  .select('stripe_customer_id')
  .eq('id', user.id)
  .single()

if (!customer?.stripe_customer_id) error(400, 'No billing account found')
```

Why not call `getOrCreateCustomer` like 9.1 does? Because if the user has never paid (or trialed), they *don't* have a Stripe customer, and creating one just to open the portal would pollute Stripe with empty customers. The portal is only useful if you have billing history; if you don't, there's nothing to manage.

**`.single()`** vs **`.maybeSingle()`** — the shape of error we want to throw tells us which. `.single()` throws if no rows match; `.maybeSingle()` returns `null` if no match. We want "no match" to be a user-facing 400 with a clear message, so we use `.single()` and let the destructure give us `data: null` for missing rows, then guard with the `?.` chain.

Actually — re-reading Supabase's client API — `.single()` returns `{ data, error }` where `error` is set when no row found and `data: null`. We're destructuring only `data`, so if the row is missing, `customer` is `null`, and `customer?.stripe_customer_id` is `undefined`, and the `error(400, ...)` fires. Correct behavior. We could check `error` too for more specific handling, but for this endpoint the single "no billing account" message is enough.

**`error(400, 'No billing account found')`** — deliberately vague in the message. We don't want to leak "you've never paid" vs "we lost your record." From the user's perspective, both resolve by first making a purchase.

### Portal session creation

```typescript
const session = await stripe.billingPortal.sessions.create({
  customer: customer.stripe_customer_id,
  return_url: `${PUBLIC_APP_URL}/account`
})
```

`stripe.billingPortal.sessions.create` accepts:

- **`customer`** (required) — the Stripe customer ID. Must be a valid, non-deleted customer in the same Stripe account.
- **`return_url`** (required for most configs) — where Stripe sends the user when they click "Return to [business]" or complete an action. Overrides the dashboard default.
- **`configuration`** (optional) — if you have multiple portal configurations (rare), pass the ID here. We use the default.
- **`flow_data`** (optional) — pre-opens a specific flow. E.g., `{ type: 'payment_method_update' }` opens directly to the card-update screen. Useful when your "Update payment method" banner wants to skip the landing page.
- **`locale`** (optional) — forces a language. Default is "auto" which uses the customer's browser locale.

For our basic Manage Subscription button, `customer` + `return_url` is enough.

### The response

```typescript
return json({ url: session.url })
```

Unlike Checkout sessions, `billingPortal.sessions.create` always returns a non-null `url`, so we don't guard against null here. The URL looks like `https://billing.stripe.com/session/...` and is single-use — it expires after the user's visit ends.

---

## Step 2: The Account Page Button

Load the customer in `src/routes/(app)/account/+page.server.ts`:

```typescript
// src/routes/(app)/account/+page.server.ts
import { redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$server/supabase'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const user = await locals.getUser()
  if (!user) redirect(303, '/login')

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    user,
    hasBilling: !!customer?.stripe_customer_id,
    subscription
  }
}
```

We use `.maybeSingle()` here because a user viewing their account page without a customer record is a normal state (they've never paid). Not an error.

Render the button in `+page.svelte`:

```svelte
<!-- src/routes/(app)/account/+page.svelte -->
<script lang="ts">
  let { data } = $props()

  let loading = $state(false)

  async function openPortal() {
    loading = true
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' })
      if (!response.ok) {
        const { message } = await response.json()
        alert(message ?? 'Unable to open billing portal')
        return
      }
      const { url } = await response.json()
      window.location.href = url
    } finally {
      loading = false
    }
  }
</script>

<div class="max-w-2xl mx-auto p-6 space-y-6">
  <h1 class="text-2xl font-bold text-gray-900">Account</h1>

  <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
    <h2 class="text-lg font-semibold text-gray-900 mb-2">Profile</h2>
    <p class="text-gray-700">{data.user.email}</p>
  </section>

  <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
    <h2 class="text-lg font-semibold text-gray-900 mb-4">Billing</h2>

    {#if data.subscription}
      <div class="mb-4">
        <p class="text-sm text-gray-600">Current plan</p>
        <p class="font-medium text-gray-900">
          {data.subscription.status === 'trialing'
            ? 'Trial ends soon'
            : data.subscription.status === 'active'
              ? 'Active'
              : data.subscription.status}
        </p>
      </div>
    {/if}

    {#if data.hasBilling}
      <button
        onclick={openPortal}
        disabled={loading}
        class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
      >
        {loading ? 'Opening…' : 'Manage subscription'}
      </button>
    {:else}
      <a
        href="/pricing"
        class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
      >
        View plans
      </a>
    {/if}
  </section>
</div>
```

Walkthrough of decisions:

- **`let loading = $state(false)`** — Svelte 5 rune for reactive local state. Used to disable the button and show "Opening…" while the fetch is in flight.
- **`try/finally`** for the loading flag ensures it always resets, even if `fetch` throws.
- **`response.ok` check** — if our endpoint returned 400 or 401, we parse the message and alert. Basic error UX; you could swap for a nicer toast.
- **`window.location.href = url`** — full-page navigation to Stripe's hosted portal. Same reason as 9.1: `goto` is for internal URLs, the portal is external.
- **`{#if data.hasBilling}`** branch — users without a Stripe customer see "View plans" instead of "Manage subscription." The CTA stays visually consistent (same button style) but routes to the right place.
- **Subscription status display** — trivial for now. In Module 10 we'll flesh this out with plan name, renewal date, trial countdown, past-due banners, etc. Today we just want the plumbing.

---

## Step 3: Test End to End

1. Start the dev server: `pnpm dev`.
2. Stripe CLI listening: `stripe listen --forward-to localhost:5173/api/webhooks/stripe`.
3. Log in as a user who has a subscription (use a test card and the checkout endpoint from 9.1 if needed).
4. Navigate to `/account`.
5. "Manage subscription" button should be visible.
6. Click it. You should land on the Stripe customer portal showing your subscription.
7. Click "Cancel subscription." Confirm. Stripe shows "Subscription will be canceled on [date]."
8. Click "Return to SaaS-Pro." You land back on `/account`.
9. In the Stripe CLI terminal, observe `customer.subscription.updated` fire with `cancel_at_period_end: true`. Your DB row gets updated.

Test the no-billing path:

1. Log out, register a fresh account, log in.
2. Skip the pricing page. Navigate directly to `/account`.
3. You should see "View plans" button instead of "Manage subscription."
4. If you hit `/api/billing/portal` directly (e.g., via curl), you should get a 400 "No billing account found."

Test the error path:

1. With DevTools → Network, open `/account`, click "Manage subscription."
2. Temporarily block the fetch response (network throttling or breakpoint).
3. Verify the "Opening…" state doesn't get stuck — the finally clause clears it.

---

## Step 4: Banner Button (Integration With 9.5's Past-Due UX)

Our past-due banner from 9.5 already routes to `/api/billing/portal`. Now that the endpoint exists, verify the banner button works end-to-end:

1. Create a test clock + subscription with `pm_card_chargeDeclined`.
2. Advance past the billing date.
3. Webhook updates subscription to `past_due`.
4. Reload the app (or let real-time sync — Module 10 territory).
5. Banner appears. Click "Update payment method."
6. You land on the portal. Click "Add payment method," enter `4242 4242 4242 4242`.
7. Set it as default. Return to app.
8. Within ~10 seconds the next retry happens, `invoice.payment_succeeded` fires, subscription becomes `active`.
9. Reload — banner disappears.

The full past-due recovery lifecycle works with no custom card-entry UI on your side. That's the portal paying off.

---

## Step 5: Flow-Specific Variants (Optional Enhancement)

You can pre-open specific portal flows for contextual UX. For example, the past-due banner could open directly to the card-update screen:

```typescript
const session = await stripe.billingPortal.sessions.create({
  customer: customer.stripe_customer_id,
  return_url: `${PUBLIC_APP_URL}/account`,
  flow_data: {
    type: 'payment_method_update'
  }
})
```

Available flow types include `subscription_cancel`, `subscription_update`, `payment_method_update`, `subscription_update_confirm`. Pass `flow_data.type` and optional `flow_data.subscription_cancel.subscription` (or similar per flow).

Useful for:
- Cancel link in a retention email → `subscription_cancel`.
- Past-due banner → `payment_method_update`.
- Upsell CTAs → `subscription_update` with the target price.

For SaaS-Pro we ship the basic "landing page" portal for all cases; add flow-specific sessions as UX needs arise.

---

## Common Mistakes

- **Using `getOrCreateCustomer` for the portal.** Creates empty customers in Stripe for users who've never paid. Harmless but wasteful. Use the lookup-only path; 400 if missing.

- **Forgetting `return_url`.** Stripe rejects the call. Always set it, either per-session or via the dashboard default.

- **Showing "Manage subscription" to all users.** Users who haven't paid click it, hit a 400, feel confused. Gate on `hasBilling`.

- **Not handling the `fetch` error path.** A network blip leaves the button stuck on "Opening…" forever. Use `try/finally`.

- **Using `goto(url)` for the portal URL.** Internal router; external URL fails silently. Use `window.location.href = url`.

- **Forgetting to persist the webhook events after portal actions.** A user cancels in the portal — Stripe fires `customer.subscription.updated` with `cancel_at_period_end: true`. If your webhook handler doesn't persist, your DB still shows "Active" and the next page load is wrong. Verify webhook handling in Module 7 covers all portal-driven events.

- **Testing only with fresh sessions.** The portal URL is single-use. Clicking it twice from the same fetch response gives an error on the second click. Always create a fresh session per navigation.

---

## Principal Engineer Notes

1. **Portal vs custom UI tradeoff.** Building a custom subscription-management UI requires re-implementing pro-ration math, dunning display, invoice rendering, VAT ID capture, payment method swap with 3DS — easily 2–4 months of engineering and a permanent maintenance tail. The portal ships in an afternoon and covers every edge case. Build custom only if (a) your product depends on a particular UX affordance Stripe doesn't offer, or (b) you're at a scale where the tradeoff has flipped.

2. **PCI scope reduction is a strategic asset.** Every interaction with card data happens on Stripe's domains (Checkout, Portal). Your auditors look at your codebase, see zero card-handling code, and your SAQ A compliance is straightforward. This compounds when you pursue SOC 2 or enterprise security reviews — "we don't touch card data" is a clean answer.

3. **Instrument portal usage.** You can't track what happens *inside* the portal without advanced integrations, but you can track *entries*: log every successful `stripe.billingPortal.sessions.create` call. Correlate with your `subscriptions` table changes to see which portal visits converted to cancellations, upgrades, or card updates. Those metrics inform retention product work.

4. **The portal's cancellation flow is where you read the room.** Cancellation reasons and custom questions generate churn data for free. Review them monthly. If "too expensive" dominates, it's a pricing problem; if "missing feature X" dominates, it's a roadmap problem; if "not using it enough" dominates, it's an activation problem. All three need different responses.

5. **Single-use URLs are a safety feature.** Each portal session URL is valid for one visit by one browser, expires after 30 minutes. This prevents someone from copying a URL and sharing it (it wouldn't work for them) or keeping an old URL to re-enter. The pattern of "create a session per entry" is the right UX, not an annoyance.

6. **Configuration drift is a real risk.** You configured the portal for test mode in 9.7. When you deploy to production, re-configure for live mode. Make it a deploy checklist item, or (better) codify the config via Stripe's Configurations API and apply it as part of your infrastructure provisioning. Drift between test and live portal configs produces "this worked in staging, not in prod" bugs.

7. **The endpoint is a one-liner of real logic, and most of the lesson was about the surrounding decisions.** That's the ratio on most infrastructure work: 10 lines of code, 90 lines of judgement about what the 10 lines should be. Get comfortable with it. The code isn't where the value is; the decisions are.

---

## What's Next

Module 9 is complete. Users can subscribe, trial, fail payments, recover, and manage their billing — every core SaaS billing flow. In Module 10 we build **access control**: translating "what subscription status does this user have?" into "which features can they use?" That's the glue between Stripe's billing state and the product experience. The checkout endpoint you built in 9.1, the portal endpoint you built in 9.8, and the webhook handlers from Module 7 — Module 10 ties them together into a coherent user-facing product.
