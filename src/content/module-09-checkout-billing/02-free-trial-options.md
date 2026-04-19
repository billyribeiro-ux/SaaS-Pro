---
title: '9.2 - Free Trial Options'
module: 9
lesson: 2
moduleSlug: 'module-09-checkout-billing'
lessonSlug: '02-free-trial-options'
description: 'Implement free trials — with and without requiring a payment method upfront.'
duration: 15
preview: false
---

## Overview

"Try free for 14 days" is the single most common conversion lever in SaaS pricing pages. It works because the promise "you can cancel before you pay" removes enough perceived risk to flip a "maybe later" click into a "sign up now" click. The question is not whether to offer a trial — almost every SaaS should — but **how** to offer it. That single design choice shapes your conversion rate, your churn rate, your customer support load, and your fraud exposure.

There are two mainstream trial strategies, and Stripe Checkout supports both with simple parameter changes on the session-creation call. In this lesson we'll wire up both, understand the tradeoffs deeply, and decide which one SaaS-Pro should ship with.

## Prerequisites

- Lesson 9.1 complete — `/api/billing/checkout` creates a session for a subscription price.
- Module 7 complete — webhook handler upserts subscriptions on `customer.subscription.created/updated`.
- At least one recurring Stripe price (e.g., `pro_monthly`) to attach a trial to.

## What You'll Build

- A `trial_period_days` option added to the checkout session — the card-required strategy.
- A `payment_method_collection: 'if_required'` option — the no-card strategy.
- A clear rule for choosing one per product.
- The webhook handling for `status: 'trialing'` subscriptions.
- The mental model for "trial ending" events and how they propagate.

---

## Strategy 1: `trial_period_days` — Card Required

```typescript
const session = await stripe.checkout.sessions.create({
	customer: customerId,
	line_items: [{ price: price.id, quantity: 1 }],
	mode: 'subscription',
	subscription_data: {
		trial_period_days: 14,
		metadata: { user_id: user.id }
	},
	success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
	cancel_url: `${PUBLIC_APP_URL}/pricing?checkout=cancelled`,
	allow_promotion_codes: true
});
```

The user still enters a card on Checkout. They're **not charged** immediately. A subscription is created in status `trialing` with a `trial_end` timestamp 14 days from now. At `trial_end`, Stripe automatically attempts the first charge using the saved card. If it succeeds, the subscription transitions to `active`. If the card declines, it transitions to `past_due` and dunning kicks in (covered in 9.5).

The payment flow timeline:

1. **Day 0** — user enters card, subscription created with `status: 'trialing'`, no charge.
2. **Day 11** (or 3 days before trial end) — Stripe sends the user a "trial ending" email if you've enabled it (more in 9.6).
3. **Day 14** — `customer.subscription.trial_will_end` webhook fires (72h before end). `customer.subscription.updated` fires with `status: 'active'` and the charge happens. `invoice.payment_succeeded` fires.
4. **Subsequent months** — normal recurring billing.

**Pros:**

- Higher trial → paid conversion. The card is already saved. No "signup friction spike" at the end of the trial. In practice, card-gated trials convert 40–70% to paid, versus 15–30% for no-card trials.
- Filters out trial-tourists — people who will never pay. Saves your support team from tickets about trials that "ended" (i.e., the user just stopped using it).
- Gives you a signal of real buying intent. Useful for sales-assisted SaaS (e.g., a sales rep reaching out to active trials).

**Cons:**

