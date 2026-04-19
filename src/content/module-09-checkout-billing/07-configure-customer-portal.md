---
title: '9.7 - Configure Customer Portal'
module: 9
lesson: 7
moduleSlug: 'module-09-checkout-billing'
lessonSlug: '07-configure-customer-portal'
description: "Configure Stripe's hosted Customer Portal so users can manage their own subscriptions."
duration: 12
preview: false
---

## Overview

Every SaaS needs a place where a customer can:

- Update their credit card.
- See their past invoices.
- Change their subscription tier (or stop their subscription).
- Update their billing email and address.

Most SaaS either build this themselves (weeks of UI, edge cases, localization) or punt on it entirely and rely on support tickets. Both are bad: building it wastes engineering time that doesn't differentiate your product; punting it inflates support cost 10×.

Stripe's **Customer Portal** solves this. It's a hosted, fully localized, fully branded self-service billing page that Stripe renders on `billing.stripe.com`. You configure which features are exposed once, in the dashboard. Then in your app, you generate a portal session for a customer and redirect them. They land on a page that looks like it came from your product, they handle their business, they come back when they're done.

Self-serve billing is a compounding UX lever: it reduces support load every day it ships, and the reduction scales with your customer count. For a SaaS above 100 paying customers, skipping the portal is effectively choosing to hire a billing-support person instead.

This lesson configures the portal in the dashboard. Lesson 9.8 builds the endpoint to open it.

## Prerequisites

- Lessons 9.1–9.6 complete — subscriptions and emails are live.
- Stripe Dashboard access in test mode.

## What You'll Build

- Portal configuration enabled for: subscription management, payment update, invoice history, billing profile updates.
- Cancellation flow configured — immediate or at-period-end.
- Return URL pointed to `/account`.
- A brand-matching visual theme.

---

## Step 1: Open the Portal Settings

Stripe Dashboard → **Settings** → **Customer portal** (under Billing). You'll see sections:

- **Branding** — inherited from the Branding settings we configured in 9.6.
- **Features** — the toggles for what users can do.
- **Business information** — links to terms of service, privacy policy, support contact.
- **Return URL** — where Stripe redirects users when they leave the portal.
- **Default behavior** — subtle flags for how sessions are created.

---

## Step 2: Enable the Core Features

Each toggle corresponds to a feature the portal will expose to customers. For SaaS-Pro, enable:

### Subscription management

- **Pause** — off. Pausing is powerful but adds complexity (pause duration, resumption, pro-ration rules). Add it after you've measured cancellation reasons and want to offer "take a break" as an alternative to cancel.
- **Cancel** — on. Users can cancel their subscription from the portal.
  - **Cancellation type** — "At period end" is the right default. User cancels, keeps access through the paid period, no refund needed.
  - **Cancellation reasons** — enable. Stripe adds a "Why are you canceling?" dropdown. You get free churn-reason data.
  - **Custom questions** — optional. Add "What could we improve?" as a free-text follow-up.
- **Update plan** — on. Users can switch between prices they have access to (e.g., Pro → Enterprise, or Monthly → Annual).
  - **Products** — curate which products/prices are switchable. Your Starter, Pro, Enterprise prices probably want to be cross-switchable; archived prices should be excluded.
  - **Pro-rate when switching** — on. Standard billing behavior for upgrades.

### Customer information update

- **Update billing information** — on. Lets users edit their billing address, phone, tax ID. Tax IDs are important for EU B2B customers (they need a valid VAT number for reverse-charge invoicing).
- **Update payment methods** — on. Users can add/remove/change default cards. This is the feature the "Update payment method" banner from 9.5 routes to.
- **Update email** — recommended on. Lets the customer change where invoices are sent. Note: this only changes the Stripe customer email, not your app's user email — they're separate fields.

### Invoice history

- **Invoice history** — on. Users see past invoices and can download PDFs. Low-code way to handle "can I get a receipt from three months ago?" requests.

