---
title: '9.6 - Subscription & Email Settings'
module: 9
lesson: 6
moduleSlug: 'module-09-checkout-billing'
lessonSlug: '06-subscription-email-settings'
description: "Configure Stripe's automatic email notifications for receipts, failed payments, and renewals."
duration: 8
preview: false
---

## Overview

A billing email system is a bigger engineering project than it sounds. "Send a receipt when the user pays" expands into "from what domain, with what branding, containing what tax details, localized in what language, delivered by what ESP, respecting what CAN-SPAM requirements, traceable with what link tracking." Six months into a SaaS, a billing-email initiative is a tiny team project.

Or you can check five boxes in the Stripe dashboard.

Stripe bundles a full transactional email system with Checkout and Subscriptions — receipts, trial-end reminders, failed-payment dunning, renewal notifications. The emails are CAN-SPAM compliant by default, sent from a verified Stripe domain, localized, and branded with your logo and colors. For most SaaS, they cover 100% of billing email needs without a single line of code.

This lesson is about knowing what's available, enabling the right subset, and making a clean decision on "Stripe vs our own email system" for billing. It's a short lesson because the work is short — but the decision deserves reflection.

## Prerequisites

- Lessons 9.1–9.5 complete — subscriptions are flowing.
- Access to the Stripe Dashboard for the account used in this project.

## What You'll Build

- Enabled Stripe emails for receipts, failed-payment retries, and renewal reminders.
- A Stripe branding config that matches SaaS-Pro visually.
- A clear decision on which billing emails (if any) to move to your own transactional email provider later.

---

## Where the Settings Live

Stripe Dashboard → **Settings** → **Billing** → **Customer emails**, and → **Settings** → **Subscriptions and emails**. Depending on Stripe UI version the labels shuffle slightly, but the toggles you want are all there.

The key toggles:

### 1. Send customers receipt emails

- **Path:** Settings → Billing → Customer emails → "Successful payments"
- **Effect:** After every successful charge (subscription renewal, one-time payment), Stripe emails the customer a branded receipt including date, amount, tax, invoice number, hosted-invoice URL, and line items.
- **Turn on.** No reason not to. Customers expect receipts; not sending them causes support tickets.

### 2. Send customers invoice reminders (renewal reminders)

- **Path:** Settings → Billing → Customer emails → "Failed payments" and related renewal notifications.
- **Effect:** For subscriptions billing within a configurable window (e.g., 7 days out), Stripe can email the customer. Primarily useful for annual subscriptions where the amount is larger and surprise is higher.
- **Turn on for annual plans.** For monthly plans, opinions differ — some say reminders create unnecessary churn moments. I'd say: for a $9/mo plan, skip. For a $99/mo or $999/year plan, send.

### 3. Failed-payment emails (dunning)

- **Path:** Settings → Billing → Customer emails → "Failed payments"
- **Effect:** When a payment retry fails, Stripe emails the customer with the retry status and a link to update their payment method (opens the customer portal — 9.7).
- **Turn on.** This is the single highest-leverage toggle in the whole panel. Failed-payment emails recover 30–50% of involuntary churn. Just flip it.

### 4. Trial-ending emails

- **Path:** Settings → Subscriptions and emails → "Send trial-ending reminders"
- **Effect:** 3–7 days before a trial ends (configurable), Stripe emails the customer.
- **Turn on** if you're using card-required trials (so conversion feels less surprising). For no-card trials it's mandatory (otherwise users forget entirely and the subscription cancels on them).

### 5. Subscription-canceled emails

- **Path:** Settings → Subscriptions and emails → "Send cancellation confirmations"
- **Effect:** On cancellation, user receives a confirmation email with final-invoice link.
- **Turn on.** Avoids "you canceled me without telling me" disputes.

---

## Branding the Emails

Stripe Dashboard → **Settings** → **Branding**. Upload:

- **Logo** — PNG with transparent background, 512×512 or larger. Shows at the top of every email.
- **Icon** — small square version (e.g., 128×128), used in some contexts.
- **Accent color** — hex code; applies to links and buttons in the emails. Use your brand's primary color.
- **Typography** — limited font choices (Stripe defaults are fine).

Set these once. Every future email uses them. The visual consistency with your app is usually indistinguishable from a custom-built emailer.

Important: branding applies to:

- Invoices (hosted and emailed).
- The Checkout page.
- The customer portal.
- All the billing emails above.

One set of config; unified brand across every Stripe-hosted surface.

---

## The Decision: Stripe Emails vs Your Own

For most SaaS, Stripe's billing emails are the right choice. But there are legitimate reasons to move some of them to your own email system (Postmark, SendGrid, Resend, AWS SES, etc.):

### Keep Stripe-handled when:

- You want it to "just work" — you have more important engineering priorities.
- Your brand is simple — Stripe's template aesthetic (modern, clean, minimal) matches you.
- You're not running complex lifecycle marketing that needs to coordinate with transactional sends.
- You're below 10,000 emails/month — volume-tier discounts on third-party ESPs aren't yet worth the integration cost.

### Move to your own system when:

- You're running a lifecycle email program (Customer.io, HubSpot, etc.) and need billing events in the same stream for unified unsubscribe management and reporting.
- You have a strong design system and Stripe's template feels off-brand in a way that's measurably reducing open rates or click-throughs. (Rare — usually subjective designer preference.)
- You're sending enough volume that consolidated sender reputation matters. Stripe's shared sending domain is fine for small-to-mid volume; at enterprise scale you may want your own subdomain to control reputation.
- You need dynamic content Stripe doesn't support — e.g., "here are 3 other customers in your industry using us for X" personalization blocks.
- Legal/compliance requires emails from your own legal entity's domain (some EU contracts).

