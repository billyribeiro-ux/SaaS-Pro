---
title: '12.5 - Stripe & Supabase in Production'
module: 12
lesson: 5
moduleSlug: 'module-12-cicd'
lessonSlug: '05-stripe-supabase-in-production'
description: 'Register your production webhook endpoint in Stripe and configure production API keys.'
duration: 15
preview: false
---

## Overview

Contactly currently accepts subscriptions — using Stripe's **test** keys. In test mode, card number `4242 4242 4242 4242` works like a charm, no real charge is made, no money moves. That's been perfect for development. It's also useless for an actual business.

This lesson flips the switch. By the end, a real customer on your production URL can enter a real credit card, Stripe charges them for real, your Supabase database records the subscription, and your webhook handler stays in sync with reality. Contactly becomes a revenue-generating product.

Three concrete tasks:

1. Register a **production** webhook endpoint with Stripe, pointing at your production Vercel URL.
2. Copy the new **live-mode** API keys and webhook signing secret into Vercel's environment variables.
3. Verify end-to-end that a card payment on production updates Supabase correctly.

## Prerequisites

- Lesson 12.4 completed — the GitHub Actions workflow deploys to Vercel automatically on push to main.
- Production Vercel URL working (e.g., `https://contactly-xyz.vercel.app` or a custom domain).
- Stripe account created (from module 7) with test-mode keys in use locally.
- Stripe account business profile filled out — legal entity name, address, bank account for payouts. Without this, Stripe activates the account in **test mode only**; live-mode keys are inaccessible until activation.

## What You'll Do

