---
title: "7.1 - Define Billing Tables"
module: 7
lesson: 1
moduleSlug: "module-07-billing-services"
lessonSlug: "01-define-billing-tables"
description: "Create the four billing tables that will mirror your Stripe data in Supabase."
duration: 15
preview: false
---

## Overview

Module 6 got you wired up to Stripe — you have an API client, a webhook endpoint, and the infrastructure to receive events from Stripe's servers. But right now, when an event arrives, all you do is log it. The data evaporates the moment your process restarts.

In Module 7 you're building the **billing service layer** — a thin, testable, strictly-typed layer between Stripe's API and Supabase's Postgres. Every product, price, customer, and subscription that matters to Contactly will be **mirrored** into your own database. That mirror is the foundation every other feature stands on: the pricing page, the checkout flow, the "manage subscription" page, the per-plan feature gates, the "was this user a paying customer last month?" analytics queries.

This first lesson is the data model. Four tables: `products`, `prices`, `customers`, `subscriptions`. They are boring. They are also load-bearing. If you get them wrong now, every webhook handler you write for the rest of the module inherits the pain — column name drifts, missing foreign keys, RLS confusion, and a daily reminder that your `unit_amount` was accidentally stored as a float.

We're getting them right.

## Prerequisites

- Module 6 complete — Stripe client in `src/lib/server/stripe.ts`, webhook endpoint at `/api/webhooks/stripe`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`.
- Local Supabase running (`pnpm db:start`) and Studio reachable at `http://localhost:54323`.
- The `profiles` table from Module 1 exists — `customers` will foreign-key to it.
- You remember the migration workflow from Module 4: `pnpm supabase migration new`, edit the file, `pnpm supabase db reset`, regenerate types.

## What You'll Build

- A single migration file `20260418000002_billing_tables.sql` that creates four tables with full RLS.
- `products` and `prices` — publicly readable (anyone visiting your pricing page can read them, logged in or not).
- `customers` — one row per Supabase user, mapping their `profiles.id` to a Stripe customer ID.
- `subscriptions` — one row per active/past Stripe subscription, owned by a user via `user_id`.
- Regenerated TypeScript types so `supabase.from('prices')` autocompletes the exact columns you defined.

---

## Step 1: Why Four Tables — and Why Mirror Stripe at All?

The shortest possible version of a billing system is "ask Stripe every time." Want the user's active plan? `stripe.subscriptions.list({ customer })`. Want the price of the Pro tier? `stripe.prices.retrieve('price_123')`. Stripe stores the source of truth; your app is a dumb client.

That works — for about a week. Then the problems pile up:

1. **Latency.** Every page render that touches billing is a round-trip to Stripe. Your dashboard takes 800ms to render because it made three Stripe API calls.
2. **Rate limits.** Stripe allows around 100 requests per second per account. Hit a hot page with modest traffic and you're rate-limited.
3. **Downtime.** Stripe has incidents. When Stripe is down, your app shouldn't be.
4. **Joins.** You want to query "all users on the Pro plan who have more than 50 contacts." That's a join across your data and Stripe's data — impossible if billing data isn't in your database.
5. **Cost.** Stripe's API is free to call, but your engineering time and user experience aren't.

The professional pattern is **mirror-on-webhook**. Stripe is the source of truth. Your database is a **cache** of Stripe that's kept fresh by webhooks. Every billing read (pricing page, feature gate, dashboard badge) hits your database. Writes still go to Stripe first — but the outcome is mirrored back via the webhook event Stripe sends milliseconds later.

This is the pattern behind Vercel, Linear, Notion's billing, and Stripe's own example SaaS templates. It is not exotic. It is mandatory.

### Why these four tables specifically

- **`products`** — the things you sell. "Contactly Pro," "Contactly Team." In Stripe's model, a product has a name, a description, and a boolean `active` flag. One product maps to many prices.
- **`prices`** — a specific price point for a product. "$10/month," "$100/year," "€8/month (EU)." A product can have many prices; each subscription points at exactly one price. Prices carry the money: `unit_amount`, `currency`, `interval`, `interval_count`.
- **`customers`** — the one-to-one map between a Supabase user (`profiles.id`) and a Stripe customer (`cus_ABC123`). You create this row the first time a user opens checkout. Without it, Stripe doesn't know who the paying human is.
- **`subscriptions`** — one row per Stripe subscription, with status (`trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`), the price they're on, their billing period boundaries, and cancellation info. This is where feature gating reads from.

