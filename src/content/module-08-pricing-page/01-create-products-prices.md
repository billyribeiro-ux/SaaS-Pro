---
title: '8.1 - Create Products & Prices'
module: 8
lesson: 1
moduleSlug: 'module-08-pricing-page'
lessonSlug: '01-create-products-prices'
description: 'Create the Contactly Pro product and its three pricing tiers in Stripe test mode.'
duration: 12
preview: false
---

## Overview

This module is where Contactly stops being free. By the end of Module 8 the marketing site will have a real pricing page at `/pricing` with three tiers — Monthly, Yearly, and Lifetime — each showing a live price pulled straight from your Stripe account.

Before we can build that page, Stripe needs to know what we're selling. This lesson sets up Stripe's **Product** and **Price** records through the dashboard. It's the least code-heavy lesson in the module, but one of the most important: every checkout link, every receipt, every invoice, every webhook later in the course keys off the Product and Price IDs you create right now.

You will create **one Product** (the thing: Contactly Pro) and **three Prices** (the options: $97/month, $997/year, $4997 once). You'll assign **lookup keys** to each Price so our SvelteKit code can fetch them by stable name rather than by brittle auto-generated IDs. Then you'll verify everything in the Stripe dashboard before we move on to scripting this setup in lesson 8.2.

## Prerequisites

