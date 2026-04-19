---
title: '10.4 - Prevent Multiple Plans'
module: 10
lesson: 4
moduleSlug: 'module-10-access-control'
lessonSlug: '04-prevent-multiple-plans'
description: 'Prevent users from subscribing to a new plan when they already have an active subscription.'
duration: 10
preview: false
---

## Overview

We've got one remaining gap in our access-control story: users who are already subscribed can subscribe **again**. If a Pro-tier user lands on `/pricing` and clicks "Subscribe" on the Team tier, we'll happily send them to Stripe Checkout, which will happily create a brand-new subscription. Now they're paying for two plans simultaneously. They'll notice on their next bill — and they'll be furious.

Stripe has a first-class feature for handling plan changes: the **customer portal**. It's a Stripe-hosted page where a customer can upgrade, downgrade, change their card, cancel, and view invoices — all handled by Stripe with correct proration built in. Our job in this lesson is to route existing subscribers to the portal instead of Checkout, with one line of logic in the checkout endpoint and a small UI tweak on the pricing page.

Ten minutes. Low drama. High dollar impact.

## Prerequisites

- Lesson 10.1 complete — `hasActiveSubscription` available.
- Module 9 complete — checkout session endpoint exists at something like `/api/checkout` or as a form action on `/pricing`.
- Stripe customer portal is enabled for your account at [dashboard.stripe.com/settings/billing/portal](https://dashboard.stripe.com/settings/billing/portal).
- The `subscriptions` table stores both `user_id` and `stripe_customer_id`.

## What You'll Build

- A guard in the checkout endpoint: active subscribers are redirected to the customer portal, not Checkout.
- A billing portal helper that exchanges a user's `stripe_customer_id` for a portal session URL.
- A conditional CTA on the pricing page: subscribers see "Manage Subscription," non-subscribers see "Subscribe to Pro."
- End-to-end flow tested against Stripe's sandbox.

---

## Step 1: Where the Double-Charge Bug Lives Today

Our current checkout action (from Module 9) looks roughly like:

```typescript
// src/routes/(app)/pricing/+page.server.ts — the version we're about to fix
import { redirect } from '@sveltejs/kit';
import { PUBLIC_APP_URL } from '$env/static/public';
import { stripe } from '$server/stripe';
import type { Actions } from './$types';

export const actions: Actions = {
	subscribe: async ({ locals, request }) => {
		const user = await locals.getUser();
		if (!user) redirect(303, '/login');

		const formData = await request.formData();
		const priceId = formData.get('priceId') as string;

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer_email: user.email,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success`,
			cancel_url: `${PUBLIC_APP_URL}/pricing`
		});

		redirect(303, session.url!);
	}
};
```

Problem: **no check for existing subscription.** A Pro user clicks "Subscribe to Team" → new Checkout session → new Stripe subscription → new `invoice.paid` webhook → new row in our `subscriptions` table. Two active subscriptions. Two monthly charges.

The fix is two lines plus a call to the portal endpoint.

---

## Step 2: The Guard in the Checkout Endpoint

Here's the fixed version. Changed lines are annotated.

```typescript
// src/routes/(app)/pricing/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { PUBLIC_APP_URL } from '$env/static/public';
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import { hasActiveSubscription } from '$lib/utils/access';
import type { Actions } from './$types';