- Lower **start-trial** rate. A percentage of potential customers bounce at the "enter your card" step. Exact percentage varies by product category; for productivity SaaS you might see 20–40% lower signups.
- Can't market as "no credit card required."
- Slightly more customer-service load for "I forgot to cancel and you charged me" complaints (though Stripe's automatic email reminders reduce this significantly).

---

## Strategy 2: `payment_method_collection: 'if_required'` — No Card

```typescript
const session = await stripe.checkout.sessions.create({
	customer: customerId,
	line_items: [{ price: price.id, quantity: 1 }],
	mode: 'subscription',
	subscription_data: {
		trial_period_days: 14,
		trial_settings: {
			end_behavior: { missing_payment_method: 'cancel' }
		},
		metadata: { user_id: user.id }
	},
	payment_method_collection: 'if_required',
	success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
	cancel_url: `${PUBLIC_APP_URL}/pricing?checkout=cancelled`
});
```

Two new fields:

- **`payment_method_collection: 'if_required'`** — Stripe skips the card input step because no payment is needed yet. The Checkout page becomes a one-click "Start your free trial" confirmation screen.
- **`trial_settings.end_behavior.missing_payment_method: 'cancel'`** — when the trial ends, if no payment method has been added, cancel the subscription automatically. The alternatives are `'pause'` (subscription becomes inactive but recoverable) and `'create_invoice'` (create an unpaid invoice and hit dunning immediately — rare).

The payment flow timeline:

1. **Day 0** — user confirms trial, subscription created `trialing`, no card stored.
2. **Day 11** — "trial ending" email reminder (if enabled).
3. **Day 14** — trial ends. Since no payment method exists, subscription transitions to `canceled` (per our `end_behavior`). User loses access.

**To convert to paid before trial end**, the user must return to your app, visit the billing portal (9.7), add a payment method. You might prompt them in-app: "Add a card to keep your account after your trial ends." Or you might wait for the trial-ending email to do the job.

**Pros:**

- Much higher **start-trial** rate. "No credit card required" on the pricing page is a proven conversion lever.
- Ethical feel. Users don't feel "tricked" into a charge.
- Lower CS burden for "unexpected charge" complaints — there are no charges during trial.

**Cons:**

- Much lower **trial → paid** conversion. Typical rates are 15–30% (vs 40–70% for card-gated).
- Attracts trial-tourists — people who will never convert, burning your compute and support resources.
- Harder to use as a sales qualification signal (most of them aren't buyers).

---

## Which One Should SaaS-Pro Ship?

There's no universally right answer. The principal-engineer way to decide:

1. **If your product has a high-intent audience** (B2B productivity, developer tools, anything they're actively comparing in a tab next to competitors), go card-required. Their friction tolerance is high; their conversion rate is worth more than their signup rate.

2. **If your product is consumer-adjacent or discovery-driven** (anything marketed on social media, bought on impulse, needed for a one-time project), go no-card. Signups fuel word-of-mouth and top-of-funnel; the low conversion rate is offset by volume.

3. **If you don't know** — start with **no-card** and measure. It's cheaper to be wrong in that direction. After a month of data, if your trial-to-paid rate is below 15% and your support costs are rising, flip to card-required. Most SaaS spend years debating this; the answer is often "just ship one and measure."

For SaaS-Pro as a course example, we'll implement **card-required** as the default in Module 10's access-control code, because:

- It teaches more edge cases (past-due handling, card decline retries).
- It's the pattern more production SaaS use.
- The no-card variant is a one-parameter flip once you understand it.

But we'll build the toggle so you can choose per-product.

---

## Making the Choice Dynamic

Let's extend the checkout endpoint to take a trial flag:

```typescript
// src/routes/api/billing/checkout/+server.ts (extended)
import { json, error } from '@sveltejs/kit';
import { stripe } from '$server/stripe';
import { getOrCreateCustomer } from '$server/billing/customers.service';
import { PRICING_LOOKUP_KEYS, TRIAL_DAYS, TRIAL_STRATEGY } from '$config/pricing.config';
import { PUBLIC_APP_URL } from '$env/static/public';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { lookup_key } = await request.json();

	const validKeys = Object.values(PRICING_LOOKUP_KEYS);
	if (!validKeys.includes(lookup_key)) error(400, 'Invalid pricing tier');

	const customerId = await getOrCreateCustomer(user.id, user.email!);

	const prices = await stripe.prices.list({
		lookup_keys: [lookup_key],
		active: true,
		limit: 1
	});

	const price = prices.data[0];
	if (!price) error(400, 'Price not found');

	const mode = price.type === 'one_time' ? 'payment' : 'subscription';

	const subscriptionData =
		mode === 'subscription'
			? {
					subscription_data: {
						trial_period_days: TRIAL_DAYS,
						metadata: { user_id: user.id },
						...(TRIAL_STRATEGY === 'no_card' && {
							trial_settings: {
								end_behavior: { missing_payment_method: 'cancel' as const }
							}
						})
					},
					...(TRIAL_STRATEGY === 'no_card' && {
						payment_method_collection: 'if_required' as const
					})
				}
			: {};

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		line_items: [{ price: price.id, quantity: 1 }],
		mode,
		success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${PUBLIC_APP_URL}/pricing?checkout=cancelled`,
		allow_promotion_codes: true,
		...subscriptionData
	});

	if (!session.url) error(500, 'Failed to create checkout session');

	return json({ url: session.url });
};
```

And in `src/lib/config/pricing.config.ts`:

```typescript
export const TRIAL_DAYS = 14;
export const TRIAL_STRATEGY: 'card_required' | 'no_card' = 'card_required';
```

Now switching strategies is a one-line change in config. The commit diff is clean, the rollback is trivial.

**Why conditional spread instead of ternary assignment?** Stripe's TypeScript types are strict: passing `trial_settings: undefined` or `payment_method_collection: undefined` still triggers validation and sometimes rejection. The `...(condition && { ... })` pattern only includes the property when the condition is true — the property simply doesn't exist on the object otherwise. Cleaner objects, fewer runtime surprises.

**The `as const` in `'cancel' as const` and `'if_required' as const`** tightens the inferred type from `string` to the specific literal Stripe expects. Without it, TypeScript widens to `string` and Stripe's enum type rejects the call.

---

## How the Webhook Handles `trialing`

Your Module 7 webhook handler likely has a switch on `event.type`. The `customer.subscription.created` case writes a new row to the `subscriptions` table. The relevant fields for trialing:

```typescript
// inside the webhook handler for 'customer.subscription.created'
const subscription = event.data.object as Stripe.Subscription;