- You have a Stripe account and you're in **test mode** (the dashboard shows an orange "TEST MODE" banner). If you're not sure, switch modes using the toggle in the top-right.
- Your local Contactly app runs at `http://localhost:5173` (not strictly required for this lesson, but you'll want it alive for lesson 8.4).
- You've installed `stripe` v22 in the project and your `.env` contains `STRIPE_SECRET_KEY=sk_test_...` and `STRIPE_PUBLISHABLE_KEY=pk_test_...` (from Module 5 or 6).

> [!NOTE]
> **Course reading paths — why this lesson exists.** The SaaS-Pro curriculum is designed to be read linearly (modules 1 → 14) but also to stand alone in "jump to pricing" mode for developers who already have a Stripe-integrated SvelteKit app and just want the public-facing pricing page. That second audience hasn't done Module 5, so we re-cover the product/price setup here. If you did Module 5 and already created Contactly Pro with the three prices and the correct lookup keys, you can skim this lesson, verify the lookup keys match what lesson 8.3 expects, and jump to 8.2. If you're seeing the dashboard for the first time, follow every click.

## What You'll Build

- One Stripe **Product** in test mode named `Contactly Pro` with a short description.
- Three **Price** records attached to that product: a $97 monthly recurring, a $997 yearly recurring, and a $4997 one-time lifetime payment.
- Three stable **lookup keys** — `contactly_monthly`, `contactly_yearly`, `contactly_lifetime` — that our SvelteKit server code will use to fetch prices by name.
- A verified, screenshotted setup in the Stripe dashboard that exactly matches what the rest of this module expects.

---

## Step 1: Products vs Prices vs Plans — the Stripe data model

Before clicking anything, it's worth ten seconds on Stripe's data model, because a lot of Stripe confusion comes from mixing up these three concepts.

- A **Product** is the _thing_ you sell. One product per offering. If you eventually sold "Contactly Pro" and "Contactly Team", those would be two products. Today we have exactly one: Contactly Pro. A product has a name, a description, maybe an image, and a set of prices.
- A **Price** is a _way to pay for_ that product. Every recurring interval or amount is its own Price. Monthly billing? One Price. Yearly billing? Another Price. A one-time lifetime fee? Another Price. Same product, three Prices. This lets Stripe handle discounting, A/B testing, currency localisation, etc., without duplicating the product metadata.
- A **Plan** is a legacy term Stripe used before Prices existed. You'll still see it in old tutorials and in some Stripe API responses. Treat "Plan" as a synonym for a recurring Price. In new code we always say **Price**.

The relationship is one-to-many: one Product has many Prices. When a customer subscribes, they subscribe to **a Price** (not to a Product); the Product metadata is carried along for receipts and display.

Concretely for Contactly:

```
Product: "Contactly Pro"
├── Price: $97 / month recurring  → lookup_key: contactly_monthly
├── Price: $997 / year recurring  → lookup_key: contactly_yearly
└── Price: $4997 one-time        → lookup_key: contactly_lifetime
```

That's our target state. Let's build it.

---

## Step 2: Confirm you're in Test Mode

Open [dashboard.stripe.com](https://dashboard.stripe.com). In the top-right corner, you'll see a toggle labelled **Test mode**. Flip it on. You should see an orange banner across the top of every page saying `TEST MODE` and the navigation will look slightly different (fewer menu items, no "Payouts" for example).

> [!WARNING]
> **Check the banner every time.** Test mode and live mode are _completely separate_ environments — separate data, separate API keys, separate products. It is embarrassingly easy to create a product in live mode because you forgot to flip the switch. Every developer does it at least once. Check the banner before every click.

Our `.env` has a key that starts with `sk_test_...` — so the app is already wired to test mode. The products we create now will match those keys.

---

## Step 3: Create the Product

In the left sidebar, click **Product catalog** (sometimes shown as **Products**, depending on your dashboard version). You'll see an empty table with a call to action in the middle of the page. Click **+ Add product** (usually top-right).

Fill in these exact fields:

### Name

```
Contactly Pro
```

This is the human-readable product name. It appears on Stripe-hosted checkout pages, on receipts, on invoices, in the Customer Portal, and in Stripe's search. Use your real product name.

### Description

```
Full access to Contactly — unlimited contacts and all features.
```

Short, customer-facing, one sentence. It shows up on receipts and in the Customer Portal. Avoid internal jargon.

### Image (optional)

You can upload a square logo. It displays on Stripe Checkout above the price summary. If you don't have a logo yet, skip it — you can upload one later without recreating the product.

### Pricing

This is where the dashboard tries to do too much. You'll see a "Price" section below the product info with a single price form prefilled. **Don't create a price here yet.** We're going to create all three prices in dedicated Price forms after the product exists, because the one-off form does a less good job of exposing lookup keys.

On some dashboard versions you can't save the product without at least one price. If that's your situation, fill in the Monthly price here ($97, USD, recurring monthly) and we'll add the other two in Step 4. On other versions you can click **Add product** without a price and then go add prices. Either path works.

### Click **Add product**

You now have a Product with an ID that looks like `prod_Q7xYzAbC...`. You don't need to memorise this ID — our code never uses it directly. It fetches prices (and their parent product) via lookup keys.

---

## Step 4: Create the Monthly Price

If you skipped pricing in Step 3, click into the Contactly Pro product you just created and look for **+ Add price** or a **Pricing** section with an "Add another price" button.

Fill in the Monthly price:

### Price section

- **Pricing model:** `Standard pricing` (a flat amount per interval).
- **Price:** `97.00` in `USD` — Stripe shows a preview like `$97.00 / month` if you have recurring selected.
- **Billing period:** toggle or dropdown set to `Recurring`, then `Monthly` (every 1 month).
- **Usage is metered:** leave unchecked. We're selling a flat subscription, not per-seat or per-use.
- **Price description** (sometimes called nickname): `Monthly` — this is an internal label shown in the dashboard only, not to customers.

### Advanced / Lookup key

Click **Advanced options** (or "More options", depending on version) to expose the **lookup key** field. Enter:

```
contactly_monthly
```

> [!NOTE]
> **What is a lookup key?** A lookup key is a stable, developer-defined string attached to a Price. Stripe's auto-generated Price IDs (`price_1Q7xYz...`) are opaque and change between environments — the ID in your test account won't match the ID in your production account. Lookup keys _do_ match, because _you_ assign them. You can then query `stripe.prices.list({ lookup_keys: ['contactly_monthly'] })` and get the right Price in any environment. This is the pattern we'll use in lesson 8.4 to populate the pricing page. Without lookup keys you'd have to hardcode `price_1Q7xYz...` into your app and maintain separate constants per environment. Nobody has time for that.

### Click **Add price** (or **Save**)

Your Monthly price is live. Back on the product page you should see `$97.00 / month · contactly_monthly` in the prices table.

---

## Step 5: Create the Yearly Price

Still on the Contactly Pro product page, click **+ Add price** again.

- **Price:** `997.00` USD. That's $997, not $9.97 — Stripe accepts dollars-and-cents in the UI input and converts to cents (99700) under the hood.
- **Billing period:** `Recurring` → `Yearly` (every 12 months).
- **Price description:** `Yearly`.
- **Lookup key** (under Advanced options): `contactly_yearly`.

Click **Add price**.

> [!NOTE]
> **Why is yearly exactly $997 and not $970 or $1164?** `$97 × 12 = $1164`. We're charging `$997`, which is $167 less than paying monthly — roughly **14% off**, which matches the "Save 14% vs monthly" marketing copy you'll see in lesson 8.3's tier config. Another way to read it: the customer pays for 10 months and gets the 11th and 12th free. The exact figure is a product-pricing decision you'll tune later (Module 13 covers A/B testing pricing). For now, $997 is the number the rest of the module expects.

---

## Step 6: Create the Lifetime Price

One more click: **+ Add price**.

- **Price:** `4997.00` USD.
- **Billing period:** this is the important one — select `One time` (NOT recurring). A lifetime purchase is a single payment. There's no subscription, no renewal, no invoice cycle.
- **Price description:** `Lifetime`.
- **Lookup key:** `contactly_lifetime`.

Click **Add price**.

> [!NOTE]
> **One-time prices behave differently from recurring.** Under the hood, a one-time Price creates a PaymentIntent in checkout (not a Subscription). That means no `customer.subscription.*` webhooks, no Customer Portal entitlement management, no proration. In Module 10 we'll treat lifetime customers specially: they get unlimited access by virtue of `profiles.billing_mode = 'lifetime'` with no subscription row to look at. Tuck that away for now — it matters later.

---

## Step 7: Verify All Three Prices

Go back to the Contactly Pro product page. You should see a table like this:

| Price          | Billing           | Lookup key           |
| -------------- | ----------------- | -------------------- |
| $97.00 / month | Recurring monthly | `contactly_monthly`  |
| $997.00 / year | Recurring yearly  | `contactly_yearly`   |
| $4,997.00      | One time          | `contactly_lifetime` |

**Every row must have a lookup key.** If one is blank, click the price, edit it, and set the missing lookup key. Our SvelteKit code in lesson 8.4 will ask Stripe: "Give me the prices with these three lookup keys." If a price has no lookup key, it's invisible to our app.

### A quick API check (optional but recommended)

Open a terminal and run:

```bash
curl https://api.stripe.com/v1/prices \
  -u $STRIPE_SECRET_KEY: \
  -d "lookup_keys[]=contactly_monthly" \
  -d "lookup_keys[]=contactly_yearly" \
  -d "lookup_keys[]=contactly_lifetime" \
  -d "active=true"
```

You should get back a JSON response with a `data` array containing three items — one per price — each with a `unit_amount`, a `lookup_key`, and a `product` field. If you see fewer than three, a lookup key is missing or misspelled. Fix it in the dashboard before continuing.

> [!NOTE]
> **The `-u $STRIPE_SECRET_KEY:` (trailing colon) trick.** Stripe uses HTTP Basic auth where the secret key is the username and the password is empty. `curl -u user:pass` requires the colon separator even with no password.

---

## Step 8: Note the Product Images (optional)

If you want the pricing page or checkout to display a logo, upload one on the product page now:

- Click the product.
- Click the image placeholder in the top-left of the product editor.
- Upload a square PNG (400×400px minimum, transparent background is fine).

You can skip this; nothing breaks without it.

---

## Common Mistakes

### Mistake 1: Creating the product in Live mode

The dashboard shows a green "LIVE" banner (or no banner, if live is the default view) and you merrily create Contactly Pro, $97, $997, $4997. A week later you're wondering why `stripe.prices.list({ lookup_keys: ... })` returns nothing when called with a `sk_test_` key. The answer: the prices exist in live mode, not test mode.

**Fix:** always check the banner says `TEST MODE` before clicking Add. Delete the accidental live-mode product (you can't undo test data once it's seeded to live, but live mode products can be archived).

### Mistake 2: Typos in the lookup key

`contactly_monhtly`, `contactly-monthly`, `Contactly_Monthly`. Any deviation from the exact strings in lesson 8.3's config (`contactly_monthly`, `contactly_yearly`, `contactly_lifetime`) means the lookup fails silently and your pricing page shows a missing tier.

**Fix:** copy-paste the lookup keys from this lesson directly into the dashboard. Don't retype them.

### Mistake 3: Setting Lifetime as recurring

The UI defaults to recurring. If you click through too fast, you'll create a $4997-per-year price called "Lifetime" — which is obviously broken. The user clicks "Get lifetime access" and gets billed annually.

**Fix:** on the Lifetime price, explicitly select `One time`. Verify the table row says "One time", not "Yearly".

### Mistake 4: Editing prices after customers have subscribed

Stripe does not let you change the amount on a Price after it's been used. Once a customer subscribes to the $97 monthly, that price row is frozen. If you later decide to charge $99 instead, you **archive** the $97 price and **create** a new $99 price with the same lookup key (after removing it from the old price).

**Fix:** in test mode right now this doesn't matter — no real customers. But know the constraint for when we go live in Module 12.

### Mistake 5: Forgetting to flip lookup keys to "transferable"

When archiving a price to replace it (as in Mistake 4), you need the lookup key to move to the new price. The API supports `transfer_lookup_key: true` on create — we use that in lesson 8.2's seed script. The dashboard also lets you transfer lookup keys; look for the option when creating a replacement price.

---

## Principal Engineer Notes

### 1. Reproducible environment setup is a discipline, not a checkbox

Creating products by clicking in a dashboard is fine for one developer on day one. It falls apart the moment a teammate joins, you onboard a new production account, or you want a clean staging environment. Every click is state that lives only in one place and can't be code-reviewed.

In lesson 8.2 we'll write this exact setup as a TypeScript script. That script is the _source of truth_ for what products and prices exist in any Stripe environment. Dashboards become read-only verification tools. This is the same shift you made with database migrations in Module 1 (don't edit via Studio; write a migration) and the same shift you'll make with infrastructure in Module 12 (don't configure Vercel via the UI; commit config files). Keep noticing the pattern — "click-ops" doesn't scale, code does.