- Activate your Stripe account for live payments (if you haven't already).
- Create a production webhook endpoint in the Stripe Dashboard.
- Select the exact 6 events Contactly needs to receive.
- Retrieve the production webhook signing secret.
- Switch Vercel's Stripe-related env vars from test to live.
- Verify a live-mode test payment updates Supabase.

---

## Step 1: Activate Your Stripe Account

You can't use live-mode keys until Stripe activates your account. Until activation, the dashboard has a persistent "Activate your account" banner and every live-mode feature is blocked.

Click the banner (or navigate to **Settings** → **Business** → **Activate account**). You'll fill out:

- **Business details:** legal entity name (your LLC, sole proprietorship, or individual), business type, tax ID (EIN, SSN, or equivalent), business address.
- **Product description:** what Contactly does. Be specific: "CRM for contact management; subscription pricing with monthly and annual plans." Stripe's risk team reviews this.
- **Representative details:** your name, date of birth, home address, last four of SSN (US) or equivalent.
- **Bank account:** where payouts go. Routing number + account number, or a Plaid linkage.

Stripe's review is fast for simple businesses — often instant, sometimes a few hours. They may request additional documentation (incorporation papers, ID photos). Don't panic if they do; respond promptly and activation usually completes within 1-2 business days.

Once activated, the dashboard has a **View test data** toggle (top-right, on most pages). That toggle flips the entire dashboard between test mode and live mode. Everything — webhooks, API keys, customers, subscriptions, events — is independent between the two modes.

**Double-check the toggle's position when working in the dashboard.** Creating a webhook in test mode when you meant live mode is a common mistake; the webhook exists, you copy the signing secret, but events never fire in production because production is in live mode. Always verify "Test mode off" before creating production resources.

---

## Step 2: Navigate to the Webhooks Page

Flip to live mode (toggle "Viewing test data" to off). Then go to **Developers** → **Webhooks**.

You'll see a clean page — no webhooks configured yet in live mode. Your test-mode webhook (pointing at something like `https://xyz.ngrok.io/api/webhooks/stripe` from module 7) exists only in test mode and doesn't carry over.

Click **+ Add endpoint**.

---

## Step 3: Configure the Production Endpoint

The **Add endpoint** form has three sections.

### Endpoint URL

Paste your production webhook URL:

```
https://your-app.vercel.app/api/webhooks/stripe
```

Replace `your-app.vercel.app` with your actual Vercel URL from lesson 12.3 (or a custom domain if you've already set one up). The path `/api/webhooks/stripe` is the SvelteKit `+server.ts` route you built in module 7 — it must match exactly.

Stripe sends a POST request to this URL whenever a relevant event happens. Your handler verifies the signature, decodes the event, and updates Supabase. If the URL is wrong, events fire but your code never sees them, and the DB drifts from Stripe's reality.

Test the URL before clicking save: `curl https://your-app.vercel.app/api/webhooks/stripe` should return a response (probably a 400 or 405 — that's fine; we're just confirming the route exists. A 404 means the route doesn't exist and the webhook will silently fail).

### Description (optional)

Something like `Contactly Production Webhook`. Shows up in the dashboard list; useful when you have multiple endpoints.

### Listen to events

This is where you pick exactly which events Stripe sends you. Click **Select events**. A searchable list appears. We want these **six** events, and only these:

1. **`checkout.session.completed`** — fires when a Stripe Checkout session finishes successfully (the user entered a card and the first payment succeeded). Contactly uses this to create the `subscriptions` row and link it to the user's Supabase profile.
2. **`customer.subscription.created`** — fires when a subscription is created (redundant with #1 for Checkout flows, but used for programmatic subscription creation, which we don't do today but might in the future).
3. **`customer.subscription.updated`** — fires when a subscription changes plan (monthly → annual), pauses, resumes, or updates metadata. We listen to keep the DB's plan tier in sync.
4. **`customer.subscription.deleted`** — fires when a subscription fully cancels (at period end or immediately). Contactly flips the user's tier back to free and revokes premium features.
5. **`invoice.payment_succeeded`** — fires when a renewal charge goes through. We use this to bump the `current_period_end` timestamp and mark the subscription as "paid through X."
6. **`invoice.payment_failed`** — fires when a renewal fails (expired card, insufficient funds, dispute, etc.). We mark the subscription as past-due and trigger a dunning email flow.

Select exactly these six. Don't over-subscribe; every extra event type means more webhook deliveries, more code paths to maintain, and more surface area for bugs.

Why not subscribe to "all events"? Because:

1. Stripe retries failed webhooks; more events = more retries = more noise.
2. New event types get added over time; the list bloats.
3. Your handler becomes a giant switch on every possible event.

Subscribe narrowly. Add more as needs arise.

### API version

Scroll down in the form. Set the **API version** to `2026-03-25.dahlia`.

This is load-bearing. Stripe releases a new API version every few months; each version can change event payload shapes subtly. Your code is written against `2026-03-25.dahlia` (check your `stripe` SDK initialization — you should see `apiVersion: '2026-03-25.dahlia'`). If the webhook endpoint is pinned to a different version, the events you receive won't match what your code expects — fields differ, enum values differ, sometimes catastrophically.

**The version on the webhook endpoint and the version in your Stripe client must match.** Contactly uses `'2026-03-25.dahlia'` in the `new Stripe(key, { apiVersion: '2026-03-25.dahlia' })` call in `src/lib/server/stripe.ts`. Set the webhook endpoint to the same.

### Save

Click **Add endpoint**. The webhook is live.

---

## Step 4: Grab the Webhook Signing Secret

Click your newly-created endpoint. On the detail page, find **Signing secret**. It's hidden behind a **Reveal** button; click it.

A long string appears, starting with `whsec_`. This is the value Contactly's webhook handler uses to verify that incoming POST requests actually came from Stripe (and not from an attacker spoofing Stripe's URL).

Copy it. Save it to your password manager under "Contactly Stripe Webhook Signing Secret (prod)".

This secret is **never reused**. Every webhook endpoint gets its own. If you rotate it (via **Roll secret**), Stripe invalidates the old one immediately. Keep this one safe.

---

## Step 5: Get Live-Mode API Keys

Still in live mode, go to **Developers** → **API keys**.

Two keys:

### Publishable key (`pk_live_...`)

Shown in plaintext. Safe to expose publicly — it identifies your Stripe account to the client but can only do limited operations (mostly creating tokens for card input). This is what `PUBLIC_STRIPE_PUBLISHABLE_KEY` gets set to.

### Secret key (`sk_live_...`)

Hidden. Click **Reveal live key token** (requires confirming with your Stripe password or 2FA — good). Copy it.

This is `STRIPE_SECRET_KEY`. With this key, any code can: charge cards, create customers, refund payments, read your entire transaction history. If this key leaks, an attacker can drain your Stripe balance through refunds, impersonate your business, and generally ruin your day.

**Stripe rotates restricted keys freely but the main secret key, once revealed, stays constant unless you manually roll it.** You can restrict which operations a key can perform by using **Restricted keys** (Developers → Restricted keys → + Create restricted key). For production, create a restricted key that can only do what Contactly actually needs: `read/write` on `charges, customers, subscriptions, invoices, checkout.sessions, webhooks`, and `none` on everything else. If the key leaks, the blast radius is reduced.

For this lesson, use the main secret key. Then as you mature, switch to a restricted key.

---

## Step 6: Update Vercel Environment Variables

Go to your Vercel project → **Settings** → **Environment Variables**.

Three variables to update — edit (don't add new) each one and change the **Production** value only:

### `STRIPE_SECRET_KEY`

- Production: `sk_live_...` (just grabbed)
- Preview: leave as `sk_test_...` (so PR previews don't charge real cards)
- Development: leave as `sk_test_...`

### `PUBLIC_STRIPE_PUBLISHABLE_KEY`

- Production: `pk_live_...` (just grabbed)
- Preview: `pk_test_...`
- Development: `pk_test_...`

### `STRIPE_WEBHOOK_SECRET`

- Production: `whsec_...` (from step 4 — the production webhook secret)
- Preview: leave as the test-mode webhook secret
- Development: leave as the test-mode webhook secret (or your local Stripe CLI webhook secret)

Save each. Verify by toggling the "Show value" button after save — Vercel keeps the value accessible after save (unlike GitHub secrets).

### Why each environment gets its own key pair

Three environments, three independent Stripe contexts:

- **Production** uses live keys — real cards, real money, real customers.
- **Preview** (Vercel preview URLs for PRs) uses test keys — reviewers testing flows with `4242 4242 4242 4242` don't generate charges.
- **Development** (Vercel development deploys, rarely used) uses test keys.

Mixing these is a category of bug that bites every few months for teams who don't segregate strictly. A PR that accidentally reads `STRIPE_SECRET_KEY` as production-only (instead of being present in all three envs) will crash preview builds. A PR that uses live keys in preview creates real charges on reviewers' cards.

---

## Step 7: Redeploy

Vercel only picks up new env vars on the next build. Trigger a redeploy:

- **Option A:** push a trivial commit (`echo "" >> README.md && git commit -am "bump" && git push`). The CI/CD pipeline from lesson 12.4 runs, deploys with the new env vars.
- **Option B:** in Vercel's Deployments tab, click the latest deploy → **⋯** → **Redeploy**. Uses the existing build artifacts; picks up new env vars. Faster than Option A.

Either works. After redeploy, production is running against live Stripe.

---

## Step 8: Verify End-to-End

You're live. Don't trust — verify. Do **one real transaction** to confirm the entire loop works.

Use a real card (your own). Go to your production URL, register a test account, navigate to billing, upgrade to a paid plan. Stripe Checkout opens; enter your real card details; complete the purchase. You'll see:

1. Vercel function logs (**Deployments** → latest → **Functions** → `/api/webhooks/stripe`) showing a POST received from Stripe and the handler running successfully.
2. A new row in your production Supabase `subscriptions` table with `status: 'active'` and the right plan tier.
3. Your Stripe Dashboard's **Payments** tab showing a real charge.

If any of those three are missing, **stop and diagnose before taking down the endpoint**. Common causes:

- Webhook signature verification failed — usually because `STRIPE_WEBHOOK_SECRET` was set to the test webhook's secret, not the live one. Fix and redeploy.
- Wrong API version pinned — fields in the event don't match code expectations. Align the dashboard webhook version to `'2026-03-25.dahlia'`.
- Supabase write fails (RLS, constraint error) — check the function logs for the specific error. Fix the code or migration, redeploy.

After confirming the flow works, **refund yourself** from the Stripe Dashboard. You've verified the full loop with a single real transaction; there's no reason to pay yourself permanently.

Congratulations. Contactly is a real paid product.

---

## Common Mistakes

- **Forgot to switch to live mode in the Stripe dashboard.** You create a webhook thinking it's production, but the dashboard is still in test mode. The webhook only fires for test-mode events; production events go to `/dev/null`. Verify the "Viewing test data" toggle is **off** before creating any production resource.
- **API version mismatch.** Webhook version is `2024-06-20` but code uses `'2026-03-25.dahlia'`. Events fire, but specific fields your code expects are missing or renamed. Symptoms: handler runs, throws a type error, returns 500, Stripe retries indefinitely. Fix: align both.
- **Subscribed to too many events.** You selected "All events" in the Stripe dashboard. Now you receive `charge.refunded`, `customer.updated`, `payment_intent.created`, etc. Your handler has a switch that defaults to "ignore." That's fine behavior — but you're processing 10x more webhooks than needed, and cluttering your logs. Subscribe narrowly.
- **Hardcoded webhook URL in Stripe.** You set the endpoint URL to your **old** Vercel URL from lesson 12.3 (`https://contactly-xyz.vercel.app`), then set up a custom domain (`https://contactly.app`). Stripe still sends to the old URL, which might still work (Vercel preserves old URLs) — but when you eventually delete the old deployment, the webhook breaks silently. Update the Stripe endpoint URL whenever you change domains.
- **Ran test-mode keys in production.** You forgot to update one of the three variables (say, `PUBLIC_STRIPE_PUBLISHABLE_KEY` is still `pk_test_...`). Customers enter their cards but the Stripe Checkout session is created in test mode; no real charge happens; the webhook doesn't fire; your DB is broken. Triple-check each variable has the right value for each scope.

---

## Principal Engineer Notes

### Webhook versioning is infrastructure, not config

The Stripe API version pinned on your webhook endpoint is a piece of infrastructure. Think of it like the schema version of a contract between two services. Upgrading it is a coordinated release, not a click.

The correct upgrade flow:

1. Add support for the **new** version in your handler code (defensively handle both old and new payload shapes).
2. Deploy the updated code to production.
3. In the Stripe dashboard, upgrade the webhook endpoint's API version.
4. Monitor for a week; confirm nothing broke.
5. Remove the old-version compatibility code.

Skipping step 1 — flipping the version on the webhook before deploying code that handles the new format — means every webhook event in between fails. Stripe retries for 3 days, then gives up. By then, your DB has drifted from reality and reconciling is painful.

### Webhook log retention

Stripe keeps webhook delivery logs for **30 days**. In the Webhooks → endpoint detail page, you can see every event Stripe tried to deliver, with response codes and retry attempts. This log is gold when debugging "my subscription state looks wrong" — check the webhook log, see whether Stripe successfully delivered, see what your handler returned.

After 30 days the logs disappear. For more permanent records:

- **Log incoming webhooks to your database** with request timestamp, event ID, signature verification result, handler result, response code. Queryable forever.
- **Ship webhook events to a log aggregator** (Logflare, Datadog, Axiom). Full-text search across months of history.

For Contactly today, Stripe's 30-day view is sufficient. When you have 100 paying customers, start logging.

### Restricted keys everywhere

We mentioned restricted keys briefly. The principle: your main `sk_live_...` key can do everything, including things Contactly never does (issue refunds from API, create products, delete customers). Creating a restricted key that can only do what the app actually needs is a compensating control against token theft.

Set up three restricted keys:

- **App runtime key** — read/write on `customers, subscriptions, checkout.sessions, invoices`. Everything else: none.
- **Webhook verification key** — read-only on `events`. Nothing else.
- **Admin scripts key** — read-write on `customers, subscriptions, refunds`. Kept in a password manager, not environment variables. Used only when manually fixing something.

If your app runtime key leaks (say, a developer accidentally commits `.env.production` to a public repo), the attacker can't exfiltrate your whole Stripe history — just enumerate customers. Still bad, but vastly better than losing the main key.

### Idempotency keys

Every write to Stripe should include an idempotency key — a unique identifier for the operation. If you retry the same operation (same key), Stripe returns the cached result instead of performing the action again. Critical for retry-heavy flows like webhook handlers that need to create subscriptions.

Contactly's webhook handler should look something like:

```typescript
await stripe.subscriptions.create({ ... }, {
  idempotencyKey: event.id
})
```

The event ID is unique per event. If Stripe retries the webhook (our handler timed out, returned 500, etc.), our second attempt uses the same idempotency key, and Stripe returns the already-created subscription instead of making a duplicate. No duplicate charges, no duplicate DB rows.

### Business-activation checklist before going live publicly

Going live is more than flipping keys. Your business-activation checklist:

- **Terms of Service and Privacy Policy** live on your site. Stripe requires both for most verticals; some require additional disclosures (Age verification for adult content, financial disclosures for subscription services).
- **Refund policy** documented. Stripe's dispute rate matters: too many disputes and you get flagged, your payout schedule lengthens, eventually your account can be terminated. A generous refund policy keeps disputes low.
- **Customer support channel.** An email that gets answered within 24 hours. Stripe requires a visible customer service contact on your checkout page.
- **Tax registration.** In most jurisdictions, selling a subscription requires registering for sales tax (US) or VAT (EU). Stripe Tax handles this for you once enabled; the manual alternative is nightmarish.
- **Dunning emails.** When `invoice.payment_failed` fires, your webhook should trigger an email to the customer asking them to update their card. Without dunning, payment failures silently turn into cancellations.
- **Monitoring of webhook delivery.** Alert on webhook failure rate > 1%. Silent webhook failures are how subscription state silently drifts.

These are pre-launch hygiene. Skip them at your peril.

### PCI compliance (no, you don't need to read the 500-page doc)

Using Stripe Checkout means your servers **never see** raw card numbers. Cards go from the user's browser directly to Stripe; you receive a token. This exempts you from most of PCI DSS compliance — you qualify for **SAQ-A**, the simplest self-assessment questionnaire, which takes about an hour to complete annually.

If you ever build your own card input with Stripe Elements (embedding Stripe's fields in your own form), you're still SAQ-A as long as the Stripe iframe handles the card number. Move to SAQ-D (the full audit) only if you store or transmit raw card data — which you should basically never do. Don't.

---

## What's Next

One lesson left in this module. You've got: production database, production app, production payments, automated deploys. The last thing that's still broken is all the URLs in your code that reference `localhost:5173` or the initial Vercel preview URL — they need to point at your final production domain. Lesson 12.6 walks through updating `PUBLIC_APP_URL`, Supabase Auth redirect allowlist, and Stripe success/cancel URLs so the end-to-end flow — including email magic links, OAuth callbacks, and Stripe redirects — works from the customer's perspective.
