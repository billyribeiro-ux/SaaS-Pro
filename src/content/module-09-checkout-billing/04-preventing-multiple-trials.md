---
title: "9.4 - Preventing Multiple Trials"
module: 9
lesson: 4
moduleSlug: "module-09-checkout-billing"
lessonSlug: "04-preventing-multiple-trials"
description: "Check if a user has already used a free trial before allowing them to start a new one."
duration: 12
preview: false
---

## Overview

A free trial is a gift a company gives its prospects. The implicit assumption is **one gift per person**. But your billing system doesn't know that a user is a person — it knows that the user is a `user_id` with an `email` attached. A motivated individual can register a second email, claim a second trial, and your system cheerfully grants it. On repeat with a third account, a fourth. Over time, a small fraction of users burns trials indefinitely without ever paying.

In most SaaS, this is a 1–3% problem — annoying but not catastrophic. In aggregates, it adds up: a SaaS with 10,000 trials a month at $30/month lost to repeat-trialers is $3,600/month in lost revenue and non-trivial support + compute load. Worth fixing, cheap to fix, and fixing it signals to real customers that your business is run by adults.

The fix has two layers:

1. **Within a single account** — check the user's subscription history before offering a trial.
2. **Across accounts** — bind trial eligibility to a harder-to-farm signal (verified email, payment method fingerprint, etc.).

This lesson implements layer 1 fully and sketches layer 2 pragmatically.

## Prerequisites

- Lesson 9.2 complete — trials can be started via `/api/billing/checkout`.
- Module 7 complete — webhook persists subscriptions to the `subscriptions` table with `trial_start` and `trial_end` columns.

## What You'll Build

- A `hasUsedTrial(userId)` helper in `$server/billing/trial.service.ts`.
- Integration in the checkout endpoint: skip `trial_period_days` if the user has already used a trial.
- A pricing-page adjustment: hide "14-day free trial" copy for users who no longer qualify.
- Thinking tools for the cross-account trial-farming problem.

---

## Step 1: The `hasUsedTrial` Helper

Create `src/lib/server/billing/trial.service.ts`:

```typescript
// src/lib/server/billing/trial.service.ts
import { supabaseAdmin } from '$server/supabase'

/**
 * Returns true if the user has ever started a subscription trial.
 * We look at the local `subscriptions` table rather than Stripe because:
 * - It's faster (one DB query vs an API call).
 * - It's authoritative — the webhook writes every lifecycle change here.
 * - Stripe's search API is rate-limited and slower.
 */
export async function hasUsedTrial(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .not('trial_start', 'is', null)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to check trial history: ${error.message}`)
  }

  return !!data
}
```

Walkthrough:

- **`supabaseAdmin`** — service-role client from Module 4 that bypasses RLS. We're calling this from server-side code on behalf of a user whose ID we already know; we're not exposing the query to the client.

- **`.from('subscriptions').select('id')`** — we only need to know *whether* a row exists, not its contents. Select the primary key and nothing else.

- **`.eq('user_id', userId)`** — filter to this user's subscriptions.

- **`.not('trial_start', 'is', null)`** — the key predicate. A subscription row with a non-null `trial_start` had a trial at some point. Includes trials that:
  - Are currently running (`status: 'trialing'`).
  - Converted to paid (`status: 'active'`).
  - Were canceled during or after the trial (`status: 'canceled'`).
  - Went past-due after the trial (`status: 'past_due'`).

  In each case, the user has *experienced* the trial. They don't get another.

- **`.limit(1).maybeSingle()`** — we only need the first row, and `maybeSingle()` returns `null` rather than throwing when no rows match (as opposed to `.single()` which throws). Cheaper than `count()`.

- **Error handling** — if the query errors, we throw. The caller upstream decides what to do (most likely, fall back to not granting a trial, which is the safe default).

Why not use `status IN ('trialing', 'active', 'canceled')` directly? `trial_start IS NOT NULL` is semantically stronger: it directly expresses "did they ever have a trial?" regardless of the subscription's current status. If a future schema change adds a new status, the check still works. Query by the semantic field, not the derived status.

---

## Step 2: Integrate Into Checkout

Update `src/routes/api/billing/checkout/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit'
import { stripe } from '$server/stripe'
import { getOrCreateCustomer } from '$server/billing/customers.service'
import { hasUsedTrial } from '$server/billing/trial.service'
import { PRICING_LOOKUP_KEYS, TRIAL_DAYS, TRIAL_STRATEGY } from '$config/pricing.config'
import { PUBLIC_APP_URL } from '$env/static/public'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = await locals.getUser()
  if (!user) error(401, 'Unauthorized')

  const { lookup_key } = await request.json()

  const validKeys = Object.values(PRICING_LOOKUP_KEYS)
  if (!validKeys.includes(lookup_key)) error(400, 'Invalid pricing tier')

  const customerId = await getOrCreateCustomer(user.id, user.email!)

  const prices = await stripe.prices.list({
    lookup_keys: [lookup_key],
    active: true,
    limit: 1
  })

  const price = prices.data[0]
  if (!price) error(400, 'Price not found')

  const mode = price.type === 'one_time' ? 'payment' : 'subscription'

  // Only offer a trial to users who haven't used one before.
  const trialEligible = mode === 'subscription' && !(await hasUsedTrial(user.id))

  const subscriptionData = trialEligible
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
    : mode === 'subscription'
      ? { subscription_data: { metadata: { user_id: user.id } } }
      : {}

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    mode,
    success_url: `${PUBLIC_APP_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_APP_URL}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
    ...subscriptionData
  })

  if (!session.url) error(500, 'Failed to create checkout session')

  return json({ url: session.url })
}
```