### 2. Why duplicate Module 5's content here?

The course has two real reading paths: the linear path and the "jump to what I need" path. Module 5 covers the Stripe fundamentals. Module 8 covers the public pricing page. A developer with an existing Stripe integration who just wants a pricing page component can skip Modules 5–7 and land here. We can't assume products exist — and sending them back five modules for a ten-minute dashboard click is friction.

The tradeoff is that linear readers re-see the product setup. We make that cheap by keeping this lesson tight, calling out in the prerequisites that Module 5 readers can skim, and using it as a chance to re-emphasise the lookup-key pattern (which Module 5 introduces but doesn't dwell on). **Course design is a product design problem**; redundancy is fine when it serves the user, not when it serves tidiness.

### 3. Lookup keys are an abstraction boundary

Without lookup keys, your price IDs leak across every boundary — test code, staging configs, production configs, seed scripts, database rows, email templates. With lookup keys, your _code_ mentions `contactly_monthly` and Stripe resolves it to the right internal ID per environment. That's the same abstraction pattern as environment variables (code says `DATABASE_URL`, deployment resolves it to the actual connection string). Both are boundaries between "what I care about" (the semantic name) and "what the system needs" (the opaque ID).

Whenever you find yourself pasting an opaque ID into application code, pause and ask: is there a human-readable alias I can use instead? If yes, use it. Stripe has lookup keys. Supabase Auth has slugs. DNS has hostnames. The pattern is everywhere.

### 4. The "idempotent by contract" design

Lookup keys are also why our seed script in lesson 8.2 can be made idempotent: re-running it doesn't create duplicate prices because Stripe rejects duplicate lookup keys. We get safe re-runs for free because the API makes wrong things impossible.

Compare that to a seed script keyed on price _amount_ (`create if no $97 price exists`). That's fragile: change the amount and you create a second row. Lookup keys are a contract between your code and Stripe — "this string uniquely identifies this business concept". Once you pick one, it's stable forever.

### 5. Prices are pricing, not packaging

Notice we're not hard-coding features in Stripe. Stripe doesn't know Contactly Pro has "unlimited contacts". Stripe only knows `$97 / month`. The feature list lives in our own config (lesson 8.3), because features are a **product** concept and pricing is a **billing** concept, and those two change independently.

A common mistake is to store feature lists in Stripe metadata and render from them. Don't. The moment you want to show a feature that's identical across all tiers, or a feature that's hidden on the pricing page but checked server-side for access control, Stripe metadata becomes the wrong database. Keep pricing in Stripe, features in your own code, and ownership of each in the mental model of the engineer responsible.

---

## Summary

- Confirmed Test Mode in the Stripe dashboard.
- Created one Product (`Contactly Pro`) with a customer-facing description.
- Added three Prices attached to that product: `$97/month` recurring, `$997/year` recurring, `$4997` one-time.
- Assigned three stable lookup keys: `contactly_monthly`, `contactly_yearly`, `contactly_lifetime`.
- Verified the setup in the dashboard and (optionally) via a `curl` round-trip against the Stripe API.

## What's Next

Clicks-in-a-dashboard are repeatable, but only if you're the one doing them. In lesson 8.2 we'll turn the setup you just did into a TypeScript script, `scripts/seed-stripe.ts`, that creates the same product and prices via the Stripe Node SDK. That script becomes committable, version-controllable, and run-able by any teammate in any new Stripe environment in one command. It's also the foundation for the integration tests in Module 11: those tests spin up an ephemeral Stripe test fixture, and our seed script is how they populate it.
