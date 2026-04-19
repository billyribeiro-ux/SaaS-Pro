---
title: '9.5 - Test Cards & Failed Payments'
module: 9
lesson: 5
moduleSlug: 'module-09-checkout-billing'
lessonSlug: '05-test-cards-failed-payments'
description: 'Test all payment scenarios using Stripe test cards and handle failed payments gracefully.'
duration: 10
preview: false
---

## Overview

Every SaaS eventually ships to production with a happy-path bug in its failed-payment handling. It's almost tradition. You build checkout, you test with `4242 4242 4242 4242`, everything works, you launch. Then a real customer's card expires, your webhook handler crashes on an event type you didn't expect, their access silently persists while they think they're not paying, and you discover the bug three months later when your accountant asks why the MRR number doesn't match Stripe.

Involuntary churn — customers who churn because their card failed, not because they chose to leave — is roughly **30% of total churn** in a mature SaaS. A product that keeps 95% of voluntary-cancellers reachable but only recovers 40% of failed-card customers is leaving money on the table at a structural scale. This lesson is about closing that gap: testing every failure mode Stripe can throw at you, and designing UX that brings past-due customers back.

## Prerequisites

- Lessons 9.1–9.3 complete — you can create subscriptions and advance test clocks.
- Webhook handler (Module 7) persisting subscriptions and invoices.

## What You'll Build

- A complete table of Stripe test cards covering success, decline, auth challenges, and insufficient funds.
- Webhook handling for `invoice.payment_failed`.
- A `past_due` UX: a banner + "Update payment method" prompt on the dashboard.
- Understanding of Stripe Smart Retries and dunning defaults.

---

## The Stripe Test Card Reference

Every test card below works only in test-mode (keys starting with `sk_test_`, `pk_test_`). They come from Stripe's published testing catalog. For every card:

- Expiry: any future date (common: `12/34`)
- CVV: any 3 digits (common: `123`, or `1234` for Amex)
- ZIP: any valid-looking value (`12345`)
- Name: any

### Success

| Card number           | Behavior                                 |
| --------------------- | ---------------------------------------- |
| `4242 4242 4242 4242` | Basic success. The universal test card.  |
| `4000 0566 5566 5556` | Success (Visa debit).                    |
| `5555 5555 5555 4444` | Success (Mastercard).                    |
| `3782 822463 10005`   | Success (American Express). 4-digit CVV. |
| `6011 1111 1111 1117` | Success (Discover).                      |

### Declines — generic

| Card number           | Behavior                                                     |
| --------------------- | ------------------------------------------------------------ |
| `4000 0000 0000 0002` | Card declined. Generic decline, no further info.             |
| `4000 0000 0000 9995` | Insufficient funds. Dunning often recovers these.            |
| `4000 0000 0000 9987` | Lost card. Usually doesn't recover without user updating PM. |
| `4000 0000 0000 9979` | Stolen card. Don't recover. Fraud flag.                      |
| `4000 0000 0000 0069` | Expired card. Recovers when user updates PM.                 |
| `4000 0000 0000 0127` | Incorrect CVC. Legit card, wrong CVV — user re-enters.       |
| `4000 0000 0000 0119` | Processing error. Retry usually works.                       |

### 3-D Secure / authentication required

| Card number           | Behavior                                                       |
| --------------------- | -------------------------------------------------------------- |
| `4000 0025 0000 3155` | Requires 3DS authentication. Checkout pops the auth challenge. |
| `4000 0027 6000 3184` | Requires 3DS, authentication fails.                            |
| `4000 0082 6000 3178` | Requires 3DS, insufficient funds after authentication.         |

### Risk scoring / Radar

| Card number           | Behavior                              |
| --------------------- | ------------------------------------- |
| `4100 0000 0000 0019` | Always blocked by Radar (fraudulent). |
| `4000 0000 0000 0101` | CVC check fails.                      |
| `4000 0000 0000 0010` | AVS check fails.                      |

