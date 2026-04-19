# Lesson 9.4 — Post-checkout success page + serial-trial guard

> **Module 9 — Checkout & billing portal**
> Previous: [08 — Billing portal](./08-billing-portal.md)
> Next: [10 — Invoice mirror + billing history](./10-invoice-mirror-and-history.md)

## Goal

Two related pieces ship in this lesson:

1. **`/account/billing/success`** — the page Stripe sends users to
   immediately after a successful Checkout. It tells them what they
   bought (tier, interval, headline price), when the trial ends, when
   the next charge will hit, and the last 4 of the captured card.
2. **Serial-trial guard** — a server-side check that prevents users
   from cancelling and re-subscribing in a loop to harvest unlimited
   14-day trials. The next checkout for a returning trialer gets
   `trial_period_days: 0`.

Both are minor in code volume but each closes a real revenue / UX hole.

## Module map

| File                                                               | Layer   | Role                                                                                                                                                           |
| ------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/billing/trial-eligibility.ts` _(new)_              | Service | `hasUserUsedTrial(userId)` + `trialDaysForNextCheckout(userId)`. Reads the local `stripe_subscriptions` mirror; no Stripe round-trip.                          |
| `src/lib/server/billing/trial-eligibility.test.ts` _(new)_         | Tests   | 7 unit tests — fresh user, returning trialer, null-count safety, error path, query-shape contract, both `trialDaysForNextCheckout` branches.                   |
| `src/lib/server/billing/checkout.ts` _(modified)_                  | Service | Replaces the hard-coded `trialPeriodDays = 14` with `await trialDaysForNextCheckout(user.id)`. Header doc updated.                                             |
| `src/routes/(app)/account/billing/success/+page.server.ts` _(new)_ | Load    | Validates `?session_id`, ownership-checks via `client_reference_id`, retrieves the session from Stripe with the right expansions, builds a `SuccessViewModel`. |
| `src/routes/(app)/account/billing/success/+page.svelte` _(new)_    | UI      | Celebratory header + summary table + "Go to dashboard" / "Manage billing" CTAs. Locale-stable formatting. `noindex` meta.                                      |

No new env, no new tables, no new migrations. Both pieces sit on top of the
mirror already shipped in Module 7 and the checkout endpoint shipped in
Lesson 9.1.

## The serial-trial guard

### Why this exists

Stripe's `subscription_data.trial_period_days` is per-Checkout-Session.
The platform itself does NOT remember whether a customer has used a
trial before. Without an application-level guard, a user can:

1. Sign up → Pro, get the 14-day trial.
2. Cancel during the trial (zero charge).
3. Re-subscribe → fresh 14-day trial.
4. Repeat indefinitely.

That's both a revenue leak and a fairness problem against new
customers who do pay. Every mature SaaS implements this guard server-
side. So do we.

### The check

```ts
// trial-eligibility.ts (excerpt)
export async function hasUserUsedTrial(userId: string): Promise<boolean> {
	const { count, error } = await withAdmin(/* … */, async (admin) =>
		admin
			.from('stripe_subscriptions')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', userId)
			.not('trial_start', 'is', null)
	);
	if (error) throw new Error(/* … */);
	return (count ?? 0) > 0;
}
```

We use **`head: true, count: 'exact'`** so Postgres returns just the
row count without serializing the rows. For a boolean we don't need
the rows; this is a few hundred microseconds cheaper than
`select('id').limit(1)` on a hot user.

### Why "any historical row counts"

The mirror retains rows after cancellation (the partial unique index
permits a new `trialing|active|past_due` row alongside any number of
historical `canceled` rows). That retention is what makes the
serial-trial guard cheap and exact, with no extra column.

| Past state                       | `trial_start` set? | Guard fires?                                     |
| -------------------------------- | ------------------ | ------------------------------------------------ |
| Brand new — never subscribed     | n/a                | No                                               |
| Currently trialing               | Yes                | (moot — checkout already refused for active sub) |
| Canceled mid-trial               | Yes                | **Yes**                                          |
| Trialed, paid, canceled later    | Yes                | **Yes**                                          |
| Opened checkout but abandoned    | n/a (no row)       | No                                               |
| Checkout completed without trial | No                 | No                                               |

That last row is intentional: a returning user who once subscribed
**without** a trial (e.g. annual no-trial promo) still gets one if
they ever come back. The signal is "have we ever billed Stripe a $0
trial day for this user", not "have they ever subscribed."

### The composition

```ts
export async function trialDaysForNextCheckout(userId: string): Promise<number> {
	const used = await hasUserUsedTrial(userId);
	return used ? 0 : DEFAULT_TRIAL_DAYS; // 14
}
```

Lifting the boolean → days mapping into its own function gives
`checkout.ts` a clean call site, keeps the policy constant
(`DEFAULT_TRIAL_DAYS`) co-located with the rule that uses it, and
leaves a single seam for future tier-specific overrides
("Business gets 30 days") without re-plumbing checkout.

### Wiring

```ts
// checkout.ts (diff)
- // … the serial-trial guard from Lesson 9.4 will replace …
- const trialPeriodDays = 14;
+ // … if so, this checkout is no-trial. See `trial-eligibility.ts`.
+ const trialPeriodDays = await trialDaysForNextCheckout(user.id);
```

`buildSubscriptionCheckoutParams` already branches on
`trialPeriodDays > 0` to decide whether to set
`subscription_data.trial_period_days` at all — pass 0 and Stripe never
sees a `trial_period_days` field, which is the correct signal for "no
trial." No change to the pure builder, no test updates needed.

### Testability

The unit tests in `trial-eligibility.test.ts` cover:

- **Fresh user** → `hasUserUsedTrial = false` → `trialDaysForNextCheckout = 14`.
- **Returning user** → `hasUserUsedTrial = true` → `trialDaysForNextCheckout = 0`.
- **Null count** is treated as zero (Supabase quirk).
- **Underlying error throws with context** so an outage doesn't silently grant trials.
- **Query shape contract** — assertion on the exact `select` /
  `eq('user_id', _)` / `not('trial_start', 'is', null)` chain so a future refactor can't quietly drop the `trial_start` filter.

We deliberately don't unit-test `createSubscriptionCheckoutSession`
end-to-end here. The serial-trial branch is tested via the
trial-eligibility tests (the boolean) and the existing
`buildSubscriptionCheckoutParams` tests (the param shape) — composing
them adds nothing the mocks don't already cover.

## The success page

### Why we don't read entitlements

The natural-looking implementation is "load `entitlements` from the
(app) layout, render whatever tier they're on now." That has a
visible failure mode: Stripe redirects the user to `success_url`
the moment their Checkout completes, but the
`customer.subscription.created` webhook arrives some milliseconds-to-
seconds later. A fast user lands on the success page with
`tier=starter` (the snapshot's safe fallback for "no row yet") for a
beat — which reads as "your payment failed" to a normal human.

We solve that by reading the **session** directly from Stripe in the
success page's `load`. The session knows what was just bought right
now, no webhook race. The mirror is still source of truth for
everything downstream — it's only this one redirect-landing page
that goes back to Stripe for an authoritative "what just happened."

### Ownership check

The `?session_id=cs_…` parameter is in the URL bar, the browser
history, and the Referer header on any link the user clicks from
this page. We must NOT render billing details for a session unless
its `client_reference_id` matches the authenticated user.

```ts
if (session.client_reference_id !== user.id) {
	error(404, 'We could not find that checkout session.');
}
```

We use **404** rather than 403 so the response is indistinguishable
from "no such session" — no enumeration oracle.

### Validation chain

```text
?session_id missing or malformed   → 303 /account
Stripe.retrieve throws             → 404
client_reference_id ≠ user.id      → 404
payment_status not in (paid,no_payment_required) → 303 /account
metadata.lookup_key missing/invalid → 500 (loud — should never happen)
otherwise                          → render view-model
```

`payment_status === 'no_payment_required'` is the success-with-trial
case. `'paid'` is the immediate-charge case (e.g. the future no-trial
returning-customer flow). Anything else means the user followed the
link prematurely (impossible from Stripe's redirect, but defensive
against shared-link weirdness) or hit a Stripe race — bouncing them
back to /account is the right move.

### View-model

The page renders:

- **Plan** — "Contactly Pro · monthly" / "Contactly Business · yearly"
- **Price** — formatted by the same `formatCurrency` helper that the
  pricing page uses, so the headline reads identically
  ("$19/mo", "$190/yr").
- **Trial ends** — only when on a trial. Locale-stable
  `Intl.DateTimeFormat('en-US', …)` so SSR + CSR agree.
- **First charge / Next charge** — `trial_end` for trialing subs,
  `current_period_end` for already-charged subs. (In API version
  `2026-03-25.dahlia` these live on `subscription.items.data[0]`,
  not the subscription itself; we already know that pattern from the
  subscriptions mirror in Module 7.)
- **Card ending** — pulled from `payment_intent.latest_charge.payment_method_details.card.last4`
  via Stripe's expand. Optional (absent on a $0 trial start).
- **Receipt sent to** — the Customer's email or
  `customer_details.email` from the session.

### CTAs and meta

- "Go to dashboard" (primary) — the main destination after paying.
- "Manage billing" — secondary; goes back to `/account`, which is
  where the live `ManageBillingForm` from Lesson 9.3 sits.
- `<meta name="robots" content="noindex" />` — the URL contains a
  session id; it must not appear in search results.

## What we deliberately did not do

- **No `customer.subscription.created` polling on the success page.**
  We could re-fetch entitlements every 250ms until they catch up, but
  the page already has the truth from Stripe and the next navigation
  to /account will pick up the cached snapshot. Polling is just churn.
- **No flash banner on /account when the user lands there from the
  success page.** They came from the success page; the success page
  IS the celebration. /account is for managing the plan, not telling
  them about it for the second time.
- **No "trial reminder" email.** The `trial_will_end` webhook already
  routes through the dispatcher (Module 7); we add the email send in
  the notifications module rather than coupling it to billing UX
  here.
- **No SuperForms.** The success page is read-only; nothing to
  submit. The endpoint also stays a `+page.server.ts load` (not a
  `+server.ts` GET) because we want SvelteKit's data-loading flow,
  not a JSON return.
- **No webhook-replay button.** "Refresh until your subscription
  appears" is the wrong UX. The Stripe-retrieve approach makes that
  a no-op.

## Manual verification checklist

1. **Start a fresh-user Pro monthly checkout → complete with `4242…`.**
   Land on the success page. Trial-end date is 14 days out, "First
   charge" matches, card "Ending 4242" appears, plan reads
   "Contactly Pro · monthly".
2. **Cancel the subscription via Manage billing → start a NEW Pro checkout.**
   Stripe Checkout shows no trial, immediate charge. Land on success
   page; "Payment received" header (not "Trial started"), "Next
   charge" is one billing period out, no trial-end row.
3. **Visit `/account/billing/success` with no `session_id`.** 303 to
   `/account`.
4. **Visit `/account/billing/success?session_id=cs_test_invalid`.** 404.
5. **Visit `/account/billing/success?session_id=cs_…`** for someone
   else's session. 404 (ownership check fires).
6. **Sign out and visit the success URL.** The (app) layout guard
   bounces to `/sign-in?next=/account/billing/success`.

## Try it

```bash
pnpm dev
# Use a Stripe test customer; complete a Pro monthly checkout.
# success page shows trial summary.
# Cancel via Manage billing, retry checkout: no trial.
```

[Back to course README](../../README.md)
