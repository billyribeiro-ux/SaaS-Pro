---
title: '5.5 - Creating Products & Prices'
module: 5
lesson: 6
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '05-creating-products-prices'
description: 'Create the Contactly product and its three pricing tiers in Stripe test mode.'
duration: 15
preview: false
---

## Overview

Time to put the Product/Price model from Lesson 5.4 into practice. By the end of this lesson, your Stripe test-mode dashboard will contain exactly one Product — **Contactly Pro** — with three Prices attached to it:

| Tier     | Price     | Cadence   | Lookup Key           |
| -------- | --------- | --------- | -------------------- |
| Monthly  | $97.00    | per month | `contactly_monthly`  |
| Yearly   | $997.00   | per year  | `contactly_yearly`   |
| Lifetime | $4,997.00 | one-time  | `contactly_lifetime` |

This is the catalog every other billing lesson in this course (Modules 6, 7, and 8) will stand on. When we wire up Checkout in Module 6, we'll look up each Price by its lookup key. When we process webhooks in Module 7, we'll map Stripe's Subscription state back to Contactly's profile tier using these three keys. The names chosen here (`contactly_monthly`, etc.) are the API surface between our app and Stripe, and we're going to pick them carefully.

We won't write a single line of code — this is all dashboard work. But the decisions you make (what to charge, why $97 instead of $100, why $997 vs $1164, whether to include lifetime at all) are real business decisions worth pausing on. A Principal Engineer's job isn't only to implement; it's to understand why the thing is being built this way.

## Prerequisites

- Lesson 5.4 complete — you understand the Product/Price split and `unit_amount` in cents.
- Stripe dashboard open, **test mode active** (orange TEST DATA banner visible). Double-check before doing anything.

## What You'll Build

- One Stripe **Product** named "Contactly Pro" with a description.
- Three **Prices** attached to that Product with the lookup keys listed above.
- Verification that all three appear correctly in the dashboard and are marked active.

---

## Step 1: Confirm You're in Test Mode

This is the sentence most easily skipped and most catastrophically skipped. Look at the top of your Stripe dashboard. You should see the orange **TEST DATA** banner.

- If it's there: good. Proceed.
- If it's not: you're in live mode. Click the toggle near the top of the sidebar to switch. Confirm the orange banner appears before moving on.

Creating products and prices in live mode isn't the end of the world — you can archive them later — but it clutters your real catalog with dev artifacts and sets up the exact kind of "which mode did I do this in?" confusion that causes bugs.

Verify too: **Developers → API keys**. The keys should start with `pk_test_` / `sk_test_`. If they start with `pk_live_` / `sk_live_`, you're in live mode.

---

## Step 2: Navigate to the Product Catalog