Full reference: [stripe.com/docs/testing](https://stripe.com/docs/testing).

### How to use these cards

- **In Checkout** — enter the number, any future expiry and CVV. The card's behavior manifests as you expect.
- **Via payment method tokens** — Stripe exposes tokens like `pm_card_visa`, `pm_card_chargeDeclined`, `pm_card_chargeDeclinedInsufficientFunds`, `pm_card_authenticationRequired`. Use these in scripts to programmatically create subscriptions with specific card behaviors (useful with test clocks).

Example in a script:

```typescript
await stripe.subscriptions.create({
	customer: customer.id,
	items: [{ price: priceId }],
	default_payment_method: 'pm_card_chargeDeclined'
});
// Advancing past billing date will trigger `invoice.payment_failed`.
```

---

## What `invoice.payment_failed` Contains

When Stripe attempts to charge and fails, you get a webhook:

```typescript
{
  id: 'evt_...',
  type: 'invoice.payment_failed',
  data: {
    object: {
      id: 'in_...',
      customer: 'cus_...',
      subscription: 'sub_...',
      status: 'open', // invoice is open (unpaid)
      amount_due: 2900,
      amount_paid: 0,
      attempt_count: 1, // how many times Stripe has tried
      next_payment_attempt: 1713580800, // UNIX timestamp for next retry
      last_finalization_error: null,
      billing_reason: 'subscription_cycle',
      payment_intent: 'pi_...',
      charge: 'ch_...', // null if no PM could even be charged
      hosted_invoice_url: 'https://invoice.stripe.com/i/...',
      // ...much more
    }
  }
}
```

Key fields you'll use:

- **`subscription`** — to locate the related subscription in your DB.
- **`attempt_count`** — which retry this is (1, 2, 3, 4). Stripe does up to 4 retries by default.
- **`next_payment_attempt`** — when the next retry will happen (null on final failure).
- **`payment_intent`** — the payment intent object has more detail on _why_ it failed (`last_payment_error.decline_code`, `last_payment_error.message`).
- **`hosted_invoice_url`** — a Stripe-hosted page where the user can view and pay the invoice. Send this in emails.

---

## Updating Subscription Status to `past_due`

Stripe automatically moves the subscription's `status` to `past_due` after the first failed charge attempt on an invoice. Your webhook just needs to persist it. If you set up the generic `customer.subscription.updated` handler in Module 7, this is already working — but let's verify by spelling it out.

```typescript
// src/routes/api/webhooks/stripe/+server.ts (excerpt)
case 'invoice.payment_failed': {
  const invoice = event.data.object as Stripe.Invoice
  const subscriptionId = invoice.subscription as string | null

  if (!subscriptionId) break // one-time invoice failure — handle elsewhere

  // Fetch the subscription to get its current status and metadata.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: subscription.status, // 'past_due' after first fail
      updated_at: new Date().toISOString()
    })
    .eq('id', subscriptionId)

  // Persist the invoice row too, so UI can show the failed invoice.
  await supabaseAdmin.from('invoices').upsert({
    id: invoice.id,
    user_id: subscription.metadata.user_id,
    subscription_id: subscriptionId,
    amount_due: invoice.amount_due,
    amount_paid: invoice.amount_paid,
    status: invoice.status,
    hosted_invoice_url: invoice.hosted_invoice_url,
    attempt_count: invoice.attempt_count,
    next_payment_attempt: invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000).toISOString()
      : null
  })

  // Optional: queue a transactional email for the user.
  // (Stripe sends its own reminder too — see 9.6.)

  break
}
```

Why we re-fetch the subscription instead of trusting the invoice: `invoice.payment_failed` fires _before_ `customer.subscription.updated`. The invoice object's embedded subscription state can be slightly stale. Retrieving fresh ensures we persist the authoritative status.

---

## The `past_due` Dashboard UX

A past-due user needs three things visible immediately on login:

1. A clear statement of the problem — "Your payment failed on April 14."
2. A clear path to fix it — a button to update their payment method.
3. A clear statement of consequences — "Your account will be canceled on April 28 if not resolved."

Wire this in `src/routes/(app)/+layout.server.ts` (or wherever your authenticated layout reads the subscription):

```typescript
// src/routes/(app)/+layout.server.ts
import type { LayoutServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) return { user: null, subscription: null };

	const { data: subscription } = await supabaseAdmin
		.from('subscriptions')
		.select('*')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	return { user, subscription };
};
```

Then in `+layout.svelte`:

```svelte
<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	let { data, children } = $props();

	async function openBillingPortal() {
		const response = await fetch('/api/billing/portal', { method: 'POST' });
		const { url } = await response.json();
		window.location.href = url;
	}
</script>

{#if data.subscription?.status === 'past_due'}
	<div class="border-b border-red-200 bg-red-50 px-4 py-3 text-red-800">
		<div class="mx-auto flex max-w-6xl items-center justify-between">
			<div>
				<strong>Your payment failed.</strong> Update your payment method to keep your account active.
			</div>
			<button
				onclick={openBillingPortal}
				class="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
			>
				Update payment method
			</button>
		</div>
	</div>
{/if}

{@render children()}
```

Notes:

- **The banner is a layout-level concern**, not a per-page one. A user on `/contacts` or `/dashboard` should see it just as clearly. Putting it in the authenticated-layout component ensures full coverage.
- **The button routes through the billing portal**, not a custom "update card" page. The portal (9.7/9.8) handles card updates with a Stripe-hosted form — fewer bugs, less code, same result.
- **We don't block access** during `past_due`. Stripe's default retry schedule gives the user days to recover; access denial on day 1 of past-due is too aggressive. We'll discuss the right moment to lock access in Module 10.

---

## Stripe Smart Retries

Stripe's default dunning schedule (Smart Retries) tries to recharge a failed invoice on a machine-learning-tuned cadence — typically:

- Retry 1: ~3 days after first failure.
- Retry 2: ~5 days after.
- Retry 3: ~7 days after.
- Retry 4 (final): ~7 more days.

Total lifetime of a past-due invoice: ~3 weeks before Stripe gives up and moves the subscription to `canceled` (or `unpaid`, depending on your settings). Each retry fires a webhook — success becomes `invoice.payment_succeeded`, persistent failure eventually produces `customer.subscription.deleted`.

You can tune the behavior in Dashboard → Settings → Subscriptions and emails:

- **Payment retry behavior** — Smart Retries (recommended) or fixed schedule (2, 4, 6, 8 days).
- **After all retries fail** — options are:
  - Cancel the subscription (most SaaS).
  - Mark the subscription unpaid (access is paused but not deleted; useful if you want manual outreach).
  - Leave subscription past_due indefinitely (rare, typically for enterprise/invoicing customers).

For SaaS-Pro, Smart Retries + "Cancel after all retries" is the default. Our job in product code is to surface the UX, persist the state, and not fight Stripe on the timing.

---

## Testing the Whole Flow With Test Clocks

A complete failed-payment test:

1. Create a test clock.
2. Create a customer attached to the clock.
3. Create a subscription with `default_payment_method: 'pm_card_chargeDeclined'`.
4. Advance the clock past the next billing date.
5. Observe webhooks: `invoice.created`, `invoice.finalized`, `invoice.payment_failed`, `customer.subscription.updated` (→ `past_due`).
6. Visit your dashboard — banner should appear.
7. Advance the clock another 3 days. Another retry fires. Still failed.
8. Continue advancing. After all retries, `customer.subscription.deleted` fires. Subscription status in DB becomes `canceled`.
9. Banner disappears (they're no longer past-due, they're canceled — a different UX).

Total runtime: under 1 minute. Full lifecycle tested.

---

## Common Mistakes

- **Testing only `4242 4242 4242 4242`.** You ship, and the first real-world expired card crashes your webhook handler because you never handled `invoice.payment_failed`. Always test decline paths.

- **Assuming `invoice.payment_failed` means "canceled."** It means "one attempt failed." Stripe will retry. The subscription is `past_due`, not `canceled`. Design for the retry window.

- **Denying access on day 1 of past-due.** Customers whose cards failed overnight wake up locked out. That's punishing users for Stripe's timing. Hold access through the retry window; announce the impending cancellation.

- **Not showing the invoice link.** Some customers pay by manually clicking the hosted invoice URL. Surface `hosted_invoice_url` in your UI (or via the billing portal), not just "update payment method."

- **Treating CVC-failed as "card declined."** A failed CVC check usually means the user typo'd the CVV. Different UX — prompt them to re-enter card details, don't treat them as a failing customer.

- **Ignoring 3-D Secure test cases.** European customers will always see 3DS challenges on first transactions. If you skip testing `4000 0025 0000 3155`, you'll ship a broken EU checkout and not know until a customer tweets about it.

- **Letting the banner show after the problem resolves.** When the user updates their PM, the next retry succeeds, `customer.subscription.updated` fires with `status: 'active'`. If your layout only reads stale DB data, the banner stays. Make sure the webhook-driven status update propagates (either via layout reload after portal redirect or real-time subscription — which we cover in Module 10).

---

## Principal Engineer Notes

1. **Involuntary churn is a recoverable asset.** Treat a `past_due` user as a customer in distress, not a problem. Good UX, timely emails, a clear path to fix — these recover 60–80% of failed payments. Bad UX (or no UX) recovers 20–40%. The difference is meaningful revenue.

2. **Grace periods matter.** Between first failure and final cancellation, you have 2–3 weeks of implicit grace. Use them. Gentle in-app prompts on day 1, more urgent on day 7, final warning on day 14, lockout on cancellation. Gradient the pressure.

3. **Dunning emails are a major lever — and Stripe's defaults are decent.** Stripe sends retry-attempt emails and final-warning emails out of the box. We cover enabling them in 9.6. Don't build a custom email pipeline unless Stripe's templates fail to match your brand voice in a way that's actually costing conversion.

4. **3-D Secure will increase over time, not decrease.** PSD2 mandates in Europe keep strengthening. What was "requires auth" on 5% of transactions is now 25%+ in many markets. Build and test the flow early; ignore it and you'll have a panic-migration when you hit the EU.

5. **Log everything about failed payments.** `decline_code`, `last_payment_error.message`, `attempt_count` — all of these inform product decisions. If 40% of your declines are "insufficient_funds" vs "expired_card", the two need different outreach. Instrument now, analyze later.

6. **The dashboard banner is UX infrastructure.** Don't relegate it to a corner toast or a settings-page notice. Past-due is the most important state a customer can be in from a revenue standpoint; it deserves unmissable visual weight.

7. **Access-control during past_due is a product decision, not a Stripe decision.** Stripe won't lock users out for you. You decide when access ends: immediately, at retry 2, on cancellation, never. Spotify tolerates past_due for weeks; enterprise tools often lock same-day. Fit to your product.

---

## What's Next

Lesson 9.6 enables Stripe's built-in email notifications — receipts, failed-payment reminders, trial endings. Low code, high leverage. Then 9.7 configures the customer portal that our banner's "Update payment method" button routes to, and 9.8 builds the endpoint + UI to open it.
