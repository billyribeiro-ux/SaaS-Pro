---
title: '5.1 - Stripe Dashboard Overview'
module: 5
lesson: 1
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '01-stripe-dashboard-overview'
description: 'Navigate the Stripe dashboard and understand test mode vs live mode before writing any code.'
duration: 10
preview: true
---

## Overview

Before Contactly charges a single dollar, we need a place to configure what we're selling, who we've sold it to, and what's happening to every payment in real time. That place is the **Stripe dashboard** — a web console at [dashboard.stripe.com](https://dashboard.stripe.com). This lesson is a guided tour. No code yet, no integration yet. Just the map.

Why a whole lesson on a web UI? Because almost every billing bug you'll ever chase gets diagnosed in the dashboard before it gets fixed in code. Engineers who know their way around Stripe ship payment features in hours; engineers who don't lose days chasing phantoms. Ten minutes here pays for itself many times over across Modules 5–8.

Along the way we'll also cover the single most important piece of billing hygiene: **test mode vs live mode**. Mixing them up is how you end up emailing Patrick Collison to beg for a refund. It will not happen to you.

## Prerequisites

- A web browser.
- An email address you control.
- That's it — no code, no terminal, no Supabase running. This lesson is pure setup.

## What You'll Build

- A working Stripe account (or access to an existing one).
- A mental model of Stripe's five dashboard sections you'll touch constantly: Payments, Customers, Products, Subscriptions, and Developers.
- A confident understanding of the test mode / live mode toggle and why mistaking one for the other is catastrophic.
- Located API keys (publishable and secret) and internalized which goes where.

---

## Step 1: Create (or Log Into) Your Stripe Account