In the left sidebar, click **Products** → **Product catalog**. (Depending on Stripe's UI iteration, it may just be "Products" as a single link.) You'll see an empty list if this is a fresh test account. There might be a "Create your first product" prompt, or a **+ Add product** button in the top-right.

Click **+ Add product**.

---

## Step 3: Fill in the Product Fields

A modal or full-page form appears. Here's what to enter:

### Name

```
Contactly Pro
```

This is what customers will see on their receipts, invoices, and the hosted checkout page. It should be recognizable — if a customer disputes a charge on their bank statement, "Contactly Pro" should ring a bell. Don't use internal codenames here.

### Description

```
Full access to Contactly — unlimited contacts and all features
```

One sentence is enough. Shown on checkout, under the product name, in smaller text. It's an elevator pitch: what does the customer get by paying?

A note on descriptions: resist the urge to stuff this with marketing fluff. It shows up in places (like the hosted invoice page) where space is limited. One clear sentence > three lines of superlatives.

### Images (optional)

Skip for now. Later, if you want a Contactly logo on checkout, add a public image URL (an S3 bucket, a Supabase storage URL, a CDN). For Contactly Pro we'll leave it imageless — Stripe's default layout is clean without it.

### Statement descriptor (advanced; leave default)

This is what appears on the customer's credit-card statement. Defaults to your business name from **Settings → Business details**. Can be customized per-product but usually isn't worth the complexity for a single-product SaaS.

### Tax behavior

Set to **Default** for now — Stripe handles this globally via **Settings → Tax**. We'll revisit in a later module when we enable Stripe Tax for automatic VAT/GST compliance.

### Metadata

You'll see a "Metadata" expandable section. We don't need any metadata for Contactly Pro — the product's name and lookup keys on the prices are enough. You could add e.g. `internal_slug: pro`, but it'd be unused. Leave it empty.

### The Pricing Panel (Important!)

Stripe's UI combines product and initial price into one form. Scroll down to **Pricing**. This is where the magic happens.

For the first price (Monthly), configure:

- **Price type:** Recurring
- **Amount:** `97.00`
- **Currency:** USD
- **Billing period:** Monthly
- **More pricing options →**
  - **Lookup key:** `contactly_monthly`
  - Leave everything else default.

Stripe's form auto-converts the `97.00` you type into `unit_amount: 9700` cents behind the scenes — you're entering the user-facing value, and the API receives the integer.

### Save

Click **Save product** (or **Create**). Stripe creates the Product (`prod_xxx`) and the first Price (`price_xxx` with lookup key `contactly_monthly`) atomically. You'll be redirected to the Product detail page.

---

## Step 4: Verify the First Price

On the Product detail page for Contactly Pro, scroll to the **Pricing** section. You should see one row:

```
Contactly Pro Monthly (or similar default nickname)
$97.00 USD per month
Lookup key: contactly_monthly
Active
```

Click the price to see its detail. Confirm:

- **ID:** `price_xxx` (something generated; ignore — we never reference this).
- **Amount:** `9700` (in cents, if you toggle to the raw view).
- **Currency:** `usd`.
- **Recurring:** `month`, `interval_count: 1`.
- **Lookup key:** `contactly_monthly`.
- **Active:** true.

If anything is off — wrong amount, wrong interval, missing lookup key — fix it now before creating the other two. In the Price detail, click **Edit price** for the fields Stripe lets you mutate (note: some fields like `unit_amount` are immutable; you can edit things like `nickname` and `lookup_key`, but for `unit_amount` you archive and recreate).

---

## Step 5: Add the Yearly Price

Back on the Product detail page, click **+ Add another price**. A form opens in a panel or modal.

Configure:

- **Price type:** Recurring
- **Amount:** `997.00`
- **Currency:** USD
- **Billing period:** Yearly
- **Lookup key:** `contactly_yearly`

Save. The Pricing section now shows two rows.

### Why $997 for yearly, not $1164?

$97 × 12 = $1,164. If you wanted to charge "exactly monthly × 12," that's the number.

We're charging $997 — about 14% less than monthly × 12. Translation: **pay annually, save 14%**. In SaaS this is called an **annual discount** and it's a standard lever. Why?

- **Cash flow.** Annual customers pay upfront. You get 12 months of revenue on day 1 instead of dribbling in month-by-month.
- **Retention.** Customers on annual plans churn less. They've committed, they're less likely to cancel impulsively, and if they do consider canceling, the sunk cost makes them think twice.
- **LTV (lifetime value).** Annual customers' LTV is usually higher than monthly, even accounting for the discount. Data from Stripe, ProfitWell, and others shows this consistently across SaaS.
- **Pricing psychology.** "Save $167/year" is a compelling pitch on a pricing page.

The **exact** discount (5%, 10%, 20%) is a tuning choice. 15-20% is a common starting point; we chose ~14% for round marketing numbers. Lower discounts prioritize revenue, higher ones prioritize acquisition.

### The "10x rule" (not strict, but worth knowing)

An old SaaS heuristic: **set annual price to roughly 10x monthly**. $97 → $970, $19 → $190, $99 → $990.

The 10x rule is a shorthand for "give two months free when paying annually." It's easy to communicate, easy to remember, and it's roughly what most successful SaaS companies do. We went slightly above it ($997 vs the pure $970) because $997 reads better on a pricing page than $970 (the trailing 7 feels "intentional" in a way the trailing 0 doesn't). That tiny choice is called **charm pricing** — next section.

---

## Step 6: Add the Lifetime Price

Back to the Product detail page, click **+ Add another price**.

Configure:

- **Price type:** One-time
- **Amount:** `4997.00`
- **Currency:** USD
- **Lookup key:** `contactly_lifetime`

Save. The Pricing section now has three rows:

```
contactly_monthly  — $97.00/mo   Active
contactly_yearly   — $997.00/yr  Active
contactly_lifetime — $4,997.00   Active (one-time)
```

### Why include a lifetime option?

Lifetime deals are controversial in SaaS circles. Purists argue they're harmful — you're trading future recurring revenue for a one-time lump sum, which hurts long-term MRR growth and can strain infrastructure as lifetimers pile up without a recurring revenue stream to support them.

Realists argue they're useful for bootstrapped SaaS in specific phases:

- **Early stage:** you need cash now to keep building. Lifetime deals convert skeptics who won't subscribe into committed customers.
- **Marketing signals:** "$4,997 lifetime" frames the monthly and yearly as reasonable by comparison. Psychological anchoring.
- **AppSumo-style launches:** there's an entire ecosystem (AppSumo, dealify, etc.) that sells only lifetime offers. A Contactly launch on AppSumo could convert hundreds of early adopters who'd never have subscribed.
- **Customer passion:** some customers genuinely prefer "pay once and own it forever," and refusing to offer it feels customer-hostile.

For Contactly, we include lifetime as a course design choice — it lets us demonstrate **one-time payments alongside subscriptions in the same codebase**, which exercises more of Stripe's API. In a real business, whether to offer lifetime is a sustained strategy decision.

### Why $4,997?

Roughly 4 years of yearly ($4 × $997 = $3,988) plus a premium. "If you're going to be a Contactly customer for 4+ years, lifetime saves you money." For customers who'd churn in < 4 years, we come out ahead; for customers who'd stay longer, they come out ahead. At scale, it's a calculated risk.

$4,997 vs $5,000 is again charm pricing — the 7 ending feels lower than a clean $5,000.

---

## Step 7: Psychological Pricing — The "$97 Not $100" Decision

You'll notice all three prices end in 7 ($97, $997, $4,997) rather than round numbers ($100, $1,000, $5,000). This isn't an accident. There's decades of pricing research behind these choices.

### Charm pricing

Prices ending in 7 or 9 (e.g., $97, $99) are perceived as significantly lower than the next round number, beyond what the arithmetic would suggest. The mind anchors on the leftmost digit — "$97" registers as "in the nineties" rather than "a hundred." This is called **left-digit bias**.

Studies (most famously by Anderson & Simester, 2003) show conversion rate lifts of 20-30% when a price moves from $39 to $37 or $34 to $29 — despite the absolute difference being trivial.

### Why 7 instead of 9?

"7" is the standard for SaaS, while "9" is the standard for consumer retail. There's no rigid reason — it's just tradition that has stuck across the industry. Many bootstrapped SaaS-for-developers products use 7-ending prices specifically because it signals "we're in the SaaS-for-developers cluster."

### When it doesn't apply

For enterprise pricing (annual contracts in the tens or hundreds of thousands), round numbers signal confidence and stability. "$250,000/year" beats "$247,000/year" at that scale — the conversation isn't about frugality. Know your market.

For Contactly (a mid-market SaaS), $97 is the correct ending. It fits the genre.

### The nth-order effect

Once you've thought about charm pricing for an hour, you start seeing it everywhere. Basecamp at $99. Linear at $16 per seat. Notion's Pro at $10. Our $97 is swimming in the same waters. That's deliberate — we're signaling "we're in this category" without saying it explicitly.

---

## Step 8: Verify the Catalog

Go back to **Products** in the sidebar. You should see one row: **Contactly Pro**, with a nested expandable showing 3 prices (or, depending on the UI, the prices are visible only when you click into the product).

Click into Contactly Pro. Confirm:

- Product name: Contactly Pro.
- Description: Full access to Contactly...
- 3 prices visible, all marked **Active**:
  - `contactly_monthly` — $97.00/mo
  - `contactly_yearly` — $997.00/yr
  - `contactly_lifetime` — $4,997.00 (one-time)
- Each price has its lookup key clearly displayed.

If any of these aren't right, fix them now. It's much easier to course-correct before you have code and webhooks depending on the catalog.

---

## Step 9: Note the IDs (but Don't Commit Them)

Each Price has a `price_xxx` ID. You'll see them in the dashboard (click a price to see its detail). They look like `price_1Nv7k8KZabc`.

**Do not paste these into your code.** They're the wrong abstraction; we'll use lookup keys in all application code (Lesson 5.6). If you jot them down for your own reference, keep it in a scratch file outside the repo, or just trust that you can always retrieve them via lookup key later.

Same goes for the Product's `prod_xxx` ID. We never reference it in code. Stripe uses it internally; we don't.

---

## Common Mistakes

### Mistake 1: Created the Price in the wrong mode

You created "Contactly Pro" in live mode because the toggle was flipped. Now you have a real live product that customers could accidentally see if they navigate to any URL tied to it.

**Defense:** archive the live-mode products (set `active: false`) and recreate in test mode. If activation forms on Stripe keep pointing at your live catalog, delete the live products (Stripe allows deletion when they haven't been used in real transactions).

### Mistake 2: Entered the amount as `97` instead of `97.00`

Stripe's UI sometimes interprets `97` as `97 cents` ($0.97) rather than `$97.00`. Double-check the formatted display after saving: if it says "$0.97" you know what happened. Archive and recreate.

### Mistake 3: Forgot the lookup key

You created the price, all fields looked right, but you skipped the "More pricing options" expandable where `lookup_key` lives. The price exists, but your code has no stable name for it.

**Defense:** you can **add** a lookup key to an existing price via the Price detail → Edit → `lookup_key` field. But you can't have two prices with the same lookup key at once, so make sure the key isn't already in use.

### Mistake 4: Inconsistent naming

You pick `contactly_monthly` for monthly but `annual_plan` for yearly and `contactly-lifetime` (with a hyphen) for lifetime. Three different conventions. Your code now has to remember which is which.

**Rule:** pick a naming scheme and stick to it. For Contactly:

- Prefix: `contactly_` (tied to product).
- Cadence suffix: `monthly`, `yearly`, `lifetime`.
- Snake case, all lowercase.

If you add a new product later (e.g., "Contactly Team"), the scheme extends naturally: `contactly_team_monthly`, `contactly_team_yearly`.

### Mistake 5: Using hyphens in lookup keys

Lookup keys allow alphanumeric, underscore, and a few special characters. Hyphens in particular cause inconsistency — some APIs case-fold or trim hyphens. Stick to underscores. Test: `contactly_monthly` (good), `contactly-monthly` (risky in some toolchains).

### Mistake 6: Pricing decisions made in a vacuum

You copy the $97/$997/$4,997 values because this lesson uses them. For Contactly-the-course, that's fine. For your own SaaS, think about it. Run a few competitive-research Google searches: what do competitors charge? What's the price-to-value ratio? Are you priced to compete on cost (below market) or value (above market)?

Pricing research is a full discipline. Books like _Monetizing Innovation_ (Madhavan Ramanujam) are good starting points. Don't treat your price as an afterthought; it's the single biggest lever on your business.

---

## Principal Engineer Notes

### Pricing strategy is deeper than numbers

The difference between "we charge $97/mo" and "we charge $97/mo for these reasons" is the difference between a business and a guess. Principal-level product work means understanding:

- **Anchoring:** $4,997 lifetime makes $97/mo look cheap.
- **Decoy effect:** the yearly $997 isn't meant to sell the most; it's meant to make the $97/mo look reasonable.
- **Psychological pricing:** $97 vs $100 is a 3% absolute change with 20-30% conversion impact.
- **Discount framing:** "save $167/year" has more power than "pay $997 instead of $1164."

None of these are engineering concerns per se, but a Principal Engineer who understands them designs billing systems that can **express** them — multiple prices per product, easy price changes, A/B tooling. The code serves the strategy.

### The 10x rule as a principle of habit

The "annual = 10x monthly" rule isn't about arithmetic; it's about being a **consistent** pricing operator. Customers shouldn't have to calculate "is yearly worth it?" — the answer should be obvious at a glance (yes, two months free). A consistent heuristic is a marketing feature.

The same principle applies to many things in SaaS — feature flag naming, role-name consistency, URL structures. Consistency compounds. Eccentricity taxes customers' attention. Be consistent.

### Lifetime as a Founder Signal

Including a lifetime tier says something about the business:

- **"We believe in what we're building."** If we fold, lifetimers get stiffed, so it's a commitment signal.
- **"We value your capital today."** Bootstrapped SaaS with a lifetime option is often pre-Series-A, cash-constrained, and willing to trade future MRR for present cash. That's not a bad thing — it's transparent.
- **"We're not venture-scale."** VC-backed SaaS almost never offers lifetime deals (they care about predictable ARR). Lifetime is a bootstrapper's tool.

If Contactly were a VC-backed startup, we'd strip lifetime. We're a bootstrapped SaaS in this course; it's appropriate. Know what your pricing says about you.

### Deactivate, don't delete — reinforced

Same principle from Lesson 5.4, worth hammering: once a Price has a lookup key and real usage, never delete it. Archive (`active: false`), transfer the lookup key to a new Price, and let the old one live forever in your historical records. Every invoice that references it remains valid.

The muscle memory: "archive" is the default button; "delete" is a last-resort button you rarely use. Same energy as "soft delete" vs "hard delete" in application databases.

### Commit the catalog intent, not the IDs

In many teams, I've seen engineers hand-type `prod_xxx` and `price_xxx` IDs into README files, runbooks, and comments. Every price change obsoletes these docs, and nobody remembers to update them. The anti-pattern self-perpetuates.

A better practice: **commit the _intent_** — the product name, the lookup keys, the tier slugs. Those are stable. If you later need to find the current `price_xxx`, you query Stripe by lookup key. Your docs and code never go stale.

---

## Summary

- Created one **Product** — "Contactly Pro" — in Stripe test mode.
- Created three **Prices** attached to it:
  - `contactly_monthly` — $97.00/mo
  - `contactly_yearly` — $997.00/yr
  - `contactly_lifetime` — $4,997.00 one-time
- Used lookup keys consistently (`contactly_*` prefix + cadence suffix, snake case).
- Understood the business logic: ~14% annual discount, charm pricing ending in 7, lifetime as founder signal.
- Noted but deliberately did not record the `prod_xxx` / `price_xxx` IDs in code or docs — they're infrastructure details, not contracts.

## What's Next

You have a working Stripe catalog, but your code doesn't know about it yet. Lesson 5.6 — the heaviest lesson in Module 5 — codifies the **lookup key** pattern and builds the `pricing.config.ts` file that lists all three keys. Internalizing this pattern now is the difference between a billing integration you can update in minutes and one that takes days. It is, without exaggeration, the most important concept in the whole module.