Walkthrough of the delta:

- **`const trialEligible = mode === 'subscription' && !(await hasUsedTrial(user.id))`** — compute once, use twice. `mode === 'subscription'` first because it's a local check and short-circuits the `await` if false. Saves a DB call for one-time purchases.

- **Three subscription-data branches:**
  1. `trialEligible` → trial config (as before).
  2. Subscription without trial → just metadata, no trial fields. The user goes straight to paid checkout.
  3. One-time payment → empty. No subscription data.

- **The flipped case — no trial — still needs `metadata: { user_id }`.** We want that metadata on every subscription, regardless of trial status, for webhook correlation.

- **Defense posture:** if `hasUsedTrial` throws (DB blip), we never reach this line — the error propagates up, the checkout fails, the user sees an error banner. A failed DB lookup producing "please try again" is much better than silently granting a trial to someone who shouldn't get one.

---

## Step 3: Adjust the Pricing Page

The pricing page in Module 8 probably hardcodes "14-day free trial" on every tier's button. Users who've already used a trial don't qualify, and displaying misleading copy is bad UX.

Load eligibility in `+page.server.ts`:

```typescript
// src/routes/pricing/+page.server.ts
import { hasUsedTrial } from '$server/billing/trial.service'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const user = await locals.getUser()

  const trialEligible = user ? !(await hasUsedTrial(user.id)) : true
  // Logged-out users see trial copy because they haven't used one yet.
  // The server will re-check on checkout; no eligibility is ever granted from the client.

  return { trialEligible }
}
```

Use it in the page:

```svelte
<!-- src/routes/pricing/+page.svelte (excerpt) -->
<script lang="ts">
  let { data } = $props()
</script>

<button onclick={() => subscribe('pro_monthly')}>
  {data.trialEligible ? 'Start 14-day free trial' : 'Subscribe to Pro'}
</button>
```

Two important details:

- **Logged-out users default to `trialEligible: true`.** They haven't used a trial because they don't have an account. If they register and come back, the check runs again on the server at checkout. The pricing-page display is a hint, not a gate.

- **The server is the only real gate.** Even if a user modifies the client to show the trial button, the checkout endpoint's `hasUsedTrial` check will skip `trial_period_days` and they'll pay immediately. Clients can't grant themselves trials.

---

## Step 4: When to Re-Enable a Trial (The Refund Case)

Sometimes a user deserves a second trial:

- They refunded their first subscription within the first week and want another shot later.
- They were trialed through a test or internal account that shouldn't count.
- A support-ticket dispute ended with "okay, we'll give them another trial."

For these, expose an admin-only operation. Don't build a self-serve "reset my trial" button — it defeats the purpose of the check.

A minimal approach: a database function or service method that deletes the user's trial-marker subscriptions, callable only from your admin dashboard.

```typescript
// $server/billing/trial.service.ts (addition)
export async function resetTrialEligibility(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update({ trial_start: null, trial_end: null })
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
}
```