### The hybrid approach

Enable Stripe emails for the operationally-critical subset:

- **Receipts** — Stripe.
- **Failed payments (dunning)** — Stripe. It's the highest-revenue email; don't build custom unless you know what you're doing.

And build your own for:

- **Trial-ending** — your side. You want to combine "trial ending" with product-usage stats ("you've created 47 contacts, don't lose them"), which Stripe can't do.
- **Renewal-coming-up on annual** — your side. Combine with a "here's what changed this year" recap.
- **Cancellation confirmation + win-back sequence** — your side. Cancellation emails can link to a "what went wrong?" survey and begin a win-back sequence.

The hybrid is the most common mature setup. Ship with Stripe-everything on day 1, migrate individual templates to your own system as their value grows.

---

## Compliance Points Worth Knowing

### CAN-SPAM / GDPR

Stripe's emails are already compliant:

- They include the sender's physical address (your business's, which you set in dashboard).
- They include unsubscribe links for non-transactional messages (note: receipts and dunning emails are **transactional** and exempt from unsubscribe requirements; trial/renewal reminders are transactional borderline but Stripe includes opt-outs anyway).
- They honor the contact's communication preferences Stripe stores.

If you move emails to your own system, you inherit all these requirements. Don't skip them — they're not optional.

### Deliverability

Stripe's sending infrastructure has high IP reputation. Emails from Stripe are rarely marked as spam. If you build your own system, you'll need to:

- Set up SPF, DKIM, DMARC records on your domain.
- Warm up new IPs/domains gradually.
- Monitor bounce rates and complaint rates.

The deliverability investment is non-trivial. Unless you have a reason to move, leaving billing on Stripe gives you one less thing to operate.

---

## Testing the Emails

Before going to production, trigger each email type and verify they render correctly:

1. **Receipt:** Run a test charge (test clock or manual dashboard payment). Check the email in the customer's inbox (use a real Gmail for this, not a burner — check rendering across clients).
2. **Failed payment:** Use `pm_card_chargeDeclined` on a test subscription, advance the test clock past billing. The failed-payment email arrives.
3. **Trial ending:** Create a subscription with a short trial (`trial_end: now + 4 days`), advance clock. 72h-before email fires.
4. **Cancellation:** Cancel a subscription; the cancel email fires.

Check on mobile too. The Stripe defaults are responsive, but verify with your logo and color choices — sometimes large logos on mobile look cramped.

---

## Common Mistakes

- **Leaving failed-payment emails off.** This is the single biggest leave-money-on-the-table mistake in SaaS billing configuration. Enable it on day 1.

- **Branding the Stripe panel but forgetting the business-info fields.** Customers' receipts show the business address and support email from Stripe settings. If they show "123 Main St" placeholder text, your professionalism takes a visible hit. Fill in real details.

- **Sending duplicate emails.** If you enable Stripe's trial-ending email and also build your own, users get two. Pick one. Don't overlap transactional templates.

- **Testing with an inbox that filters Stripe emails to spam.** Some corporate inboxes aggressively filter Stripe; your own inbox is a poor test. Use a personal Gmail for testing.

- **Changing branding mid-flight.** Uploading a new logo mid-month means May receipts have the old logo, June receipts have the new one. Your records look inconsistent. Pick branding and commit; change only during a deliberate rebrand.

---

## Principal Engineer Notes

1. **Default to Stripe-handled for billing emails.** The custom-email temptation is real — every designer wants to own the template — but the ROI of a custom billing-email system is almost always negative until you're above $1M ARR. Stripe's defaults are objectively good; your time is better spent on product.

2. **Compliance is inherited, not outsourced.** You're still legally responsible for what's sent on your behalf, even through Stripe. Read the templates at least once. Verify your business name, support email, and address are correct. Verify you're not accidentally advertising anything in transactional emails (CAN-SPAM allows minimal branding but not promotions).

3. **The failed-payment email is the retention product.** When you eventually A/B test your billing flow, the highest-leverage test is usually failed-payment email copy. Small wording changes ("Your payment failed" → "We couldn't process your card — let's fix it") can move recovery rates by 5–15%. Save that for when you're measuring; ship with Stripe defaults.

4. **Deliverability compounds.** The reason Stripe emails arrive in the primary inbox isn't magic — it's years of their ESP relationships, IP warming, and SPF/DKIM hygiene. Replicating that from scratch takes 3+ months of dedicated work. Factor this in when deciding to move emails.

5. **Keep receipts on Stripe even if everything else moves.** Receipts are a regulatory artifact — they need amounts, taxes, invoice numbers — and getting them wrong has legal (not just UX) consequences. Stripe's receipt is already compliant with sales tax rules across most jurisdictions. Don't rebuild this.

6. **The email system is a product lever, not just infrastructure.** The best SaaS companies treat lifecycle emails (onboarding, feature adoption, win-back, reactivation) as part of the product experience. Invest there. But stay dry on billing emails unless you can articulate a concrete gain from custom.

---

## What's Next

Lesson 9.7 configures the Stripe Customer Portal — the self-serve billing UI that your failed-payment emails link to, and that your in-app "Manage subscription" button will open. Enabling the right features (cancel, pause, payment update) and tuning the cancellation flow is the next — and final — piece of SaaS-Pro's billing UX before we build the endpoint that opens it (9.8).