export const actions: Actions = {
	subscribe: async ({ locals, request }) => {
		const user = await locals.getUser();
		if (!user) redirect(303, '/login');

		// NEW: block duplicate subscriptions up front.
		if (await hasActiveSubscription(user.id)) {
			const portalUrl = await createPortalUrl(user.id);
			if (!portalUrl) {
				return fail(500, {
					error: 'Could not open billing portal. Please try again.'
				});
			}
			redirect(303, portalUrl);
		}

		const formData = await request.formData();
		const priceId = formData.get('priceId') as string;

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			customer_email: user.email,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success`,
			cancel_url: `${PUBLIC_APP_URL}/pricing`
		});

		redirect(303, session.url!);
	},

	manage: async ({ locals }) => {
		const user = await locals.getUser();
		if (!user) redirect(303, '/login');

		const portalUrl = await createPortalUrl(user.id);
		if (!portalUrl) {
			return fail(500, { error: 'Could not open billing portal.' });
		}
		redirect(303, portalUrl);
	}
};

async function createPortalUrl(userId: string): Promise<string | null> {
	// `.maybeSingle()` returns `null` when no row matches (instead of throwing).
	// A user with no `subscriptions` row is a normal state — don't blow up on it.
	const { data: sub } = await supabaseAdmin
		.from('subscriptions')
		.select('stripe_customer_id')
		.eq('user_id', userId)
		.limit(1)
		.maybeSingle();

	if (!sub?.stripe_customer_id) return null;

	const portal = await stripe.billingPortal.sessions.create({
		customer: sub.stripe_customer_id,
		return_url: `${PUBLIC_APP_URL}/dashboard`
	});

	return portal.url;
}
```

### Breaking this apart

#### The guard

```typescript
if (await hasActiveSubscription(user.id)) {
	const portalUrl = await createPortalUrl(user.id);
	if (!portalUrl) {
		return fail(500, { error: 'Could not open billing portal. Please try again.' });
	}
	redirect(303, portalUrl);
}
```

Five lines. If the user is already subscribed, skip Checkout entirely and create a portal session instead. The `redirect(303, portalUrl)` sends the user off-site to Stripe's hosted page, where they can change plans with built-in proration.

The portal-creation failure branch (`if (!portalUrl)`) handles the edge case where a subscription exists in our DB but the `stripe_customer_id` column is null (which should never happen in a correct system, but defending against our own bugs is cheap). The user sees a friendly error and can retry.

#### Why the portal for plan changes

Plan changes involve proration. If a user on Pro ($10/mo) upgrades to Team ($30/mo) mid-cycle, Stripe needs to:

1. Credit the unused portion of the Pro subscription (e.g., $6 back for 18 unused days).
2. Charge the prorated Team amount (e.g., $18 for 18 days of Team).
3. Net the two (charge $12 today).
4. Update the subscription to bill $30 at the next renewal.

Doing this in our own code means building proration math, handling invoices, managing edge cases (trial periods, annual plans, tax). The portal does all of it, tested and hosted by Stripe.

The rule: **don't build what the portal gives you for free.** Use Checkout for _initial_ sign-ups; use the portal for _every subsequent change_.

#### The `manage` action

```typescript
manage: async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) redirect(303, '/login');

	const portalUrl = await createPortalUrl(user.id);
	if (!portalUrl) {
		return fail(500, { error: 'Could not open billing portal.' });
	}
	redirect(303, portalUrl);
};
```

A named action the UI can post to explicitly. The pricing page's "Manage subscription" button will target `?/manage` to trigger this branch. Reusing `createPortalUrl` keeps the portal-creation logic in one spot.

#### The `createPortalUrl` helper

```typescript
async function createPortalUrl(userId: string): Promise<string | null> {
	const { data: sub } = await supabaseAdmin
		.from('subscriptions')
		.select('stripe_customer_id')
		.eq('user_id', userId)
		.limit(1)
		.maybeSingle();

	if (!sub?.stripe_customer_id) return null;

	const portal = await stripe.billingPortal.sessions.create({
		customer: sub.stripe_customer_id,
		return_url: `${PUBLIC_APP_URL}/dashboard`
	});

	return portal.url;
}
```

- **Look up the Stripe customer ID.** The `subscriptions` row was written by the webhook in Module 9, so `stripe_customer_id` is populated.
- **`.maybeSingle()` vs `.single()`** — `.single()` throws when the query returns zero rows (or more than one). A user with no subscription is a normal state — using `.maybeSingle()` returns `data: null` instead, which our `if (!sub?.stripe_customer_id)` branch handles cleanly. Use `.single()` only when you've already guaranteed exactly one row exists (e.g., a primary-key lookup).
- **`PUBLIC_APP_URL` from `$env/static/public`** — never read runtime URLs from `process.env` in SvelteKit. `$env/static/public` is the canonical source; it's typed, validated at build time, and safe to reference in both server and client bundles. See Lesson 12.6 for the full canonical-URL story.
- **Create a portal session.** A portal session is a short-lived URL (valid for ~1 hour) the user can visit to manage billing.
- **`return_url`** — where Stripe sends the user when they close the portal. Usually back to the dashboard or an account page.
- **Return `null` on missing customer ID.** The caller decides how to handle that (in our case, `fail(500, ...)`).

This helper could live in `$lib/server/stripe.ts` if you want to share it with other parts of the app. For now, inline in the pricing page's server file is fine — we only use it here.

---

## Step 3: The Pricing Page UI

The server is ready. Now the page needs to render either "Subscribe" buttons (for free users) or a "Manage subscription" button (for paid users).

Assume `+layout.server.ts` already passes `isSubscribed` (from Lesson 10.3). In `src/routes/(app)/pricing/+page.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let isSubscribed = $derived(data.isSubscribed);
</script>

<div class="mx-auto max-w-4xl py-12">
	<h1 class="mb-2 text-3xl font-bold">Pricing</h1>

	{#if isSubscribed}
		<div class="mb-8 rounded-lg border border-green-200 bg-green-50 p-6">
			<h2 class="mb-2 text-lg font-semibold text-green-900">You're on a paid plan</h2>
			<p class="mb-4 text-green-800">
				Upgrade, downgrade, update your card, or cancel from your billing portal.
			</p>
			<form method="POST" action="?/manage" use:enhance>
				<button class="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700">
					Manage Subscription
				</button>
			</form>
		</div>
	{:else}
		<p class="mb-8 text-gray-600">Start with 10 free contacts. Upgrade any time for unlimited.</p>

		<!-- Your existing pricing cards, each with a form posting to ?/subscribe -->
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
			<!-- Pro plan card -->
			<form method="POST" action="?/subscribe" use:enhance>
				<input type="hidden" name="priceId" value={data.proPriceId} />
				<button class="w-full rounded-lg bg-blue-600 py-3 font-medium text-white">
					Subscribe to Pro
				</button>
			</form>
			<!-- Team plan card -->
			<form method="POST" action="?/subscribe" use:enhance>
				<input type="hidden" name="priceId" value={data.teamPriceId} />
				<button class="w-full rounded-lg bg-purple-600 py-3 font-medium text-white">
					Subscribe to Team
				</button>
			</form>
		</div>
	{/if}
</div>
```

### The Svelte-5 specifics

- **`$props()` with destructure** — standard runes read.
- **`$derived(data.isSubscribed)`** — reactive boolean.
- **`action="?/manage"` / `action="?/subscribe"`** — the SvelteKit form-action URL syntax for named actions.
- **`use:enhance`** — AJAX-like submission with fallback to full-page POST if JS disabled.

The subscribed user sees a single clear option — "Manage Subscription" — that takes them to Stripe's portal. The unsubscribed user sees the pricing grid as before. There's no way to hit the Subscribe button while already subscribed, which means no double-charge bug.

---

## Step 4: The Full Flow, Walked End to End

Let's trace a user journey through the new code.

**Scenario A: Free user subscribes to Pro (unchanged flow).**

1. User on free tier visits `/pricing`. `isSubscribed = false`. Renders pricing cards.
2. Clicks "Subscribe to Pro." Form posts to `?/subscribe`.
3. `subscribe` action runs. `hasActiveSubscription` returns `false`. Falls through to `stripe.checkout.sessions.create`.
4. User redirected to Stripe Checkout, completes payment.
5. Webhook fires, writes `subscriptions` row with `status = 'active'`.
6. User redirected back to `/dashboard?checkout=success`.

**Scenario B: Pro user tries to subscribe to Team (the bug we just fixed).**

1. Pro user visits `/pricing`. `isSubscribed = true`. Renders "Manage Subscription" button (no price cards).
2. User clicks "Manage Subscription." Form posts to `?/manage`.
3. `manage` action creates portal session, redirects to Stripe portal.
4. User picks "Change plan" in portal, switches Pro → Team.
5. Stripe handles proration (credit Pro, charge Team pro-rata).
6. Webhook fires (`customer.subscription.updated`), our handler updates the `subscriptions` row.
7. User returns to `/dashboard` via portal's `return_url`.

**Scenario C: Pro user bypasses the UI and POSTs to `?/subscribe` directly.**

1. Attacker opens DevTools, finds the `subscribe` action URL, crafts a POST with a `priceId`.
2. Server receives the POST. Authenticates the user (still logged in).
3. `hasActiveSubscription(user.id)` returns `true`.
4. Server creates a portal session and redirects the user to the portal.
5. No Checkout session is created. No double-charge.

The server guard catches the attempt exactly as intended. The UI is removed from the equation.

---

## Step 5: Testing with Stripe

Stripe test mode makes this trivial:

1. Start the dev server. Log in as a test user.
2. Complete a Pro subscription via the normal flow. Stripe's test card `4242 4242 4242 4242` with any future date and any CVC.
3. After webhook processes (watch `pnpm stripe listen` in your terminal), reload `/pricing`. Confirm you see "Manage Subscription" only.
4. Click "Manage Subscription." Confirm you land on a Stripe portal page with your subscription listed.
5. Close the portal. Confirm you return to `/dashboard`.
6. Try the curl attack: `curl -X POST http://localhost:5173/pricing?/subscribe -d "priceId=price_..."` with your session cookie. Confirm the redirect points at the portal, not a Checkout session.
7. In the Stripe portal, change plans. Confirm the webhook updates the `subscriptions` row and the pricing page still renders correctly.

---

## Common Mistakes

- **Running the guard after `stripe.checkout.sessions.create`.** The session is already created and a Checkout URL already minted. Even if you don't redirect, you've cluttered Stripe's data with orphan sessions. Guard **first**.
- **Creating a portal session without a `return_url`.** Stripe's portal will refuse to start, or the user gets stuck on Stripe after closing. Always supply `return_url`.
- **Building proration logic in your own code.** Resist the urge. The portal handles it correctly; your code won't (you'll forget tax, credits, annual plans, trial remainders, etc.). This is a rare case where "use the hosted thing" is unambiguously right.
- **Showing both "Subscribe" and "Manage" at the same time.** If `isSubscribed` is true, hide the pricing cards entirely. Mixed CTAs confuse users and invite the double-subscription bug back via "I meant to click the other one."
- **Forgetting to configure the portal in Stripe dashboard.** Portal features (switching plans, canceling, updating card) each have toggles in [dashboard.stripe.com/settings/billing/portal](https://dashboard.stripe.com/settings/billing/portal). A freshly enabled portal might only allow invoice viewing. Enable "Update payment methods" and "Change subscriptions" before shipping.
- **Handling `null` Stripe customer ID by throwing.** If something's gone wrong (webhook missed, DB corruption), a thrown exception crashes the page. `fail(500, ...)` with a friendly message is the right user-facing behavior; log the error for yourself.
- **Not testing the webhook-update-plan roundtrip.** Switching plans fires `customer.subscription.updated`. If your Module-9 webhook handler doesn't update `subscriptions` properly on that event, the user's tier in your DB will drift from Stripe's reality. Test it once; sleep easy.

---

## Principal Engineer Notes

### Avoiding the double-charge headline

The one-sentence summary of why this lesson exists: **a double-charge is worse than a missed signup.** The CAC you spent to get the user is lost anyway when they churn in fury; plus you get a chargeback, plus Stripe's dispute fee ($15), plus a support ticket that will consume 20 minutes of human time to unwind. Worst case, a Twitter post with your product name in it.

Guard the checkout endpoint. Not because of the unit economics of a single user, but because the cost of _being caught_ running this bug is enormous. Every pricing-page redesign, every new plan launch, every regression test should verify this guard still fires.

### The portal is a product, not a plumbing detail

Many engineering teams treat the Stripe customer portal as a necessary evil — "we have to link to it because of billing requirements." Reframe: the portal **is** your billing product. Self-serve upgrade, downgrade, cancel, invoice download. All of it hosted by Stripe, all of it tuned to convert (or retain) by a team with more billing telemetry than you'll ever have.

What this means in practice: put the "Manage Subscription" link in more places than just the pricing page. Put it in your account settings, in your dashboard footer, in the "failed payment" banner. The easier users can self-serve, the fewer support tickets you handle. Every click into the portal is a click you didn't spend.

Flip side: don't build custom plan-change flows inside your app "for brand consistency." Every custom flow is a proration bug waiting to happen. The portal's UX inconsistency with your app is a fair trade for _correctness_.

### Proration math, briefly

For completeness, here's the math the portal is doing when a user upgrades mid-cycle. Say Pro is $10/month and Team is $30/month. User is 18 days into a 30-day cycle:

- **Unused days on Pro**: 12 days. Credit = $10 × (12/30) = $4.
- **Days remaining on Team**: 12 days. Charge = $30 × (12/30) = $12.
- **Net immediate charge**: $12 − $4 = $8.
- **Next renewal**: billed $30 for the full Team cycle.

If the user is on an **annual** plan, or was in a **trial**, or has **unused credit** from a past refund, the math changes — each of those is another line of code to get right. Stripe's portal has a team of 40+ engineers keeping this correct across 100+ billing edge cases. You don't need to be one of them.

### The one-time + subscription combo edge case

If your product ever sells both subscriptions _and_ one-time purchases (e.g., an "annual license" plus a "setup fee"), the portal gets tricky:

- Portal manages subscription state, not one-time products.
- If you let users buy a one-time product while subscribed, you need a separate Checkout flow for that product (`mode: 'payment'` instead of `mode: 'subscription'`).
- `hasActiveSubscription` gates the subscription Checkout; a different gate may apply to the one-time flow (e.g., "allowed regardless of subscription state").

Contactly currently only sells subscriptions, so we don't have this problem. But if you add an "Enterprise Setup Fee: $500 one-time" button to your pricing page, route it through its own action that does **not** check `hasActiveSubscription`, and do not route those users to the portal. Keep the two flows clearly separate in the code — same principle as Lesson 10.2's "feature flags vs billing gates."

### Idempotency keys on portal sessions

Stripe recommends idempotency keys for all mutation calls. A POST to `billingPortal.sessions.create` with an idempotency key means a retry from the same user (say, they double-click the button) won't create two sessions.

```typescript
await stripe.billingPortal.sessions.create(
	{ customer: sub.stripe_customer_id, return_url: '...' },
	{ idempotencyKey: `portal-${userId}-${Date.now().toString().slice(0, -3)}` }
);
```

The `.slice(0, -3)` truncates the timestamp to 1-second granularity — retries within the same second collapse to one session. Perfect for a double-click; a full 24-hour idempotency window would be wrong (the user legitimately needs a new session tomorrow).

We skip idempotency here for simplicity. In production, add it.

### Observability on plan switches

Wire up analytics events in the webhook handler for `customer.subscription.updated`:

- Old plan → new plan → timestamp → user ID.
- Upgrade vs downgrade (infer from price comparison).
- Portal-initiated vs API-initiated (Stripe exposes the source in the event data).

This gives the product and marketing teams a clean funnel: trial → Pro → Team (the happy upgrade path) and Pro → canceled → reactivated (the classic retention-wobble shape). You cannot get this data from Stripe alone at the granularity you'll want.

---

## Summary

- Added a guard in the `subscribe` action: if the user is already subscribed, route them to the Stripe portal instead of creating a new Checkout session.
- Added a `manage` action the UI can post to explicitly for "Manage subscription" buttons.
- Created a `createPortalUrl` helper that looks up the user's `stripe_customer_id` and creates a portal session.
- Swapped the pricing page UI: subscribed users see "Manage Subscription"; free users see the pricing cards.
- Understood why the portal is the right tool for plan changes — proration, invoices, card updates all handled by Stripe.
- Closed the server-side double-subscription bug while preserving the marketing-page conversions for free users.

## What's Next

Module 10 is complete. You have a tier system where:

- Subscription status is the source of truth (Lesson 10.1).
- Free-tier limits are enforced server-side with telemetry (Lesson 10.2).
- The UI surfaces paid value via overlay prompts (Lesson 10.3).
- Existing subscribers can't accidentally double-pay (this lesson).

In Module 11 we move to testing — Vitest for unit tests on the access helpers, Playwright for end-to-end tests on the gated flows. The `hasActiveSubscription` helper becomes the anchor of a `describe('access control')` test suite that verifies the entitlement rule end to end: create a user, stub a subscription row, assert `hasActiveSubscription` returns `true`, flip the status to `canceled`, assert it returns `false`. Centralized helpers pay off the second you start writing tests against them.