These four are the minimum to run a real SaaS. You'll notice we're not mirroring `invoices`, `charges`, or `payment_methods` — those are features you can add later when you actually need them. Principle: **only mirror what you query.** Over-mirroring bloats your schema and webhook handler for imaginary future needs.

---

## Step 2: Create the Migration File

```bash
pnpm supabase migration new billing_tables
```

This creates `supabase/migrations/<timestamp>_billing_tables.sql`. Rename the timestamp prefix to match the order you want (or let the CLI keep today's). Our complete file will end up at `supabase/migrations/20260418000002_billing_tables.sql`.

Open the file. Empty. Let's fill it.

---

## Step 3: The `products` Table — Line by Line

```sql
create table public.products (
  id text primary key,
  name text not null,
  description text,
  active boolean default true,
  metadata jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table public.products enable row level security;
create policy "Products are publicly readable" on public.products for select using (true);
```

### `id text primary key`

Every other table in Contactly uses `uuid` for its primary key. This one uses `text`. Why?

Because **Stripe's product ID is the primary key**. When Stripe creates a product, it gives it an ID like `prod_QT9wH2jYFqA3bB`. That string is what Stripe uses in every webhook payload, in every price's `product` field, in every API response. If we generate our own UUID for it, we have to store the Stripe ID as a separate column, index it, and do a second lookup every time we want to resolve "which product is this price attached to."

Instead, we let Stripe's ID be our primary key. It's already globally unique (Stripe guarantees that). It's already an immutable reference. Storing it as our PK means the natural foreign key — `prices.product_id` pointing at `products.id` — is literally Stripe's identifier, no translation layer.

This is the **"mirrored table" pattern**: for data owned by an external system, use the external system's ID as your primary key. For data owned by *your* app (profiles, contacts, app-specific stuff) use UUIDs.

### `name text not null, description text`

Text fields from Stripe. `name` is required by Stripe (every product has a name); `description` is optional.

### `active boolean default true`

Stripe lets you archive a product. When you click "archive" in the Stripe dashboard, the product stays in your account forever (you can't delete a product that has historical charges against it), but `active` flips to `false`. On the pricing page we'll filter `where active = true`.

### `metadata jsonb`

Stripe products carry a free-form `metadata` dictionary — a JSON map of string keys to string values, up to 50 entries, 500 characters each. Useful for tagging products with app-specific info ("tier": "pro", "seats_max": "10") without inventing extra columns. Mirror it as `jsonb` so Postgres can index into it with `metadata->>'tier'` later.

### `created_at` and `updated_at`

`timestamptz default now() not null` — UTC instants, auto-filled on insert. `updated_at` gets bumped by our webhook handler on every `product.updated` event. We don't use a trigger for this because the service code already has to set `updated_at` explicitly when it upserts from Stripe's payload, and double-setting would be redundant.

### `alter table public.products enable row level security`

Same reflex as always: enable RLS the moment you create the table. A table without RLS is a liability.

### `create policy "Products are publicly readable" on public.products for select using (true)`

This is the first time you're seeing a **public-read** policy. `using (true)` means "the row is visible to any authenticated role the policy is checked against" — including `anon`, the role unauthenticated visitors use. Anyone hitting your pricing page, logged in or not, can read every row.

Why is that safe? Because a product is literally marketing copy. "Contactly Pro." "Unlock unlimited contacts." It's the same text Stripe prints on the Stripe Checkout page. Hiding it serves no purpose and would break the pricing page for logged-out visitors — who are exactly the people you're trying to convert.

RLS isn't "lock everything down." RLS is "be deliberate about who sees what." Public data should be readable by the public. Private data should be scoped. The policy language makes both easy.

---

## Step 4: The `prices` Table — Line by Line

```sql
create table public.prices (
  id text primary key,
  product_id text references public.products(id),
  active boolean default true,
  currency text not null default 'usd',
  type text not null,
  unit_amount bigint,
  interval text,
  interval_count integer default 1,
  lookup_key text unique,
  metadata jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table public.prices enable row level security;
create policy "Prices are publicly readable" on public.prices for select using (true);
```

### `id text primary key`

Same logic as `products`. Stripe's price ID (`price_1PQR...`) is the natural PK.

### `product_id text references public.products(id)`

Foreign key to `products`. Postgres will refuse to insert a price whose `product_id` doesn't exist in `products` — which is the right behavior, but it means our webhook handler has to process `product.created` before `price.created` for the same product. Stripe generally sends them in order, but in rare race conditions it doesn't. We'll handle this in the service layer later by making sure product upserts happen before price upserts in our webhook dispatcher.

### `active boolean default true`

Stripe lets you archive prices (usually when you replace one with a new one after a pricing change). Archived prices still power existing subscriptions, but new subscriptions can't use them. Filter `active = true` on the pricing page.

### `currency text not null default 'usd'`

ISO 4217 three-letter code. Stripe uses lowercase (`usd`, `eur`, `gbp`). Default to `usd` for sanity during local development.

### `type text not null`

Stripe prices are either `one_time` or `recurring`. Most SaaS uses `recurring`; one-time prices are for add-ons ("buy 500 credits for $20"). Storing the type explicitly lets us filter by it on the pricing page (only show recurring prices in the main pricing grid).

### `unit_amount bigint`

**Read this twice.** `unit_amount` is **always in the smallest currency unit** — cents for USD, yen for JPY, etc. A $10 price has `unit_amount = 1000`. Never store money as a `numeric`, `decimal`, or especially `float`. Integers or nothing.

Why `bigint` and not `integer`? Because some currencies have no minor unit (JPY is already integer yen) but can reach large values, and some enterprise plans cost tens of thousands of dollars per month. A signed 32-bit integer caps at ~$21 million — you don't want to discover that ceiling in production. `bigint` (64-bit signed) is effectively unbounded at $92 quadrillion. Use it.

### `interval text, interval_count integer default 1`

Only relevant for recurring prices. `interval` is `day`, `week`, `month`, or `year`. `interval_count` is how many of them — so a "$100 per 3 months" price has `interval = 'month'`, `interval_count = 3`.

### `lookup_key text unique`

This is the single most important column in this table for your future sanity, and we're giving it a `UNIQUE` constraint.

In Module 5 you built a dynamic pricing page. That page needs to ask "what's the Stripe price for the 'pro_monthly' tier?" without hardcoding `price_1PQR...` in your code. Stripe's answer is **lookup keys**: a human-readable string you attach to a price when you create it (`lookup_key: 'pro_monthly'`). Then you can query `stripe.prices.list({ lookup_keys: ['pro_monthly'] })` or, in our mirrored world, `select * from prices where lookup_key = 'pro_monthly'`.

The `UNIQUE` constraint enforces the business invariant that **two different prices cannot share a lookup key**. If they could, your pricing page would silently pick one of them with no guarantee which. A hard DB constraint catches a misconfigured Stripe account on the way in, not three days later when a customer complains.

### `metadata jsonb`

Same pattern as products. Useful for tagging prices with "seats_included", "feature_flags", etc.

### `created_at`, `updated_at`, RLS, public-read policy

All same rationale as `products`. Prices are marketing data; anyone can read them.

---

## Step 5: The `customers` Table — Line by Line

```sql
create table public.customers (
  id uuid references public.profiles(id) on delete cascade primary key,
  stripe_customer_id text unique not null,
  created_at timestamptz default now() not null
);
alter table public.customers enable row level security;
create policy "Users can view own customer record"
  on public.customers for select using (auth.uid() = id);
```

### `id uuid references public.profiles(id) on delete cascade primary key`

Three decisions in one line:

1. **`id uuid`** — not `text` this time, because this row's primary identifier is the *Supabase user*, not a Stripe entity.
2. **`references public.profiles(id)`** — foreign key into `profiles`. The user must exist in our system before we create their Stripe customer record.
3. **`on delete cascade`** — when the user deletes their account and `profiles` gets cascaded away, the customer row disappears automatically. (The matching Stripe customer lives on in Stripe's records for billing history, which is correct; GDPR lets you anonymize but you still keep ledger history.)
4. **`primary key`** — meaning `customers.id` IS `profiles.id`. One customer row per profile; you can't have two customer rows for the same user. This is the strict one-to-one we want.

### `stripe_customer_id text unique not null`

The Stripe ID (`cus_QT9xH...`). `unique` because two Supabase users must not share a Stripe customer — that would mean their payment methods, invoices, and subscriptions all cross-contaminate. `not null` because a customer row with no Stripe ID is meaningless.

### `created_at timestamptz default now() not null`

Useful for auditing: "when was this user first charged-capable?"

### RLS policy

```sql
create policy "Users can view own customer record"
  on public.customers for select using (auth.uid() = id);
```

`auth.uid()` returns the currently authenticated user's UUID. `auth.uid() = id` means "this row's `id` — which IS `profiles.id` — matches me." So a user can read their own `customers` row and no one else's. They cannot read anyone else's Stripe customer ID (which could otherwise enable phishing or impersonation attempts via Stripe Dashboard support tickets).

Notice there's **no INSERT, UPDATE, or DELETE policy**. That's deliberate: the customers table is written *only* by server code using `supabaseAdmin` (the service-role client, which bypasses RLS). A user cannot create or modify their own customer record from the browser — the `getOrCreateCustomer` service does it on their behalf when they first hit checkout. No policy means no write path for the regular user role, which is exactly the security posture we want: writes only happen via trusted server code.

---

## Step 6: The `subscriptions` Table — Line by Line

```sql
create table public.subscriptions (
  id text primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status text not null,
  price_id text references public.prices(id),
  quantity integer default 1,
  cancel_at_period_end boolean default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  created_at timestamptz default now() not null,
  ended_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb
);
alter table public.subscriptions enable row level security;
create policy "Users can view own subscriptions"
  on public.subscriptions for select using (auth.uid() = user_id);
```

### `id text primary key`

Stripe subscription ID (`sub_1PQR...`) as the PK — same mirrored-table pattern as `products` and `prices`.

### `user_id uuid references public.profiles(id) on delete cascade not null`

The owning user. Note it points at `profiles`, not `customers` — even though `customers.id = profiles.id`. Why? Because not every subscription has a customer row visible to us at creation time (edge cases: subscriptions created via the Stripe dashboard by your support team for a specific user). Pointing at `profiles` directly removes that fragility. The `customers` table is our "has this user ever paid?" lookup; `subscriptions.user_id` is authoritative for ownership regardless.

`on delete cascade` — if the user's profile is deleted, their subscription rows are deleted too. Stripe keeps the historical subscription in its own records forever (we never call `stripe.subscriptions.del` from cascade); we just remove our local mirror.

### `status text not null`

Stripe subscription statuses: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`. We store the raw string. Feature gating in the app checks `status in ('trialing', 'active')`.

Could we use a Postgres ENUM? Yes, and Stripe's Node types even give us a union type for it. But enums are a schema-migration trap: if Stripe adds a new status (they have, historically), your ENUM has to be updated via a migration before the webhook handler can write the new value. A plain `text` column absorbs new statuses silently, and we validate at the service-code layer where we can add a telemetry warning for unknown statuses. Flexibility > strictness at the DB boundary for external-API mirrors.

### `price_id text references public.prices(id)`

The price the user is on. Foreign-keyed to `prices` so we can join for pricing display. Nullable because technically Stripe lets a subscription have multiple items, each with its own price; if we ever support multi-price subs we'd null this out and read from an `items` subtable. For now, Contactly is single-price-per-subscription and this column is always set by the webhook handler.

### `quantity integer default 1`

For per-seat pricing ("10 seats × $10/month = $100/month"). We default to 1 because nearly all our prices will be flat-rate.

### `cancel_at_period_end boolean default false`

Stripe's cancellation flow: when a user clicks "cancel subscription," Stripe flags `cancel_at_period_end = true` but **does not** cancel immediately. They keep access through the end of the current period, then the status flips to `canceled`. This column powers the "Your subscription will end on DATE" banner in the UI.

### `cancel_at timestamptz, canceled_at timestamptz`

- `cancel_at` — when the scheduled cancellation will take effect (usually equals `current_period_end` when `cancel_at_period_end = true`).
- `canceled_at` — when cancellation was *requested*. Could be earlier than `cancel_at`.

Both nullable because unscheduled subscriptions have neither.

### `current_period_start timestamptz not null, current_period_end timestamptz not null`

The current billing period. `[current_period_start, current_period_end)` is the half-open interval during which the user has paid-up access. Feature gates check `current_period_end > now()`. These get bumped every time Stripe sends an `invoice.paid` event.

Two things to flag here. First, Stripe v22 moved these fields off the `Subscription` object and onto `SubscriptionItem` — we'll deal with that in lesson 7.4 when we write the upsert code. In the database, we still store them at the subscription level because Contactly is single-item (one price per sub). Second, they're `not null` because without a valid billing period window, the subscription is meaningless.

### `ended_at timestamptz`

When the subscription was fully terminated (after cancellation, after trial expired without conversion, etc.). Nullable because active subscriptions have no end.

### `trial_start timestamptz, trial_end timestamptz`

Trial period boundaries, nullable because most subscriptions have no trial.

### `metadata jsonb`

Stripe-side metadata. Useful for carrying things like `promo_code`, `referrer`, `original_signup_tier`.

### RLS policy

```sql
create policy "Users can view own subscriptions"
  on public.subscriptions for select using (auth.uid() = user_id);
```

Every user sees only their own subscriptions. Again no INSERT/UPDATE/DELETE policies — only `supabaseAdmin` (in webhook handlers) writes here.

### Why not also policy for status queries?

You might wonder: shouldn't we add an index on `(user_id, status)` since the app will constantly query "does this user have an active subscription?" Yes, eventually. We'll add it in a later performance pass once we can measure actual query patterns. `user_id` being a foreign key gives us a single-column index for free; for Contactly's scale that's sufficient until we have tens of thousands of users. Over-indexing early costs write performance and storage without measurable read wins.

---

## Step 7: The Full Migration

Here's the complete file:

```sql
-- supabase/migrations/20260418000002_billing_tables.sql

create table public.products (
  id text primary key,
  name text not null,
  description text,
  active boolean default true,
  metadata jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table public.products enable row level security;
create policy "Products are publicly readable" on public.products for select using (true);

create table public.prices (
  id text primary key,
  product_id text references public.products(id),
  active boolean default true,
  currency text not null default 'usd',
  type text not null,
  unit_amount bigint,
  interval text,
  interval_count integer default 1,
  lookup_key text unique,
  metadata jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table public.prices enable row level security;
create policy "Prices are publicly readable" on public.prices for select using (true);

create table public.customers (
  id uuid references public.profiles(id) on delete cascade primary key,
  stripe_customer_id text unique not null,
  created_at timestamptz default now() not null
);
alter table public.customers enable row level security;
create policy "Users can view own customer record"
  on public.customers for select using (auth.uid() = id);

create table public.subscriptions (
  id text primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status text not null,
  price_id text references public.prices(id),
  quantity integer default 1,
  cancel_at_period_end boolean default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  created_at timestamptz default now() not null,
  ended_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb
);
alter table public.subscriptions enable row level security;
create policy "Users can view own subscriptions"
  on public.subscriptions for select using (auth.uid() = user_id);
```

Save the file.

---

## Step 8: Apply the Migration

```bash
pnpm supabase db reset
```

`db reset` drops the local database, replays every migration in order, and runs `seed.sql`. You'll see the four new tables appear in the output. Open Studio at `http://localhost:54323` → Database → Tables:

- `products` (0 rows) — RLS on, one public-read policy
- `prices` (0 rows) — RLS on, one public-read policy
- `customers` (0 rows) — RLS on, one user-scoped policy
- `subscriptions` (0 rows) — RLS on, one user-scoped policy

Click each table's **RLS policies** tab and confirm the right policies exist with the right expressions.

---

## Step 9: Regenerate TypeScript Types

```bash
pnpm supabase gen types typescript --local > src/lib/types/database.types.ts
```

After this runs, your generated `Database` type has four new table entries. Any `supabase.from('products')`, `supabase.from('prices')`, `supabase.from('customers')`, or `supabase.from('subscriptions')` call will autocomplete every column exactly as we defined it. If we rename `unit_amount` later, every reference in your app becomes a compile error until you fix it. That's the safety net.

Open `src/lib/types/database.types.ts` briefly and search for `subscriptions` — you'll see the Row, Insert, and Update types generated from the schema. That's the shape the rest of Module 7 will consume.

---

## Common Mistakes

### Mistake 1: Storing money as `numeric` or `float`

```sql
-- WRONG
unit_amount numeric(10, 2),
```

Floating-point arithmetic is not exact. Ten cents plus twenty cents is not always thirty cents in float-land. Stripe stores money in integer minor units exclusively; mirror that. `bigint` unit_amount in cents is the only correct answer.

### Mistake 2: Using UUIDs for Stripe-mirrored tables

```sql
-- WRONG
create table public.products (
  id uuid default gen_random_uuid() primary key,
  stripe_product_id text unique not null,
  ...
);
```

Now every query that wants to resolve "the product for this price" has to do an extra join through `stripe_product_id`. It's pointless indirection. For tables that mirror an external system, use the external ID as the PK. Period.

### Mistake 3: Forgetting `enable row level security`

Same as every other table in this course: RLS off means the table is wide open. Supabase Studio even shows a warning icon when a table has no RLS. Don't ignore it.

### Mistake 4: Writing an INSERT/UPDATE policy for `customers` or `subscriptions`

Tempting: "Users should be able to insert their own customer record." **No.** The customer record is created by the billing service on the server, using the admin client, in response to a checkout flow. The user never inserts it from the browser — there's nothing about the Stripe customer that should be user-controlled. Omitting write policies is a *feature*; it means the table is read-only to everyone except the trusted service code.

### Mistake 5: Dropping the `UNIQUE` on `lookup_key`

```sql
-- WRONG
lookup_key text,
```

Now two prices can share `lookup_key = 'pro_monthly'`. Your pricing page will intermittently show the wrong price depending on row order. The bug surfaces in production on a Tuesday. `UNIQUE` enforces a business invariant — use it.

### Mistake 6: Referencing `auth.users` from `customers`

```sql
-- WRONG
id uuid references auth.users(id) ...
```

Same lesson as Module 4: `auth` is Supabase's internal schema. Always go through `profiles`. Every table in your application references `profiles`, never `auth.users` directly.

### Mistake 7: Forgetting to regenerate types

You ran the migration but forgot `pnpm supabase gen types typescript --local`. The rest of the module you're going to write `supabase.from('subscriptions').upsert({ ... })` and TypeScript has no idea those tables exist, so it inferrs `any`. You lose every type-safety benefit. Regenerate types every time you touch a migration. Consider adding this to a `db:sync` script in package.json so `pnpm db:sync` is one command.

---

## Principal Engineer Notes

### The "mirrored table" vs "native table" pattern

You now have two distinct categories of tables in Contactly's schema:

- **Native tables** — `profiles`, `contacts`. Owned by Contactly. UUID primary keys. User-writable via RLS policies that scope by `user_id`. Source of truth lives in Postgres.
- **Mirrored tables** — `products`, `prices`, `customers`, `subscriptions`. Owned by an external system (Stripe). External IDs as primary keys. Never user-writable directly; only the webhook service layer writes via `supabaseAdmin`. Source of truth lives in Stripe; Postgres is a cache.

These categories have *different rules*. Different RLS shape. Different write paths. Different indexing priorities. When someone says "just add a table," the first question is which category it belongs to — because the answer changes the whole design.

### `UNIQUE` as a business invariant

`lookup_key text unique` is not a data-integrity detail. It's a **business invariant** expressed as a database constraint. Business invariants — "every price has at most one lookup key," "every user has at most one customer record," "every subscription has exactly one user" — belong in the database, enforced by constraints, because:

1. The database is the last line of defense. App code has bugs; constraints don't.
2. Constraints are self-documenting. Reading the schema tells you the business rules.
3. Constraint violations fail fast and loud. Silent drift corrupts data for weeks before anyone notices.

When designing a table, ask: "what would it mean if this column repeated? If that column were null? If this FK pointed nowhere?" Every answer that's "that would be a bug" should become a constraint.

### Indexing strategy for subscription status queries

The app will run queries like:

```sql
select * from subscriptions
where user_id = $1 and status in ('active', 'trialing')
order by current_period_end desc
limit 1;
```

That's the "is this user a paying customer right now?" query that powers every feature gate. Under the default indexes (just the FK on `user_id`), it works fine until you have hundreds of thousands of subscription rows.

When you get there — not now — add:

```sql
create index subscriptions_user_active_idx
  on public.subscriptions (user_id, status, current_period_end desc);
```

This is a **composite index** tuned for the exact query shape. It lets Postgres satisfy the query with an index-only scan: no table reads at all. For Contactly's scale, you'll add this around the time you have 10k paying users. Until then, the FK index is plenty.

The broader principle: **don't index preemptively**. Measure first. Over-indexing inflates write cost (every INSERT touches every index) without a corresponding read benefit.

### Why no `invoices` or `charges` tables

You might wonder: shouldn't we also mirror invoices? Stripe sends `invoice.paid`, `invoice.payment_failed`, etc. webhooks. If the user asks "show me my billing history," wouldn't we need an `invoices` table?

You *could* mirror it. But for Contactly's needs today:

1. **"Show me my billing history"** — solved by redirecting the user to the Stripe Customer Portal, which Stripe hosts and maintains. Zero code on our side.
2. **"Has this invoice been paid?"** — relevant only for `past_due` subscription flows, which we handle via `subscription.status` directly.
3. **Revenue reporting** — better done by exporting from Stripe into an analytics tool (Stripe Sigma, BigQuery via Fivetran), not by mirroring into your transactional database.

Invoices and charges are high-volume, mostly append-only data that lives better in a separate analytics store. Don't pollute your transactional schema with data you won't query transactionally.

### Why `customers.id` shares the primary key with `profiles.id`

In some schema designs, you'd see `customers` with its own UUID primary key and a separate `user_id uuid references profiles(id) unique`. That's more columns, more joins, no additional flexibility.

Making `customers.id = profiles.id` enforces the one-to-one relationship at the schema level: it's structurally impossible to have two customer rows for the same user because the primary key is the user's ID. You also save a column and an index.

The tradeoff: if Stripe ever supports "one user with multiple Stripe customers" (say, a business and personal account), we'd have to migrate. But that's an edge case Contactly won't hit for years, and the migration is straightforward when it comes. Optimize for today's shape.

---

## Summary

- Created four billing tables — `products`, `prices`, `customers`, `subscriptions` — in a single migration.
- Used Stripe IDs (`text`) as primary keys for mirrored tables, UUIDs for native ownership.
- Enabled RLS on every table with intentional policies: public-read for marketing data, user-scoped read for sensitive data, no user writes on any billing table.
- Stored money as `bigint` unit amounts in cents, never as floats.
- Added `UNIQUE` on `lookup_key` as a business invariant enforcement.
- Regenerated TypeScript types so the rest of Module 7 is strongly typed.
- Internalized the "mirrored vs native table" pattern — these billing tables have different rules than `contacts` or `profiles`.

## What's Next

The tables are empty. They'll stay empty until something writes to them — and that something is the webhook handler, which arrives at every Stripe event and dispatches to the right service function. In Lesson 7.2 you'll build the first of those services: `products.service.ts`, with a single idempotent `upsertProduct` function, called from the `product.created` and `product.updated` webhook cases. That lesson introduces the service-layer pattern you'll reuse for customers, subscriptions, and any future billing entity you care to mirror.