Navigate to [stripe.com](https://stripe.com) and click **Start now** (or **Sign in** if you already have an account). Signing up asks for:

- Your email address
- A password
- Your country (this matters later — it determines what currencies you can charge and what payout destinations are supported)

You don't need a business name, a bank account, or a tax ID to start. Those are required only before you accept real money — that's the difference between test mode and live mode, which we're about to explore.

Confirm your email by clicking the link in the welcome email, and log in. You'll land on your **dashboard home**.

### A note on Stripe accounts

A Stripe account is free. There's no monthly fee, no subscription — Stripe makes money only when you make money (a per-transaction fee, typically 2.9% + $0.30 in the US). There is zero downside to creating an account early.

You can have multiple Stripe accounts tied to one login (e.g., one per business) and switch between them in the dashboard. For this course, one account is all you need. If you already use Stripe for other work, feel free to reuse that account — **test mode is completely isolated from live mode**, which is the next section's headline.

---

## Step 2: The Test Mode / Live Mode Toggle

Look at the top of the dashboard sidebar. You'll see a toggle — usually a small switch or pill labeled **Test mode** (orange) or **Live mode** (black/neutral). On a brand-new account, you default to **Test mode**, and there's a prominent orange banner across the top that reads **TEST DATA**.

This toggle is the most important UI element in the entire dashboard. Here's what it actually does:

### Test mode is a parallel universe

When you toggle to test mode, Stripe gives you a **completely separate environment**:

- Separate API keys (they start with `pk_test_` and `sk_test_`).
- Separate products, customers, subscriptions, invoices, webhooks, event logs — everything.
- Separate payments that use fake card numbers (like `4242 4242 4242 4242`) and never actually move money.
- Separate balances, separate payout schedules, separate statement descriptors.

If you create a customer in test mode, that customer does not exist in live mode. If you charge a card in test mode, no real money moves, no email is sent (unless you configure test-mode emails), and your fake customer is never unhappy.

### Live mode is the real world

When you toggle to live mode, Stripe gives you the real thing:

- API keys that start with `pk_live_` and `sk_live_`.
- Real customers, real cards, real dollars.
- Every API call you make has consequences — a charge in live mode actually pulls money from a real card and deposits it (minus fees) into your real bank account.

You can't enable live mode without finishing **account activation** — that's Stripe asking for your legal business name, tax ID (EIN in the US, equivalent elsewhere), address, and a bank account to pay out to. This is a friction-on-purpose: Stripe makes sure you can't accept real money until you've proven who you are.

For the whole course up through deployment, **we work exclusively in test mode**. We won't activate the account until Module 17, when we deploy Contactly to production.

### Why the separation matters

Imagine if test mode and live mode shared data. You'd:

- Accidentally charge real customers with the fake card `4242 4242 4242 4242` during development (you wouldn't, but the concern would slow you down).
- Mix test customers and real customers in your reports.
- Risk exposing customer emails to test webhooks while debugging.

By making test and live two universes, Stripe lets you experiment without consequences — build, break, reset, try again — without touching anything real. Treat this separation as sacred.

### The orange TEST DATA banner

When you're in test mode, Stripe shows a persistent, unmissable orange banner across the top of every page. It reads **TEST DATA** (or sometimes **You are viewing test data**). The banner is deliberately jarring. Its purpose is to keep you from forgetting which mode you're in.

A common senior-engineer mistake: you're deep in a debugging session in test mode, you get paged about a live issue, you click "Customers" expecting to see the real customer who is complaining — and the list is empty, and you wonder if your database is corrupted. It isn't. You're looking at the test environment. Check for the orange banner. If it's there, flip the toggle.

---

## Step 3: The Five Dashboard Sections You'll Use Constantly

The dashboard has many sections, but 90% of your time lives in five of them. Here they are, in the order you'll touch them as you build Contactly.

### Payments

**Payments** (left sidebar) shows every one-time charge and invoice attempt. Each row has:

- The amount and currency.
- The payment status: `Succeeded`, `Refunded`, `Failed`, `Disputed`, `Incomplete`.
- The customer (if attached).
- A timestamp.

Click any payment to see the full **Payment Intent** — a JSON-shaped record of everything that happened: which card was used (last 4 digits only), the risk score, the receipt URL, any disputes, any refunds, any webhook events triggered by it.

For Contactly, most payments will come through **Subscriptions**, but each recurring charge shows up as a line in Payments too.

### Customers

**Customers** shows every person or company that has given you payment information. Each customer has:

- An email (usually the one they entered at checkout).
- A `cus_xxxxx` ID (Stripe's internal handle — you'll reference this in code constantly).
- A list of saved payment methods.
- A list of subscriptions.
- A list of invoices.
- Metadata — a free-form JSON blob where you can stash your own app's IDs (e.g., the profile UUID).

When Contactly's webhook fires for `customer.subscription.updated`, the payload contains the `cus_xxxxx`. We translate that to a `profiles.id` via the `profiles.stripe_customer_id` column we'll add in Module 6. This is how Stripe events become Supabase row changes.

### Products

**Products** shows the catalog of things you sell. Every product is a reusable object with a name, description, images, and metadata. Products don't have prices — **prices are separate objects** tied to a product. (We'll explore this odd-but-correct design in Lesson 5.4.)

For Contactly, we'll create **one product** (`Contactly Pro`) with **three prices** (monthly, yearly, lifetime).

### Subscriptions

**Subscriptions** shows every recurring billing relationship. Each subscription has:

- A customer.
- A price (which tier the customer is on).
- A status: `active`, `past_due`, `canceled`, `trialing`, `incomplete`, `unpaid`.
- A current-period start and end.
- An upcoming invoice.

Subscriptions are the heart of Contactly's monetization. Every user on a monthly or yearly plan has a Stripe Subscription object — when they cancel, it moves to `canceled`; when their card fails, it moves to `past_due`; when we sync Supabase from webhook events, we mirror this status to `profiles.subscription_status` and use it to gate features.

### Developers

**Developers** is where engineers live. It has four key sub-sections:

- **API keys** — your publishable and secret keys, both for test mode and (once activated) live mode.
- **Webhooks** — endpoints Stripe calls to notify your app of events. Test-mode webhooks are typically pointed at the Stripe CLI's tunneled localhost; live-mode webhooks point at your production domain.
- **Events** — a real-time log of every event Stripe has generated (subscription created, invoice paid, charge succeeded, etc.). You can filter, replay, and inspect each one. This is your best friend when debugging webhook flows.
- **Logs** — every API request made against your account, with full request and response bodies. When your code calls Stripe and something breaks, the log has the exact HTTP round-trip.

We'll park in **Developers** a lot during Modules 5–8. Bookmark it.

---

## Step 4: Finding the API Keys

Navigate to **Developers → API keys** in the sidebar. Make sure you're in **test mode** (orange banner visible).

You'll see two keys:

- **Publishable key** — starts with `pk_test_` (e.g., `pk_test_51Nv7k8KZ...`).
- **Secret key** — starts with `sk_test_`, but most of it is hidden by default (`sk_test_••••••••••`). Click **Reveal live key** (or **Reveal test key**) to see the full value, and copy it with the clipboard icon.

### What each key does

These two keys look similar but serve fundamentally different roles.

#### The publishable key (`pk_test_...`)

- **Safe to include in client-side code.** It's designed to be visible. You can put it in your HTML, in your JavaScript bundle, in a browser extension, on a billboard — it doesn't matter. Stripe assumes the whole world sees it.
- **Can only do "creation-of-intent" work** — e.g., create a checkout session reference, tokenize a card in Stripe.js, initialize the Elements library. It **cannot** charge a card, retrieve customer data, or create subscriptions by itself.
- **Its purpose is to let the browser talk to Stripe directly** — so you don't have to route raw card numbers through your server (which would mean PCI-DSS scope for you, not fun).

In SvelteKit, we'll expose it as `PUBLIC_STRIPE_PUBLISHABLE_KEY` (the `PUBLIC_` prefix tells SvelteKit it's safe to ship in the client bundle).