await supabaseAdmin.from('subscriptions').upsert({
	id: subscription.id,
	user_id: subscription.metadata.user_id,
	customer_id: subscription.customer as string,
	status: subscription.status, // 'trialing' | 'active' | 'past_due' | 'canceled' | ...
	price_id: subscription.items.data[0].price.id,
	trial_start: subscription.trial_start
		? new Date(subscription.trial_start * 1000).toISOString()
		: null,
	trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
	current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
	cancel_at_period_end: subscription.cancel_at_period_end
});
```

The important bits for trials:

- **`status: 'trialing'`** — distinct from `'active'`. Your access-control middleware in Module 10 will treat `trialing` the same as `active` for most gates (the user has full access during their trial), but bills/invoices show `$0.00 trial`.
- **`trial_start` and `trial_end`** — UNIX timestamps. Multiply by 1000 for JS milliseconds, convert to ISO string for Postgres `timestamptz`. These fields persist across events so your UI can show "6 days left in trial."
- **`current_period_end`** — during trial, this equals `trial_end`. After the trial converts, it becomes the next billing date.

The `trial_will_end` event fires **72 hours before the trial ends**. Handle it if you want to:

- Send a custom "trial ending soon" email (in addition to Stripe's built-in reminder).
- Show an in-app banner: "Your trial ends in 3 days."
- Trigger a sales-assist workflow for accounts above a certain usage threshold.

Add a case to your webhook:

```typescript
case 'customer.subscription.trial_will_end': {
  const subscription = event.data.object as Stripe.Subscription
  const userId = subscription.metadata.user_id

  if (userId) {
    // Queue an email, log an analytics event, etc.
    console.log(`Trial ending soon for user ${userId}`)
  }
  break
}
```

---

## Verifying in Test Mode

```bash
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

With `TRIAL_STRATEGY = 'card_required'`:

1. Visit `/pricing`, click Subscribe.
2. Enter `4242 4242 4242 4242`, submit.
3. Redirected to dashboard. Your `subscriptions` row has `status: 'trialing'`, `trial_end` 14 days out.
4. Webhook events received: `customer.created`, `customer.subscription.created`, `checkout.session.completed`. Notably, **no** `invoice.payment_succeeded` — no charge happened.

