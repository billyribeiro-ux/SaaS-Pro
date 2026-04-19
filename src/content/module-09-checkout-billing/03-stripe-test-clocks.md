---
title: "9.3 - Stripe Test Clocks"
module: 9
lesson: 3
moduleSlug: "module-09-checkout-billing"
lessonSlug: "03-stripe-test-clocks"
description: "Use Stripe test clocks to simulate the passage of time and test subscription lifecycle events."
duration: 10
preview: false
---

## Overview

Subscriptions are about time. A monthly subscription bills 30 days apart. A trial ends in 14 days. A canceled-at-period-end subscription terminates next billing cycle. Every interesting behavior — trial-to-paid conversion, first-renewal-failure, dunning retry, annual renewal reminders — happens days, weeks, or months after the subscription was created.

Testing that as a developer is brutal without tools. "Let me verify the trial-to-paid transition works" should not mean "wait 14 days, then check." You'd never ship anything. Historically, teams worked around this by writing custom scripts to manually advance invoice dates in the database, or by setting absurdly short trial periods in test environments, or by just hoping the production behavior matches the integration they wrote.

**Stripe Test Clocks** eliminate all that. A test clock is a virtual clock attached to a Stripe customer. You advance it by days or months with one API call (or one button in the dashboard). Every Stripe object that would have advanced by that much real time — subscription renewals, trial ends, invoice attempts, retry schedules — advances as though that time had passed. Webhook events fire. Invoices generate. Cards get charged (in test mode). Your webhook handler sees everything it would see in production, compressed into a 10-second dev loop.

If you're building billing for a SaaS, test clocks are non-negotiable. This lesson walks through using them effectively.

## Prerequisites

- Lesson 9.2 complete — you can create a trialing subscription via `/api/billing/checkout`.
- Stripe CLI installed and listening (`stripe listen --forward-to localhost:5173/api/webhooks/stripe`).
- Webhook handler persisting `subscriptions` rows from Module 7.

## What You'll Build

- A test clock created in the Stripe dashboard.
- A customer attached to that test clock.
- A subscription started, then fast-forwarded past the trial end.
- The webhook events that fire and how they flow through your DB.
- A mental model for using test clocks in CI and manual QA.

---

## What Exactly Is a Test Clock?

A test clock is a Stripe object — `Stripe.TestHelpers.TestClock` — that represents a frozen-or-advanceable notion of "now." You create it with `stripe.testHelpers.testClocks.create({ frozen_time })` (or via the dashboard). Any customer created **with a reference to that clock** becomes time-bound to it.

```typescript
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: Math.floor(Date.now() / 1000),
  name: 'trial-flow-test'
})

const customer = await stripe.customers.create({
  email: 'alice@example.com',
  test_clock: clock.id
})
```

After this:
- The customer's billing cycles, subscription renewals, trial ends — all calculated relative to the clock, not wall-clock time.
- When you advance the clock, all of the customer's Stripe objects advance in sync. Invoices generate. Subscriptions transition. Trial ends. Webhooks fire. Everything you'd see in real time is compressed into the single `testHelpers.testClocks.advance()` call.
- The customer can only be operated on with this clock active. Deleting the clock deletes the customer and everything attached to it.

Important: test clocks live only in **test mode**. You cannot attach one to a live-mode customer. That's intentional — no one wants to accidentally time-travel a real customer's subscription.

---

## Creating a Test Clock via the Dashboard

The fastest path for manual QA:

