---
title: '5.2 - Stripe API & Docs'
module: 5
lesson: 2
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '02-stripe-api-docs'
description: 'Navigate the Stripe documentation and API reference to find what you need fast.'
duration: 8
preview: true
---

## Overview

Stripe has the best developer documentation in the SaaS industry. Full stop. Engineers who learn to read Stripe's docs well ship billing features in hours; engineers who skim them ship bugs and get paged at 3 a.m. Ten minutes of tour now will save you dozens of hours across the rest of the course.

This lesson is a guided walk through **docs.stripe.com** — where the guides live, where the API reference lives, where the SDK docs live, how to read API response shapes, and how to use the dashboard's **Events** and **Logs** to cross-reference documentation with what actually happened in your account. We'll also tackle **API versioning** — the single most load-bearing concept in the whole Stripe experience — and explain why we're pinned to `2026-03-25.dahlia` for the rest of the course.

## Prerequisites

- A Stripe account (Lesson 5.1 complete).
- A browser and curiosity.

## What You'll Build

- A mental map of [docs.stripe.com](https://docs.stripe.com) — the two main sections (Guides and API Reference) and when you use each.
- An understanding of how API versioning works and why Stripe v22 pins us to `2026-03-25.dahlia`.
- Comfort reading an object shape in the API reference (e.g., a Subscription's fields).
- Fluency with the dashboard's **Developers → Events** and **Developers → Logs** for debugging.

---

## Step 1: The Shape of docs.stripe.com

Open [docs.stripe.com](https://docs.stripe.com). The top-level navigation is clean:

- **Get started** — onboarding, concepts, quickstart tutorials.
- **Payments** — one-time payments, Checkout, Payment Links, Elements.
- **Billing** — subscriptions, invoices, customer portal, usage-based billing.
- **Identity, Connect, Issuing, Terminal, Tax, Climate** — Stripe's many products. Ignore them for now; Contactly only uses Billing + Payments.
- **API Reference** — the authoritative contract for every object and endpoint.
- **SDKs** — language-specific SDK docs (Node, Python, Go, etc.).
- **Changelog** — every Stripe API version and what changed.

Mentally, the docs are **two sites welded together**:

1. **Guides** (everything except API Reference) — prose explanations, code samples in multiple languages, step-by-step tutorials. This is where you go to understand _why_ and _how_.
2. **API Reference** — machine-generated, exhaustively detailed, documents every field on every object and every parameter on every endpoint. This is where you go to understand _what_.

Think of Guides as "the book chapter" and API Reference as "the dictionary." Both matter. You rarely use one without the other.

---

## Step 2: The Guides Section — Prose, Examples, Context

Guides answer questions like:

- "How do I build a subscription with a trial?"
- "What's the difference between Checkout and Payment Element?"
- "When should I use webhooks vs polling?"

Navigate to **Billing → Subscriptions → Overview**. Scroll through it. Notice:

- A narrative that explains the concept.
- Diagrams showing the data relationships (Customer → Subscription → Price → Product).
- Code samples with a language toggle (curl, Node, Python, Ruby, PHP, Go, Java, .NET).
- Links to every relevant API reference page.

For Contactly, the Guides you'll read most are:

- **Billing → Subscriptions** — the conceptual backbone of our monetization.
- **Billing → Customer Portal** — the hosted page where users manage their own subscriptions (we wire this up in Module 7).
- **Payments → Checkout** — the hosted checkout page that collects card details (Module 6).
- **Developer Tools → Webhooks** — how Stripe notifies your server of events.

Bookmark these four.

### Code samples — choose your language

The code sample at the top-right of every guide has a language selector. **Set it to Node** for this course — Contactly runs on Node (via SvelteKit), and the Node SDK is what we'll import. When you follow along with a guide, you can copy-paste the Node sample into your editor with minimal translation.

A gotcha: some guides' Node samples use plain ES modules; others use CommonJS (`require(...)`). Both work in modern Node, but SvelteKit uses ES modules, so the `import Stripe from 'stripe'` form is what you want. Minor syntactic translation — never a source of real confusion once you've seen it once.

---

## Step 3: The API Reference — Exhaustive, Boring, Essential

Navigate to **API Reference** (top-right nav, or [docs.stripe.com/api](https://docs.stripe.com/api)).

The left sidebar lists every top-level object:

- Core resources: **Balance, Charges, Customers, Disputes, Events, Files, PaymentIntents, Payouts, Refunds, Tokens**.
- Products & prices: **Products, Prices, Coupons, Promotion codes**.
- Billing: **Subscriptions, Invoices, Invoice Items, Subscription Items, Usage Records, Credit Notes**.
- Checkout: **Checkout Sessions**.
- Webhooks: **Webhook Endpoints, Events**.

Each object has:

- An **object description** — the definitive reference for the shape.
- A list of **endpoints** — every operation you can perform (`Create`, `Retrieve`, `Update`, `Delete`, `List`).
- Every **field** — name, type, nullability, and explanation.

### Anatomy of an API Reference page — the Subscription example

Click **Subscriptions** in the sidebar. Scroll to the **The subscription object** section. You'll see fields like:

| Field                  | Type               | Description                                                                                                  |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`                   | string             | Unique identifier, starts with `sub_`.                                                                       |
| `object`               | string             | Always `"subscription"`.                                                                                     |
| `customer`             | string or Customer | The customer this subscription belongs to. Either a `cus_xxx` ID or an expanded Customer object.             |
| `status`               | enum               | One of `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`. |
| `current_period_start` | integer            | Unix timestamp in seconds.                                                                                   |
| `current_period_end`   | integer            | Unix timestamp in seconds.                                                                                   |
| `cancel_at_period_end` | boolean            | If `true`, the subscription will cancel when the period ends.                                                |
| `items`                | object             | Contains the price/quantity pairs for this subscription.                                                     |
| `metadata`             | object             | Your app's free-form key-value data.                                                                         |
| ...                    | ...                | ...                                                                                                          |

Let's unpack three things that trip up newcomers:

#### String **or** object — the "expandable" pattern

Fields like `customer` can be either a string ID (`"cus_Nv7k8..."`) or a full expanded object. By default, Stripe returns the string. If you want the whole object inline, pass `expand: ['customer']` to the request. This saves a round-trip when you already know you need the data.

In TypeScript, that means `customer: string | Stripe.Customer`. Your code needs to type-narrow with `typeof customer === 'string'` or use Stripe's helpers. We'll handle this cleanly in Module 6.

#### Unix timestamps in seconds, not milliseconds

Stripe returns time as a number of **seconds** since epoch. JavaScript's `Date` constructor takes **milliseconds**. So:

```typescript
const date = new Date(subscription.current_period_end * 1000);
```

Forget the `* 1000` and you get a date in 1970. This is the single most common timestamp bug in Stripe integrations. Set the bit in your brain now.

#### Enums with weird statuses you've never heard of

`incomplete`, `incomplete_expired`, `past_due`, `unpaid`, `paused` — these are statuses most apps don't consciously plan for. They're all real. A subscription starts as `incomplete` until the first invoice is paid; if the card is declined and retries all fail, it moves to `unpaid`. In Module 8 we'll map every status to a user-visible state, so you handle them all deliberately instead of letting `past_due` quietly drop a customer into a broken UX.

### How to read the endpoint docs

Scroll to **Create a subscription**. You'll see:

- **Endpoint:** `POST /v1/subscriptions`
- **Parameters** with type, whether required, and description.
- **Returns:** the subscription object.
- **Examples** in each language, copy-pasteable.
- The HTTP **response shape** in JSON.

When we wire up a subscription in Module 6, we'll consult this page line by line to know exactly which parameters to send.

---

## Step 4: The Node SDK Docs

Stripe publishes official SDKs in many languages. We use the **Node SDK** (`stripe` on npm), version 22.

Navigate to the SDK docs: [github.com/stripe/stripe-node](https://github.com/stripe/stripe-node). Some useful landmarks:

- The **README** — install instructions, basic usage.
- The **types** — generated from Stripe's OpenAPI spec; they're the source of truth for "what field exists on what object."
- The **changelog** (`CHANGELOG.md`) — lists every SDK release and its corresponding API version.

Install commands (don't run these yet — we install in Module 6):

```bash
pnpm add stripe@^22
pnpm add -D @types/stripe
```

Basic shape of how you use it:

```typescript
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia'
});

const subscription = await stripe.subscriptions.retrieve('sub_xxx');
console.log(subscription.status);
```

The `stripe` client is a typed client. `stripe.subscriptions.retrieve(...)` corresponds to `GET /v1/subscriptions/:id` in the API reference. Every resource has the expected operations (`create`, `retrieve`, `update`, `del`, `list`), and the return types match the API reference object shapes exactly.

---

## Step 5: API Versioning — The Most Important Concept in This Lesson

Stripe publishes a new API version every few months. Each version has a date-based identifier, sometimes with a marketing suffix, like:

- `2022-11-15`
- `2023-10-16`
- `2025-10-27.acacia`
- `2026-03-25.dahlia` ← **what we're using**

The version determines the exact shape of every response and the behavior of every endpoint. For example:

- In an older version, `subscription.current_period_end` was at the top level. In a newer version, it moved onto subscription items.
- In an older version, `checkout.session.payment_method_types` was required. In a newer version, it became optional with a sensible default.

When Stripe changes the shape, your code breaks — unless you're pinned.

### How pinning works

Stripe pins your **account** to whatever API version was current when you created it. That pin is shown in the dashboard at **Developers → API versions**. Every API request from your account defaults to that pinned version, regardless of SDK.

But — and this is crucial — the SDK **also** has an API version, baked into each major release. The Node SDK v22 is tied to `2026-03-25.dahlia`. When you instantiate the client:

```typescript
const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia'
});
```

You're **overriding your account's pin for this client**. Every request from this client uses `2026-03-25.dahlia` regardless of what the dashboard says. The SDK's types are generated for `2026-03-25.dahlia`. Everything lines up.

If you change the `apiVersion` string to something the SDK doesn't know about, you'll get runtime errors when response shapes don't match the types. **Don't change the `apiVersion` in this course — the SDK version and the `apiVersion` must match.**

### Why pinning matters

Imagine this scenario without pinning:

1. You build Contactly in March 2026. Everything works.
2. In October 2026, Stripe releases a new API version that renames `subscription.trial_end` to `subscription.trial.end_at`.
3. Your account's pin is still `2026-03-25.dahlia`, so nothing happens. Good.
4. But a teammate upgrades the Node SDK to v23, which pins to the October version by default. Their code breaks in CI because `subscription.trial_end` no longer exists.

Pinning to an explicit `apiVersion` string in your SDK config means **any two developers on your team see the exact same Stripe behavior no matter what their dashboard says**. CI and prod stay aligned. Upgrades become deliberate events, not accidental ones.

### Migrating to a new version — the Stripe-documented path

When you eventually want to migrate (say, v22 → v23), the process is:

1. Read the changelog for every version between where you are and where you want to go.
2. In a **staging branch**, update the SDK (`pnpm add stripe@latest`) and the `apiVersion` string.
3. Run your tests. Fix anything broken (usually field renames, a few removed fields).
4. Deploy to staging. Trigger test events through all your webhook handlers. Verify every code path.
5. Merge and deploy.
6. Update the account pin in the dashboard (optional but tidy).

Done properly, this is a contained, hour-scale migration. Done as a surprise (e.g., "oh, the SDK auto-upgraded"), it's a 3 a.m. incident. Pinning is the difference.

---

## Step 6: Developers → Events

Navigate to **Developers → Events** in the dashboard.

This page lists every event Stripe has emitted for your account. Events are generated when **things happen** — a subscription is created, an invoice is paid, a charge succeeds, a customer updates their email. Each event has:

- A **type** (e.g., `customer.subscription.created`, `invoice.paid`, `charge.succeeded`).
- A **resource** (the Stripe object that changed).
- A **timestamp**.
- A unique ID starting with `evt_`.
- A **request** (the API call that triggered it, if applicable) or **source** (e.g., `dashboard` if a human clicked something).

Click any event to see the **full JSON payload** Stripe would have sent to your webhook endpoint if you had one configured. This is gold for debugging — you can see the exact shape of the data your code will receive, without having triggered a webhook fire.

### Resend & replay

At the top of an event detail view, there's a **Resend** button. If you have a webhook endpoint configured, clicking Resend will re-deliver this event to it. Perfect for debugging when your handler crashed on the first delivery and you want to see if the fix works on the exact same payload.

Event data is retained for **30 days** on Stripe's side. After that, the event is gone — another reason to build a durable record on your side (we'll do this in Module 8's idempotency work).

---

## Step 7: Developers → Logs

**Developers → Logs** shows every API request your account has received, regardless of source — your server, the dashboard, the CLI, anywhere.

Each log entry has:

- **Endpoint** (`POST /v1/subscriptions`, `GET /v1/customers/cus_xxx`, etc.).
- **Status** (2xx success, 4xx client error, 5xx server error).
- **Timestamp**.
- **IP address** the request came from.
- **Full request body** and **full response body**.
- The **idempotency key**, if one was provided.

When your code calls Stripe and something breaks, your first move should be: open Logs, find the failed request, read the response body. Stripe's error responses are unusually helpful — they include `code`, `message`, `param` (which field was invalid), and often a link to docs.

### Filtering logs

You can filter by:

- HTTP method.
- Status code.
- Resource type.
- Time range.
- API version.

The "API version" filter is worth internalizing. If you see requests with a mix of versions (say, your server on `2026-03-25.dahlia` but a script a teammate ran on the account default), that's the smoking gun of a pinning mismatch.

---

## Common Mistakes

### Mistake 1: Trusting the code samples without reading the prose

A Stripe guide's code sample is typically a minimal happy-path example. Real code handles errors, idempotency, and edge cases that the sample elides. If you only copy the sample and skip the prose above and below it, you miss half the story — the half that matters for production.

Read the whole guide, then the sample. Don't let samples become ritual.

### Mistake 2: Looking up fields by guessing

"I think subscription has a `cancel_date` field." No — it has `canceled_at` (past tense, underscore). You'll waste ten minutes chasing a typo. Always open the API Reference for the object in question and ctrl-F for the field. The source of truth is one URL away.

### Mistake 3: Using the wrong API version's docs

Stripe's docs default to the newest version. If you're on `2026-03-25.dahlia` and you're reading docs for `2027-04-01` (some future version), you'll see fields and parameters that don't exist in your version yet.

**Defense:** in the top-right of every API Reference page, there's a version selector. Set it to `2026-03-25.dahlia`. Leave it there. The docs will then show exactly what your code sees.

### Mistake 4: Not using Logs when debugging

You have a bug. You add `console.log` statements, you re-run, you guess. Hours pass. Meanwhile, the full request and response were sitting in **Developers → Logs** the whole time, with the exact error Stripe returned.

Logs should be the **first** place you look, not the last. Muscle memory: something broke → Stripe dashboard → Developers → Logs → filter to the last 5 minutes.

### Mistake 5: Confusing the account's pin with the SDK's pin

You upgrade the Node SDK. Your tests break. You run to the dashboard to "upgrade the API version." That's not what you want — the dashboard pin is for _defaults_. The SDK always overrides with its own `apiVersion` string. Fix the string in your code, not the dashboard.

This confuses people at least once. Don't be surprised when it's your turn.

---

## Principal Engineer Notes

### Reading the changelog is a professional skill

Stripe's changelog ([docs.stripe.com/changelog](https://docs.stripe.com/changelog)) is technical reading at its best. Every version lists:

- **Major changes** — field renames, removed parameters, behavior changes. Each with "impact" and "migration path."
- **Minor additions** — new parameters, new fields, new endpoints. Usually no migration needed.

Read the changelog **before upgrading**, not after. Skim every version between your current and the target. Search for the resources you use (Customer, Subscription, Invoice) — any entry that mentions them is a potential migration item.

This habit generalizes far beyond Stripe. Every major dependency you ever use has a changelog. Reading them is the difference between an engineer who upgrades cleanly and one whose prod breaks every other Tuesday.

### Dual-reading: staying on an old version while preparing for a new one

A technique used by teams who take billing seriously:

1. Stay pinned to your current API version in production.
2. Create a second Stripe client in staging pinned to the **next** version.
3. Mirror a small percentage of real traffic (or replay events) against staging.
4. Compare responses. File tickets for any breakage.

This gives you confidence to upgrade weeks or months before the actual rollout. Overkill for Contactly at our scale, but the pattern is exactly what you'd do at a company processing millions in revenue. When you see the term "dual-reading" in systems-design interviews, this is a canonical example.

### Idempotency keys visible in the log

Every time you call Stripe with an `idempotencyKey`, the key appears in the **Developers → Logs** entry. This is how you verify your code is deduplicating properly. If you see two requests with the same key and only one succeeded (the other returned the cached response), your idempotency is working. If you see two with different keys, your deduplication logic has a bug.

We set up idempotency keys formally in Module 8. For now: know that the mechanism is observable, testable, and reviewable from the dashboard. You don't have to take your own code's word for it.

### API design lessons from reading Stripe

Spend a few hours reading Stripe's API reference and you'll absorb the conventions used by virtually every modern SaaS API — expandable fields, cursor-based pagination, idempotency keys, metadata blobs, deterministic IDs with object-type prefixes (`cus_`, `sub_`, `in_`, `evt_`). Stripe didn't invent all of these but popularized them.

When you design your own internal APIs later, the instinct to "make it look like Stripe" is usually correct. Clear object types, consistent pagination, meaningful prefixes — free ergonomics.

### The dashboard is the spec

If the dashboard shows it and the docs don't match, the dashboard wins. The dashboard reads live production data; docs can lag. Bug? File it with Stripe support — their docs are excellent precisely because they take feedback seriously. In the meantime, implement against what the dashboard (and Logs) shows.

---

## Summary

- Mapped docs.stripe.com into **Guides** (prose, tutorials, context) and **API Reference** (authoritative object & endpoint details).
- Learned to read API Reference pages — object fields, endpoints, expandable relations, Unix-seconds timestamps.
- Surveyed the Node SDK (`stripe@22`) and noted that `apiVersion: '2026-03-25.dahlia'` is how we pin behavior.
- Internalized **API versioning**: Stripe pins your account; the SDK pins the client; when they agree, you're stable; when they disagree, you break at runtime.
- Toured **Developers → Events** (every state change, replayable) and **Developers → Logs** (every API request with full bodies).
- Picked up Principal-level habits: reading changelogs, dual-reading for version migrations, observing idempotency keys in logs, letting the dashboard be ground truth.

## What's Next

In Lesson 5.3 we install the **Stripe CLI** — the tool that lets Stripe's cloud deliver webhook events to your localhost without you having to expose your dev machine to the internet. It's the bridge between "Stripe sends an event" and "your SvelteKit dev server receives it," and it's the single tool that makes local Stripe development feel native.
