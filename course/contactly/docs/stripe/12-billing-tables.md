# 12 — Billing Tables (Module 7.1)

Module 6 ended with a webhook receiver that **verifies, deduplicates,
and audits** every Stripe event. The receiver currently dispatches to
`console.info` stubs — nothing in our database actually changes when a
subscription is created, a price is updated, or a trial ends.

Before we wire those handlers to real side-effects (Modules 7.2–7.4),
we need somewhere to write. This lesson lands the three mirror tables
that turn a webhook stream into queryable application state:

| Table                  | Mirrors   | Read-side consumer                                                     |
| ---------------------- | --------- | ---------------------------------------------------------------------- |
| `stripe_products`      | `prod_…`  | Pricing page (Module 8.4), invoice rendering, audit                    |
| `stripe_prices`        | `price_…` | Pricing page, Checkout session creation, lookup-key resolution         |
| `stripe_subscriptions` | `sub_…`   | Every authenticated page (`tierForUser`), portal redirect, trial logic |

This is the **catalog** + **state** layer. Customers + events live in
the previous migration; these three are everything else billing needs.

## The mirroring philosophy

Why mirror at all? Why not call `stripe.subscriptions.list({ customer })`
on every page render? Three reasons, in order of importance:

1. **Latency.** A round-trip to Stripe US-East from a Vercel edge node
   is 80–250 ms on a warm path, 600+ on a cold one. Doing that on
   every render of the dashboard adds latency you can't optimize away.
   A SELECT against a Postgres index is 1–4 ms.

2. **Stripe API budget.** The default rate limit is 100 read req/s in
   live mode, 25 in test mode. A mid-traffic SaaS will trip it on a
   bad afternoon. Read-from-DB consumes zero of that budget.