#### The secret key (`sk_test_...`)

- **Never leaves your server. Ever.** Not in environment variables shipped to the browser. Not in logs. Not in error messages. Not in screenshots on Slack.
- **Can do anything.** Charge a customer, create a customer, refund, delete, inspect — the secret key is root access to your Stripe account.
- **Leaked secret key = compromised Stripe account.** An attacker with your `sk_live_` can drain your balance (well, try to — Stripe has fraud detection) and scrape your entire customer list.

In SvelteKit, we'll expose it as `STRIPE_SECRET_KEY` (no `PUBLIC_` prefix — it's server-only and will error if you try to import it from browser code).

### The test keys vs live keys distinction

Each environment has its own pair:

| Environment | Publishable   | Secret        |
| ----------- | ------------- | ------------- |
| Test mode   | `pk_test_...` | `sk_test_...` |
| Live mode   | `pk_live_...` | `sk_live_...` |

Test keys only work against test mode. Live keys only work against live mode. You cannot mix them — Stripe will reject a request that uses a test key and asks for a live resource, and vice versa.

This has one failure mode worth internalizing: **never put `sk_live_` in your development `.env`**. If you do, you're one accidental `pnpm dev` test away from charging yourself real money. The separation is the safety net. Respect it.

---

## Step 5: A Quick Tour in Your Browser

Click through, actually. The best way to learn this dashboard is to poke it.

1. **Home** — empty stats for now. Will fill in as we build.
2. **Payments** — empty. No charges yet.
3. **Customers** — empty.
4. **Products** — empty. We'll fill it in Lesson 5.5.
5. **Subscriptions** — empty.
6. **Developers → API keys** — confirm you can see your `pk_test_` and reveal your `sk_test_`. Don't copy them anywhere yet; we'll wire them into `.env` in Lesson 5.7.
7. **Developers → Webhooks** — empty. We'll add one in Module 6 via the CLI.
8. **Developers → Events** — empty (no events yet).
9. **Developers → Logs** — empty (no API calls yet).
10. **Settings → Account details** — confirm your country and time zone. Test mode uses this to default currency (USD for US-based accounts, etc.). If your country is wrong, fix it now; changing it later is a headache.

Toggle to **Live mode** and back to **Test mode** a couple of times. Notice the orange banner appearing and disappearing. Build the muscle memory: orange = test, no-orange = real money.

---

## Common Mistakes

### Mistake 1: Working in live mode by accident

You open Stripe, you glance at the dashboard, you see data — "oh, my test customers." But the data is from live mode (because the toggle was flipped last session). You create a price called "Testing $1" thinking you're in test mode. That price is now in your live catalog. If someone later buys from your live checkout and picks it, they're charged $1 for real.

**Defense:** every time you open the dashboard, check for the orange banner. Make it a reflex.

### Mistake 2: Copying the secret key into client code

You're in a rush. You paste `sk_test_...` into your frontend `.env` as `PUBLIC_STRIPE_SECRET_KEY`. You push the code. SvelteKit embeds it in the JavaScript bundle. Every visitor to your site now has your secret key.

If this were `sk_test_`, it's still embarrassing but not dangerous (test mode is isolated). If it were `sk_live_`, you'd be rotating keys and explaining to users why you paused billing.

**Defense:** never prefix secret keys with `PUBLIC_`. SvelteKit's env splitting enforces this — import `STRIPE_SECRET_KEY` from `$env/static/private` (server-only), import `PUBLIC_STRIPE_PUBLISHABLE_KEY` from `$env/static/public` (client-visible).

### Mistake 3: Commiting `.env` to git

You put the real secret key in `.env`, and `.env` isn't in `.gitignore`. You commit. You push to GitHub. Your secret key is now in the public git history forever (even after you delete it — `git log` preserves it, and services like truffleHog scan public repos for patterns like `sk_live_`).

**Defense:** `.gitignore` must include `.env` (and `.env.local`, `.env.*.local`). Use `.env.example` to document the expected variable names with empty or fake values. We'll set this up in Lesson 5.7.

### Mistake 4: Assuming the test and live environments sync

You create a product in test mode named "Contactly Pro." You expect to see it in live mode. You won't. Products (and prices, customers, webhooks, everything) are per-environment.

**Defense:** when you activate live mode before launch (Module 17), you recreate the products. That's by design — you get to sanity-check your catalog before the first real customer sees it. Stripe also has an **import from test mode** tool that helps.

### Mistake 5: Thinking you need to "turn on" test mode