With `TRIAL_STRATEGY = 'no_card'`:

1. Visit `/pricing`, click Subscribe.
2. Checkout shows no card input, just a confirmation. Click the button.
3. Dashboard again. `subscriptions` row has `status: 'trialing'`, no card, `trial_end` 14 days out.
4. Same webhook events, minus any payment method association.

How do we fast-forward 14 days to see what happens at trial end? **Stripe test clocks** — the next lesson's topic.

---

## Common Mistakes

- **Passing `trial_period_days` without `mode: 'subscription'`.** Trial period is only valid for subscription mode. One-time payments don't have a trial concept.

- **Setting `payment_method_collection: 'if_required'` without a trial.** Nonsensical — there's no reason to skip card collection if payment is required immediately. Stripe rejects the call.

- **Forgetting `trial_settings.end_behavior` in no-card mode.** Default `end_behavior` is `create_invoice` — when the trial ends with no payment method, Stripe creates an unpaid invoice and immediately puts the subscription into dunning. For a free-trial UX, you want `cancel` (or rarely, `pause`).

- **Shipping both strategies simultaneously via a user choice.** "Do you want to try with or without a card?" is a UX mistake — users want you to pick. Decide based on your product and segment, ship one, measure.

- **Treating `status: 'trialing'` as inactive in your access gates.** A trialing user should have full access. Failing to handle `trialing` in your middleware means trial users see a "upgrade now" wall immediately after signing up — catastrophic for conversion.

- **Hardcoding trial duration on the client.** Trial length changes based on marketing experiments. "Extend the trial to 21 days for enterprise leads" is a common ask. Keep duration in `TRIAL_DAYS` on the server, never in client code.

- **Not persisting `trial_end` locally.** Don't call Stripe every time you need to check whether a user's trial is over. Store `trial_end` in your DB from the webhook, query locally.

---

## Principal Engineer Notes

1. **Trial length is a conversion variable.** 7, 14, 30 — each has a character. Shorter trials push users to adopt faster (intensity); longer trials accommodate slower workflows (enterprise onboarding). 14 days is a sane default — long enough to evaluate, short enough to create urgency. A/B test yours.

2. **The "no credit card required" promise is a marketing commitment, not a feature.** The moment you ship a landing page saying it, you can't quietly add card collection next month. Document the choice in a README so future-you doesn't accidentally regress it by copy-pasting a stale snippet.

3. **Abandoned trial recovery is the 80/20 of churn work.** A user who started a trial and went cold is far more valuable than a fresh lead. A simple email sequence ("You stopped using [feature]; here's how to finish what you started") recovers 5–15% of abandoned trials. Wire `customer.subscription.trial_will_end` to your email system early.

4. **Don't let "trial abuse" paranoia distort the UX.** A single user signing up three trials with different emails is a 1–5% phenomenon. Building elaborate fingerprinting to stop it risks false-positive banning of legitimate customers (spouses, colleagues, people at the same office). Handle it with the right-sized measure — email-verification + the check we'll add in 9.4 — not with fraud-detection gymnastics. If abuse becomes material (>10% of trials), escalate to Stripe Radar signals and device fingerprinting.

5. **Test clocks are mandatory for trial testing.** You cannot develop trial UX waiting real calendar days. Everything in 9.3 is table-stakes; you need test clocks on day one if you're serious about billing.

6. **The `trialing` → `active` transition is silent unless you announce it.** Stripe doesn't notify the user in-app when the trial converts. Build a dashboard banner ("Your subscription started today! Welcome to Pro.") tied to the `invoice.payment_succeeded` event following the trial. Small touch, outsized perceived value.

---

## What's Next

Lesson 9.3 introduces Stripe test clocks — the tool that lets you advance virtual time past the 14-day trial in a single click so you can actually see what happens at conversion. Then 9.4 ensures users can't game the system by creating five new accounts to get five free trials. By 9.5 you'll be testing every failure mode (declined cards, expired cards, 3-D Secure challenges) and by 9.6 Stripe's built-in emails will be handling the mundane communication for you.