3. **Independent uptime.** Stripe's quarterly availability is excellent
   but not 100%. When `api.stripe.com` is degraded, your _checkout_
   flow has to fail (Stripe is the source of truth for "can this card
   be charged"). Your _dashboard render_ does not — and shouldn't.

The mirror is **eventually consistent** — a `customer.subscription.updated`
event takes ~50–500 ms to traverse Stripe → webhook receiver → Postgres.
That window is acceptable for entitlement reads; the rare cases that
need read-after-write consistency (the post-checkout success page) read
from the Stripe API directly with the freshly-issued session id.

## Schema highlights

### `stripe_products`

```sql
id text primary key,         -- prod_…  (used as PK directly)
active boolean,
name text,
description text,
metadata jsonb,              -- whole map: tier, tier_rank, …
tax_code text,
stripe_created_at timestamptz,
stripe_updated_at timestamptz,
created_at / updated_at timestamptz
```

We store the **whole `metadata` map as `jsonb`** rather than promoting
each field to a column. Stripe metadata is open-ended and we'd rather
add a key in the dashboard + read it from `metadata->>'newkey'` than
ship a migration every time marketing wants to add a flag.

The `id` constraint (`prod_[A-Za-z0-9_]+`) is an early-warning system:
if a webhook ever delivers a bogus id (which has happened in the wild
during Stripe Test Mode incidents), the insert fails loudly instead of
poisoning the table.

### `stripe_prices`

```sql
id text primary key,                       -- price_…
product_id text references stripe_products,
active boolean,
lookup_key text,                           -- our stable handle
unit_amount integer,                       -- cents, NEVER float
currency text,
type stripe_price_type,                    -- one_time | recurring
recurring_interval stripe_billing_interval,
recurring_interval_count integer,
tax_behavior text,
metadata jsonb,
…
```

Two table-level constraints worth highlighting:

- **`stripe_prices_recurring_consistency`** ensures the `recurring_*`
  fields are populated iff `type = 'recurring'`. This catches a class
  of bugs where a refactor forgets to clear the recurrence on a
  one-time price (or vice versa) and leaves an internally inconsistent
  row.

- **`stripe_prices_lookup_key_unique`** is a _partial_ unique index
  (`where lookup_key is not null`). Stripe enforces uniqueness on
  lookup keys per-account; we mirror that invariant locally so the
  pricing page's `select … where lookup_key = $1` is guaranteed to
  return at most one row.

### `stripe_subscriptions`

```sql
id text primary key,                       -- sub_…
user_id uuid references profiles,          -- ADR-002: user, not org
stripe_customer_id text,
status stripe_subscription_status,         -- enum
price_id text references stripe_prices,    -- denormalized for hot path
cancel_at_period_end boolean,
current_period_start / _end timestamptz,
trial_start / trial_end timestamptz,
canceled_at / cancel_at timestamptz,
tier_snapshot text,                        -- audit only
…
```

The most consequential design choice here is the
**`stripe_subscriptions_one_active_per_user`** partial unique index:

```sql
create unique index stripe_subscriptions_one_active_per_user
    on public.stripe_subscriptions (user_id)
    where status in ('trialing', 'active', 'past_due');
```

It says: _a user can have at most one non-canceled subscription at a
time._ The customer service (Module 7.3) refuses to create a Checkout
Session if the user already has one — but defense in depth: even if
that check is bypassed by a bug or a manual `stripe.subscriptions.create`
call, the database itself rejects the second concurrent subscription
write. This is the kind of constraint you want to enforce at the
lowest level possible, because the failure mode (a customer billed
twice) is one of the most expensive support tickets you can generate.

`tier_snapshot` deserves a note: it's an **audit** column, not an
**entitlement** column. Module 7.4 (`tierForUser`) resolves the user's
tier by joining through `stripe_prices` to look up the lookup-key in
the constants from Lesson 5.6 — _not_ by reading `tier_snapshot`. The
snapshot is here so:

- A future tier rename (`Business → Team`) is a code-only change; you
  don't have to re-process every row.
- A SQL-side analytics query (`select tier_snapshot, count(*) from
stripe_subscriptions where status = 'active' group by 1`) works
  without joins.

## RLS policy

| Table                  | `select` policy                       | Writes  |
| ---------------------- | ------------------------------------- | ------- |
| `stripe_products`      | World-readable (anon + authenticated) | service |
| `stripe_prices`        | World-readable (anon + authenticated) | service |
| `stripe_subscriptions` | Owner-only (`user_id = auth.uid()`)   | service |

Products and prices are world-readable because the **pricing page is
unauthenticated** — a visitor evaluating the product needs to see the
plan ladder before signing up. There's no information leakage here:
the same data is visible at `https://buy.stripe.com/<your_link>`.

Subscriptions are scoped to their owning user. RLS guarantees that a
compromised JWT for user A can never read user B's billing state, even
through the public Supabase REST API. The webhook handler writes via
the service-role client (which bypasses RLS by design — this is the
_only_ code path that should be making writes here).

## Why no `INSERT/UPDATE/DELETE` policies?

Notice we add `select` policies for the user-facing reads but no write
policies anywhere. That's intentional — the absence of a policy on a
table with RLS enabled means **the operation is denied**. The webhook
handler is the sole writer to all three tables, and it uses the
`service_role` key (which bypasses RLS by design). Application code
that runs as `authenticated` literally cannot mutate billing state, no
matter what bug we introduce in a `+page.server.ts`. That's the
property we want.

## What's next

These tables are inert until something writes to them. The next three
lessons fill them:

- **Module 7.2 — Products Service.** A backfill helper plus webhook
  handlers for `product.created/updated/deleted` and
  `price.created/updated/deleted`. After this lesson, running
  `pnpm run stripe:fixtures` causes the rows to appear in
  `stripe_products` and `stripe_prices` automatically.

- **Module 7.3 — Customers Service.** `ensureStripeCustomer(userId)`
  — the lazy creation flow that produces a Stripe `cus_…` for a user
  the first time they head to checkout, caches the mapping in
  `stripe_customers`, and handles the `customer.created/updated/deleted`
  webhook stream so out-of-band dashboard edits stay in sync.

- **Module 7.4 — Subscriptions Service.** Webhook handlers for the
  full `customer.subscription.*` stream that write to
  `stripe_subscriptions`, plus the `getActiveSubscription(userId)` and
  `tierForUser(userId)` helpers that every authenticated page in the
  app will read.

By the end of Module 7, the dispatch table from Lesson 6.3 has every
stub replaced with a real handler and the database is the source of
truth for "who is subscribed to what."