Test mode is always on. You don't activate it. You don't verify anything. A fresh Stripe account starts in test mode by default and stays there until you activate live mode by submitting your business details.

If the dashboard asks you to "complete your account," it's nudging you toward live mode. Ignore it unless you're ready to accept real money.

---

## Principal Engineer Notes

### Blast radius of a leaked secret key

A leaked `sk_live_` gives an attacker **your full Stripe account**. They can:

- List every customer you've ever had, including their emails.
- Refund every successful payment (costing you money and breaking customer trust).
- Create fraudulent charges against any saved payment method on file.
- Delete subscriptions, cancelling every customer's service.
- Exfiltrate every invoice you've ever generated.

Stripe has mitigations — unusual API patterns trigger alerts, there's rate limiting, and recent changes require reauthentication for destructive ops — but you cannot rely on the mitigations. Treat the secret key like the password to your company bank account. Because it is.

**Practical consequence:** never paste a secret key into Slack, a code review comment, a Google Doc, a ChatGPT prompt, a support ticket, or an email. The correct channels are (a) your deployment environment's encrypted env-var store and (b) your password manager's encrypted notes.

### Key rotation hygiene

Stripe lets you rotate your secret key at any time. Go to **Developers → API keys → Roll key**. The old key is invalidated after a configurable delay (default: immediately, but you can set a 12-hour grace period for rolling deploys).

You should rotate proactively in at least three scenarios:

1. **An employee with access leaves the company.** Their copy of the key goes with them. Rotate on their last day.
2. **You suspect a leak.** A weird charge, an unfamiliar IP in the API logs, a key accidentally committed then deleted. Rotate first, investigate after.
3. **Periodic hygiene.** Some companies rotate every 90 days as a matter of policy. The goal isn't to "refresh randomness" — the key doesn't expire — but to make sure any stale copy (old laptop, forgotten staging env) breaks and gets noticed.

Rotation is painless when you've structured your infra correctly (the key lives in one place — your env-var store — and everything reads from there). It's miserable when you've hardcoded it or duplicated it. Don't duplicate.

### Restricted API keys — the lesser-known best practice

For automated systems that only need a slice of Stripe's API (e.g., a Slack bot that reads yesterday's revenue), create a **restricted API key** instead of sharing `sk_live_`. Go to **Developers → API keys → Create restricted key**. You can scope it to:

- Specific resources (e.g., "Read access to Charges only").
- Specific actions (e.g., "Create Refunds, no Read, no Delete").

A restricted key with read-only scope is **safe to log accidentally** — it can't do any damage. Our Contactly server will use the full secret key because it does actual payment work, but for reporting/analytics tools, restricted keys are strictly better.

Mental model: restricted keys are to your secret key what sudo-scoped users are to root. Use least privilege by default.

### Observability through the dashboard

The dashboard isn't just a configuration tool; it's your production observability layer for billing. **Developers → Logs** gives you every API request with full bodies. **Developers → Events** gives you every state transition with replay capability. When a customer says "you double-charged me," you search their customer ID in the dashboard and reconstruct the exact sequence of events within minutes.

Compare this to "I built a payment system from scratch" — where you'd have to instrument everything yourself, set up log aggregation, write replay tooling, build dashboards. Stripe gave you that for free. Use it.

### The dashboard is a sharp tool for humans, too

Stripe's dashboard lets humans (support, ops, refunds team) do 90% of operational work without touching code: issue a refund, cancel a subscription, retry a failed invoice, mark a dispute. When you ship Contactly, you don't need a "Cancel Subscription" admin panel on day one — your human support flow is "log into Stripe, cancel the subscription, the webhook propagates to your app." Build the admin panel when the volume demands it, not before.

---

## Summary

- Created (or opened) a Stripe account. No business details required yet — test mode is free and immediate.
- Learned that **test mode and live mode are two parallel universes** — separate data, separate keys, separate everything. The orange **TEST DATA** banner tells you which one you're in.
- Mapped the five dashboard sections you'll use constantly: Payments, Customers, Products, Subscriptions, and Developers.
- Located your **publishable key** (`pk_test_...`, safe client-side) and **secret key** (`sk_test_...`, server-only).
- Internalized the rules: publishable keys can be public, secret keys cannot leave your server, and mixing test and live keys will bite you.
- Understood the blast radius of a leaked secret key, the value of key rotation, and the power of restricted API keys for scoped automation.

## What's Next

In Lesson 5.2 we'll tour **docs.stripe.com** — the API reference, the guides, the SDK docs — and learn how to read Stripe's response shapes. A central concept introduced there is **API versioning**: Stripe pins every account to a version, and we'll be locked to `2026-03-25.dahlia` for the whole course. Understanding why that pin matters is the difference between upgrades that take five minutes and upgrades that take five days.