---

## Step 3: Cancellation Flow — Immediate vs End of Period

The cancellation toggle has a critical sub-setting:

- **Cancel immediately** — subscription ends the moment they click cancel. Access is revoked. Stripe refunds the unused portion (pro-rated).
- **Cancel at the end of the billing period** — subscription remains `active` with `cancel_at_period_end: true`. User retains access until the period ends. No refund.

**Default for SaaS: cancel at the end of the billing period.** Reasoning:

- The user already paid for this month. Taking their access away immediately feels punitive.
- Most SaaS don't issue pro-rated refunds — it's operational overhead and encourages cancel-refund-resubscribe arbitrage.
- The "paid through April 30" buffer gives the user a chance to reconsider. Some % of cancellations get reversed (via the portal or by support).

Only use "cancel immediately" if:

- Your product is usage-based and users are paying for compute they're not using.
- You have a strong no-refund policy and want the user to know access ends now.
- Regulatory reasons require immediate termination.

---

## Step 4: Update Plan — The Proration Discussion

When a user upgrades mid-period ($9 Starter → $29 Pro), Stripe can handle the billing in two ways:

- **Pro-rate** — charge the difference immediately, pro-rated for the remaining period. User sees an invoice for ~($29 - $9) × (days remaining / 30).
- **No proration** — switch the price, next bill is at the new rate, no mid-cycle charge.

For upgrades, pro-ration is conventional (and enabled by default). For downgrades ($29 Pro → $9 Starter), pro-ration would _credit_ the user — also fine, but some SaaS choose "downgrade takes effect next period" (no proration) to avoid credit balances.

Stripe portal respects the settings you configured at the price level. In most SaaS, pro-rate on upgrade, no-proration on downgrade is a fine combination. We'll leave Stripe's default (proration on both) for SaaS-Pro and adjust only if we see real usage patterns suggesting otherwise.

---

## Step 5: Set the Return URL

At the bottom of the portal settings, **Default return URL**:

```
http://localhost:5173/account
```

(For production, set `https://saaspro.dev/account`.)

When a user clicks "Return to [business]" in the portal, or completes an action that triggers a return, Stripe sends them here. `/account` is a natural landing spot — it's the page from which they originally clicked "Manage subscription."

You can also pass `return_url` per-session (from our endpoint in 9.8), overriding the default. But setting a sane default here protects against bugs where the endpoint forgets to specify one.

---

## Step 6: Branding

The portal inherits the branding you set in 9.6 (logo, accent color, font). Verify in the preview panel on the portal settings page. If something looks off — logo too big, color too dark on the button — adjust in Branding settings; the portal updates immediately.

Optional: the portal has a **Header background color** and **Header text color** that are separate from the general branding. Match them to your navbar for a seamless transition.

---

## Step 7: Manually Test the Portal

Stripe Dashboard → Settings → Customer portal → **Preview**. A sample portal opens with a fake customer. Click around:

- Try the "Cancel subscription" flow. Verify the cancellation-reasons dropdown appears.
- Try "Update plan." Verify your Starter/Pro/Enterprise prices show as options and the current one is marked.
- Try "Update payment method." A Stripe-hosted card form appears.
- Try the invoice history. At least one row should show (from your test charges).

If anything is missing or misconfigured, fix it here before building the endpoint. The portal's behavior is 100% dashboard-driven; your code just opens it.

---

## Step 8: Configure for Production Separately

Critical gotcha: **portal settings are per-Stripe-account-mode**. Your test mode config doesn't copy to live mode. When you switch to live keys for production, you'll see the portal settings revert to defaults.

Two options to handle this:

- **Configure live mode manually when you go to prod.** Easy, one-time task.
- **Use the Configuration API.** Stripe exposes `stripe.billingPortal.configurations.create()` and `.update()` — you can codify your portal config as infrastructure-as-code. Useful for large teams with multiple environments.