1. Go to [dashboard.stripe.com/test/test-clocks](https://dashboard.stripe.com/test/test-clocks).
2. Click **New test clock**.
3. Name it descriptively: `trial-flow-2026-04-18`. You'll make many of these; a descriptive name helps later.
4. Set the starting time — default "now" is almost always what you want.
5. Click **Create**.

You're now on the clock detail page. Keep it open in a tab.

---

## Attaching a Customer to a Test Clock

Two ways:

### Option A: Dashboard

On the clock detail page, click **Create customer**. Fill in email. The customer is created and bound to this clock.

Then create a subscription for the customer via the dashboard's **Subscriptions** tab on the customer page — pick your price, check the "14-day trial" box, create.

Quick and visual. No code required. Excellent for sanity-checking an expected behavior.

### Option B: API

In a script:

```typescript
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia'
})

async function main() {
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: 'trial-flow-' + new Date().toISOString()
  })

  const customer = await stripe.customers.create({
    email: `test+${Date.now()}@saaspro.dev`,
    test_clock: clock.id
  })

  const prices = await stripe.prices.list({
    lookup_keys: ['pro_monthly'],
    limit: 1
  })

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: prices.data[0].id }],
    trial_period_days: 14,
    default_payment_method: 'pm_card_visa' // a Stripe test PM token
  })

  console.log({ clock: clock.id, customer: customer.id, subscription: subscription.id })
}

main().catch(console.error)
```

This is the pattern you'd use in an automated integration test. It takes ~2 seconds to run and gives you a clock, a customer, and a trialing subscription — all ready for time-travel.

**Note about `default_payment_method`.** Stripe provides a set of test-mode-only payment-method tokens like `pm_card_visa`, `pm_card_mastercard`, `pm_card_chargeDeclined`, and so on. They represent stored payment methods without going through Checkout. Use them in scripts when you need to simulate "user with a saved card" quickly.

---

## Advancing the Clock

From the dashboard, click **Advance time** and pick a duration (1 hour, 1 day, 1 week, 1 month). The clock advances; Stripe processes everything that would have happened in real time. Webhooks start firing immediately.

From the API:

```typescript
await stripe.testHelpers.testClocks.advance(clock.id, {
  frozen_time: Math.floor(Date.now() / 1000) + 15 * 24 * 60 * 60 // 15 days from now
})
```

Advance the clock past the 14-day trial, and within a few seconds you'll see:

- `customer.subscription.trial_will_end` (72h before the advanced time, so it fires)
- `invoice.created` (an invoice for the first real period)
- `invoice.finalized`
- `invoice.paid` (because the test card succeeded)
- `customer.subscription.updated` (status `trialing` → `active`)
- `payment_intent.succeeded`

Your webhook handler processes these. Your `subscriptions` row transitions. Your access-control gates update. The end-to-end trial-to-paid flow, tested in 10 seconds.

---

## Testing Multiple Scenarios

Run the whole subscription lifecycle:

1. **Create** the clock at `now`.
2. **Create** customer + subscription with 14-day trial.
3. **Advance** to day 15 → first charge → subscription active.
4. **Advance** to day 45 → month-2 renewal → charge → invoice paid.
5. **Cancel** subscription at period end.
6. **Advance** to day 75 → subscription becomes `canceled`.

Each advance triggers the real webhook events. Your handler is exercised as if in production. Bugs you'd only see after 90 days in production are surfaced in 30 seconds.

### Testing failed renewals

Swap `pm_card_visa` for `pm_card_chargeDeclined` when creating the subscription, advance past the trial, and watch:

- `invoice.payment_failed` fires.
- Subscription status transitions to `past_due`.
- Stripe Smart Retries schedules follow-up attempts (covered in 9.5).
- Advancing further triggers each retry.

Your `past_due` UX — the banner telling the user to update their card — is now testable without fabricating real card declines.

---

## Cleanup

When you're done with a clock:

```typescript
await stripe.testHelpers.testClocks.delete(clock.id)
```

Or delete it from the dashboard. **This deletes every customer, subscription, invoice, and payment intent attached to the clock.** That's usually what you want — test data is ephemeral. If you forget, Stripe auto-deletes test clocks after 30 days of no activity.

For iterating in dev, we usually create a new clock + customer per test run rather than reusing one. It's cheap, and it isolates tests from each other. In CI, the cleanup should be an `afterEach` hook.

---

## Why Test Clocks Are Essential

Before test clocks, teams used one of three bad strategies:

1. **Short trial periods in dev** — set `trial_period_days: 0.01` to simulate days in minutes. Doesn't work (Stripe only accepts integer days), and workarounds like mutating DB rows directly bypass the webhook logic you're trying to test.

2. **Mock Stripe entirely** — wrap every Stripe API call and fake the responses. Brittle; mock drift is a constant source of bugs.

3. **Pray** — ship the code, monitor production, fix bugs after real customers hit them. The traditional method. Results in embarrassing "billing broke for three days" postmortems.

Test clocks replace all three. You use the **real Stripe API**, the **real webhook events**, your **real handlers**, with **virtual time**. It's high-fidelity testing with dev-loop speed.

---

## Integrating With CI

A CI job that exercises the billing lifecycle:

```yaml
# .github/workflows/billing-e2e.yml
name: Billing E2E
on: [pull_request]
jobs:
  billing-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm test:billing
        env:
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_SECRET_KEY }}
          STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_TEST_WEBHOOK_SECRET }}
```

Where `pnpm test:billing` runs a Vitest suite that:

1. Spins up a temporary SvelteKit dev server.
2. Uses the Stripe CLI to forward webhooks.
3. Runs tests that create test clocks, advance them, assert on DB state.

The CI runs billing lifecycle assertions on every pull request. Regressions surface in 2 minutes instead of 2 months. Covered in depth in Module 11.

---

## Common Mistakes

- **Reusing a test clock across tests without cleanup.** State accumulates; later tests see subscriptions from earlier tests. Make clocks ephemeral per test.

- **Advancing the clock to a past time.** Stripe rejects clock advances that go backward. Track the clock's current time and always advance forward.

- **Expecting webhooks to fire instantly after advance.** They fire asynchronously — usually within 1–3 seconds, but occasionally longer. Tests that assert on webhook side-effects must wait (poll the DB or use a test harness with a webhook-received signal).

- **Testing in live mode.** Test clocks don't exist in live mode. Make sure your Stripe client uses test keys for the tests that use them.

- **Using a real credit card.** Test clocks are test-mode only, and Stripe won't let you attach a live payment method anyway. Always use `pm_card_visa`, `pm_card_chargeDeclined`, etc. for test clock scenarios.

- **Forgetting to delete the clock in `afterEach`.** Dashboards litter up; Stripe eventually cleans up, but not fast. Always cleanup explicitly in CI.

- **Advancing one hour to test a daily renewal.** Advance needs to cross the actual renewal boundary (14 days + 1 second is enough; 13 days 23 hours is not). Respect the real period granularity.

---

## Principal Engineer Notes

1. **Test clocks are the feature that makes billing test-driven possible.** Before them, billing code was written, deployed, and bug-fixed in production. With them, you write a test that says "14 days from now, the user is charged," run it in 10 seconds, and iterate. Every serious SaaS engineering team should standardize on them.

2. **Determinism matters.** A test clock gives you reproducibility. Wall-clock-driven tests are non-deterministic — they fail on the 28th of February, or when DST shifts, or at midnight UTC. Virtual time is the same every run. Lean into it.

3. **Coverage priorities:** the most valuable test clocks scenarios are (a) trial-to-paid conversion, (b) renewal with successful charge, (c) renewal with failed charge → dunning → final cancel, (d) upgrade mid-cycle with proration, (e) downgrade at period end. Those five cover 90% of production billing edge cases.

4. **Don't build a test harness in a vacuum.** Integrate test clocks into your existing E2E framework (Playwright covered in Module 11). A test that says "start trial → advance clock → assert dashboard shows 'trial ended'" is more useful than a unit test that says "webhook handler sets status to canceled." The user-visible behavior is what matters.

5. **Be mindful of test data.** Each test clock run creates a handful of Stripe objects (customer, subscription, invoice, payment intent). They live in test mode but they do show up in your test dashboard. Name clocks with a prefix like `ci-` or `manual-` so you can bulk-delete them periodically.

6. **Clock drift is a silent source of flakiness.** If your test code uses `Date.now()` *and* the clock's `frozen_time`, mismatches create subtle timing bugs. Always compute advance targets from the clock's reported time, not from wall clock. Stripe's SDK returns the clock's `frozen_time` in every response — use it.

---

## What's Next

Lesson 9.4 locks down a social edge case: what stops a user from signing up, canceling their trial, creating a new account, and doing it again? We'll query for prior trials and block repeat offers. Lesson 9.5 expands the test matrix with every flavor of test card so you can simulate declines, 3-D Secure prompts, and insufficient-funds failures — all testable with the clock mechanism you just learned.