This is a soft reset — the subscription rows remain (they're historical), but the trial markers get cleared so the `hasUsedTrial` check returns false. Only callable from admin code with explicit authorization. Log every call. Never expose from a client-reachable endpoint.

---

## Step 5: The Cross-Account Farming Problem

Everything above prevents a single `user_id` from getting multiple trials. But a motivated farmer can:

1. Sign up as `alice+1@gmail.com`, trial expires, next.
2. Sign up as `alice+2@gmail.com`, trial expires, next.
3. `aliceplus3@proton.me`, `aliceplus4@duckduckgo.com`...

Each is a distinct `user_id`. Your `hasUsedTrial` correctly returns false for each. Your business is losing $30 a month to this one user.

The fixes, in increasing difficulty and decreasing false-positive risk:

### Email verification as a minimum bar

Require users to verify their email before starting a trial. Wired via Supabase Auth's `signUp` confirm-email flow (Module 3). This filters out throwaway email addresses that bounce. Gets rid of the laziest farming attempts.

Cost: adds friction to signup. Typical impact: 5–15% signup drop-off.

### Email normalization — catching plus-addressing

Gmail ignores everything after a `+` in addresses: `alice+1@gmail.com` and `alice@gmail.com` are the same inbox. Normalize emails before storing them to catch this.

```typescript
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@')
  // Strip Gmail plus-address and dots (Gmail also ignores dots in the local part)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return local.split('+')[0].replace(/\./g, '') + '@gmail.com'
  }
  return `${local}@${domain}`
}
```

Store `normalized_email` alongside `email` on `profiles` and unique-index it. Blocks the `alice+N@gmail.com` farmers.

Cost: requires schema migration, careful handling of existing data. Some legitimate users do have plus-addresses they rely on for filtering; we're deliberately collapsing them. Document the behavior.

### Payment-method fingerprinting

Stripe's API returns a stable fingerprint for cards:

```typescript
// Every Stripe.PaymentMethod object exposes `card.fingerprint`
payment_method.card.fingerprint // 'a1b2c3d4e5f6...'
```

Fingerprints are deterministic: the same card used on different accounts produces the same fingerprint. Store `(user_id, card_fingerprint)` in a table on `customer.subscription.created`. Before starting a trial, check if the card has seen a trial before.

Cost: only works for `card_required` trials. Doesn't help with `no_card` trials. Legitimate cases (family sharing a card) get caught. More complex to implement.

### Stripe Radar

Stripe's fraud product has signals beyond card fingerprints — device fingerprints, IP reputation, behavior patterns. If trial abuse becomes a real problem (>5% of your trials), turn to Radar rules like "block trials where the device has seen >2 trials in 30 days." Powerful, but requires analysis of your real abuse patterns to tune well.

For SaaS-Pro, we'll ship the per-account check and email verification. The rest is future work — justified only when abuse is measurable.

---

## Common Mistakes

- **Relying on `status !== 'canceled'`** to detect prior trials. A user who started a trial and is currently in `status: 'canceled'` still had the trial. The correct check is `trial_start IS NOT NULL`.

- **Deleting canceled subscription rows.** Tempting for "cleanliness" — keeps the table small. But then `hasUsedTrial` returns false, and the user gets another trial. Keep historical rows forever; soft-delete if you need to "hide" them.

- **Running the check on the client only.** Client-side eligibility is a display hint, never a gate. The server must re-verify at checkout.

- **Forgetting to skip `trial_period_days` in no-card mode too.** The conditional must apply to both strategies. Copy-pasting the card-required branch and forgetting to handle no-card is a common bug.

- **Using `single()` instead of `maybeSingle()`.** `single()` throws if no rows match, which is a non-error state for a new user. Use `maybeSingle()`.

- **Hard-deleting trial rows for a "refund reset."** Destroys audit trail. Null out the `trial_start/trial_end` fields instead.

- **Confusing trials in the pricing page copy.** Saying "free trial" but giving immediate payment is a dark pattern. If a user isn't eligible, the copy must reflect that.

---

## Principal Engineer Notes

1. **Trial checks are soft security, not hard.** A determined farmer will always find a way — burner emails, VPN IPs, separate devices. The goal is to raise the cost of abuse above the value of free access, not to make abuse impossible. Cost/value: 1% of users stealing trials is acceptable; 10% is a bleed.

2. **Email verification pays compounding dividends.** Beyond trial abuse, it reduces fake signups, improves deliverability of your own emails (verified accounts → lower bounce rate → better sender reputation), and filters spam. Ship it for the side effects, not just trial protection.

3. **Don't build sophistication before you need it.** Start with the `hasUsedTrial` check and email verification. Measure your repeat-trial rate. If it's 1%, stop — your engineering time is worth more than the stolen trials. If it's 10%, escalate to plus-address normalization. Only hit payment fingerprinting + Radar if abuse goes into double digits. Premature sophistication here hurts legitimate users.

4. **Legitimate repeat-trial cases exist.** A user refunded in week 1 and came back 6 months later with genuine interest. A customer accidentally signed up on their personal email first, now wants a trial on their work email. Your support team needs a mechanism to grant trials manually — `resetTrialEligibility` from this lesson is enough. Don't force legitimate users through the same wall as fraudsters.

5. **Be transparent about the policy.** Put "one free trial per account, one per email address" in your terms of service. Users trying honest second attempts will contact support rather than feeling silently blocked. Support can grant exceptions. Trust-building versus adversarial.

6. **The state you need to answer "has this user trialed?" is also the state you need for "what's the user's lifetime value?" and "when did they first become paying?"** Invest in a clean `subscriptions` history table early. The operational queries it enables compound across product, sales, and support functions.

---

## What's Next

Lesson 9.5 widens the test matrix with the full Stripe test card set — success, decline, requires-auth, insufficient-funds — and wires up `past_due` handling so users whose card fails get a clear path to updating their payment method. Our trial checks won't help if a paying customer's card fails and they silently churn; that's the next problem.