For SaaS-Pro we'll do it manually — one configuration, done once for live mode when you deploy. Document it in a runbook.

---

## Common Mistakes

- **Enabling pause without understanding it.** Pause is a great feature, but it has tax and proration implications that differ from cancellation. Ship without pause; add only after measuring whether users want it.

- **Leaving cancellation set to "Cancel immediately" by accident.** Users cancel on day 2 of a monthly subscription and lose 28 paid days. They feel cheated. Always verify the cancellation timing.

- **Allowing plan updates without curating the product list.** A user on Enterprise sees "Downgrade to starter" as a one-click option, and you lose $200/month overnight. Curate which products are shown; hide enterprise-tier down-switches from self-serve.

- **Forgetting to update Terms of Service / Privacy links.** The portal footer links to these. If they point to placeholder URLs, your compliance story is broken. Set real URLs.

- **Testing only in the preview.** The preview uses a fake customer; real customers have real subscriptions, real cards, real invoices. Test with an actual test-mode customer after you ship the endpoint (9.8), before calling it done.

- **Different portal config across team members' dashboards.** Stripe portal config is shared across the whole account — no "my config" vs "your config." A teammate enabling pause for their own test affects all users. Agree on config in PRs or runbooks, not ad-hoc.

- **Not testing the cancellation reasons UX.** Enable it, then cancel a test subscription — does the dropdown have the reasons you want? Add custom reasons if the defaults don't fit your product.

---

## Principal Engineer Notes

1. **Self-serve is a compounding UX lever.** Every user who cancels, upgrades, or updates a card via the portal is one who didn't open a support ticket. Compound this over 10,000 customers and the portal is worth a full-time support role. It's one of the highest-ROI engineering decisions available to a SaaS.

2. **The cancellation flow is product, not ops.** Tuning the cancellation-reasons list gives you actionable churn data. Reviewing those reasons monthly drives your retention roadmap. Without the portal surfacing this, churn feedback arrives via support tickets — biased toward users angry enough to complain, missing the silent-cancellers.

3. **Match the portal to the support team's incentives.** Support's job is partly to save cancellations via retention offers. If the portal cancels in one click, support loses its intervention opportunity. Compromise: show a "Before you go, talk to us?" option in the portal or redirect through an in-app "Why are you canceling?" page that can route retention offers before confirming with Stripe. (This is more advanced — ship vanilla portal first, layer on later.)

4. **Hosted is the correct default; custom only when you have a reason.** You can build a custom UI for subscription management by calling Stripe's APIs directly. I've seen teams do this for design reasons and regret it — the portal's behavior handles 40+ edge cases (pro-ration math, tax, invoice generation, 3DS on payment updates) that are all your responsibility in a custom build. Unless you have a very specific reason, stay hosted.

5. **Instrument portal usage.** You won't have page-view analytics on Stripe's pages, but you can track the _entry_ to the portal (when your endpoint creates a session) and listen for webhook events that follow. If 2% of monthly active users touch the portal, that's a healthy signal. If it's 0.1%, your "Manage subscription" button is probably hidden or broken.

6. **Pause is a churn-softener worth considering later.** Users who are busy, traveling, or temporarily unable to pay often choose "cancel" when they really mean "pause." Enabling pause converts some cancellations into 30-day delays, and a meaningful portion of paused users resume. Add it after you have churn data — not as a day-1 default.

7. **Regional considerations matter.** EU customers need tax IDs in the portal (VAT numbers) to get proper invoices. If you're selling B2B in the EU, ensure "Update billing information" includes tax ID collection. The portal does this by default, but double-check.

---

## What's Next

Lesson 9.8 builds the `/api/billing/portal` endpoint that generates a portal session and returns its URL, plus the "Manage subscription" button on the account page that opens it. Ten minutes of code, a huge UX and operational win. After that, Module 9 is complete and we move to Module 10 for access control — deciding what each subscription status grants the user.
