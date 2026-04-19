-- =====================================================================
-- Billing service tables — Module 7.1.
-- =====================================================================
--
-- Module 6.4 laid the *foundation* (stripe_customers + stripe_events).
-- This migration lands the three tables that turn raw Stripe webhook
-- traffic into a queryable local model:
--
--   1. `stripe_products`       — mirror of Stripe `prod_…`. Hydrated
--                                from the `product.created/updated`
--                                webhook stream (Module 7.2).
--
--   2. `stripe_prices`         — mirror of Stripe `price_…`. Hydrated
--                                from the `price.created/updated`
--                                webhook stream. The pricing page
--                                (Module 8.4) reads this table, not
--                                the Stripe API.
--
--   3. `stripe_subscriptions`  — mirror of Stripe `sub_…`. Hydrated
--                                from `customer.subscription.*`
--                                webhooks (Module 7.4). Per ADR-002
--                                a subscription belongs to a USER
--                                (not an organization).
--
-- WHY MIRROR INSTEAD OF QUERY-ON-DEMAND
-- -------------------------------------
-- Every page in the authenticated app needs to know "what tier is
-- this user?" — the contact-list cap, the export button, the seat
-- count display. Resolving that by hitting `stripe.subscriptions.list`
-- on every request would:
--   - add 100-300ms latency to every page render
--   - blow our Stripe API budget on read-only traffic
--   - couple page-render uptime to Stripe's uptime
--
-- Mirroring is the standard Stripe-shop pattern (Vercel, Linear,
-- Notion all do it). The webhooks ARE the source of truth for "what
-- changed"; this table is the source of truth for "what is the
-- current state right now."
--
-- ENTITLEMENTS LIVE WHERE?
-- ------------------------
-- The mapping from "active subscription with price X" to "user has
-- tier Y" is derived in code (`tierForUser` helper, Module 7.4)
-- against the lookup-keys constants from Lesson 5.6 — NOT stored as a
-- column on `stripe_subscriptions`. Two reasons:
--   1. Stripe's `metadata.tier` could drift from our app's notion of
--      tiers; the code-side resolution catches that drift loudly.
--   2. A future tier rename ("Business" → "Team") only touches code
--      and lookup-keys, never a million subscription rows.
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- stripe_products
-- ---------------------------------------------------------------------
create table public.stripe_products (
	-- Stripe's `prod_…` id. We use it as PK directly (saves a column
	-- + a unique index) and as the FK target from `stripe_prices`.
	id text primary key,

	-- Stripe `active` flag. Archived products are kept here so a
	-- subscription that still references one can render its name on
	-- the customer's invoice screen.
	active boolean not null default true,

	name text not null,
	description text,

	-- The full Stripe `metadata` map. The pricing page reads
	-- `metadata->>'tier'` and `metadata->>'tier_rank'` to render the
	-- plan ladder; storing the whole map means a future metadata
	-- field doesn't need a schema migration.
	metadata jsonb not null default '{}'::jsonb,

	-- Stripe Tax classification (txcd_…). Same idea as `metadata`:
	-- here for future Tax-related lookups without a column add.
	tax_code text,

	-- Tracks the Stripe `created` / `updated` timestamps as
	-- timestamptz — useful for "show me products created in the
	-- last 30 days" debugging queries.
	stripe_created_at timestamptz,
	stripe_updated_at timestamptz,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint stripe_products_id_format
		check (id ~ '^prod_[A-Za-z0-9_]+$')
);

create index stripe_products_active_idx on public.stripe_products (active);

create trigger stripe_products_set_updated_at
	before update on public.stripe_products
	for each row
	execute function public.set_updated_at();

comment on table public.stripe_products is
	'Local mirror of Stripe `prod_…`. Hydrated by the product.* '
	'webhook handlers (Module 7.2). The pricing page reads from '
	'this table, never from the live Stripe API.';

-- ---------------------------------------------------------------------
-- stripe_prices
-- ---------------------------------------------------------------------
create type public.stripe_billing_interval as enum ('day', 'week', 'month', 'year');
create type public.stripe_price_type as enum ('one_time', 'recurring');

create table public.stripe_prices (
	-- Stripe's `price_…` id. PK + FK target.
	id text primary key,

	product_id text not null
		references public.stripe_products (id) on delete cascade,

	active boolean not null default true,

	-- Stripe `lookup_key` is our stable handle (Lesson 5.6). NOT
	-- nullable in practice for paid Contactly prices — a runtime
	-- check in the products service refuses to mirror a price
	-- without one. The column itself is nullable because Stripe
	-- *allows* it to be (legacy / single-use prices) and the mirror
	-- table is a faithful copy.
	lookup_key text,

	-- Cents. Always integer. NEVER store decimal currency in
	-- floats — every Stripe-shop bug-list has a story about this.
	unit_amount integer,

	currency text not null,

	type public.stripe_price_type not null,

	-- Recurrence. NULL when `type = 'one_time'`. The `interval` /
	-- `interval_count` pair represents "every N <interval>s" — for
	-- Contactly this is always (1, month) or (1, year), but the
	-- column shape matches Stripe's full surface.
	recurring_interval public.stripe_billing_interval,
	recurring_interval_count integer,

	tax_behavior text,

	metadata jsonb not null default '{}'::jsonb,

	stripe_created_at timestamptz,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint stripe_prices_id_format
		check (id ~ '^price_[A-Za-z0-9_]+$'),
	constraint stripe_prices_recurring_consistency
		check (
			(type = 'one_time' and recurring_interval is null and recurring_interval_count is null)
			or (type = 'recurring' and recurring_interval is not null and recurring_interval_count is not null)
		)
);

-- Hot-path lookups:
--   - "find the price for lookup_key X" (pricing page, checkout)
--   - "all active prices on product Y" (plan rendering)
create unique index stripe_prices_lookup_key_unique
	on public.stripe_prices (lookup_key)
	where lookup_key is not null;
create index stripe_prices_product_id_idx on public.stripe_prices (product_id);
create index stripe_prices_active_idx on public.stripe_prices (active);

create trigger stripe_prices_set_updated_at
	before update on public.stripe_prices
	for each row
	execute function public.set_updated_at();

comment on table public.stripe_prices is
	'Local mirror of Stripe `price_…`. Code references prices by '
	'`lookup_key` (Lesson 5.6), never by the rotating `price_…` id. '
	'Hydrated by the price.* webhook handlers (Module 7.2).';

-- ---------------------------------------------------------------------
-- stripe_subscriptions
--
-- Per ADR-002, subscriptions belong to USERS (not organizations).
-- The FK is on `user_id`; an organization-wide tier is derived from
-- the acting user's subscription, never from an org-level row.
-- ---------------------------------------------------------------------
create type public.stripe_subscription_status as enum (
	-- Mirrors Stripe's full `Subscription.status` union exactly.
	-- Adding a value requires a Stripe-side change first, so this
	-- enum can lag — mirror writes that encounter an unknown status
	-- log + skip rather than crash (see subscriptions service tests).
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused'
);

create table public.stripe_subscriptions (
	-- Stripe's `sub_…` id. PK so the storage layer dedupes naturally
	-- if two webhook deliveries race for the same subscription.
	id text primary key,

	user_id uuid not null
		references public.profiles (id) on delete cascade,

	stripe_customer_id text not null,

	status public.stripe_subscription_status not null,

	-- Denormalized for hot-path rendering ("you're on Pro Monthly,
	-- renews 2026-05-19") without a join to stripe_prices on every
	-- page. Updated whenever the subscription's price changes.
	price_id text not null
		references public.stripe_prices (id) on delete restrict,

	cancel_at_period_end boolean not null default false,

	-- All these are in seconds-since-epoch in Stripe's payload; we
	-- convert to timestamptz at the mirror boundary so SQL filters
	-- like "renewals due this week" are natural to write.
	current_period_start timestamptz,
	current_period_end timestamptz,
	trial_start timestamptz,
	trial_end timestamptz,
	canceled_at timestamptz,
	cancel_at timestamptz,

	-- Snapshot of `metadata.tier` from the *price* at the time of
	-- last sync. NOT used for entitlement decisions (those flow
	-- through the lookup-keys helper in code) — kept for audit and
	-- to make the SQL "how many users on each tier" query trivial.
	tier_snapshot text,

	stripe_created_at timestamptz,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint stripe_subscriptions_id_format
		check (id ~ '^sub_[A-Za-z0-9_]+$')
);

-- Most common query: "what's the active subscription for user X?"
-- A user can only have ONE non-canceled subscription at a time
-- (enforced by the customer service in Module 7.3, which refuses to
-- create a Checkout Session if the user already has an active one).
-- The partial unique index makes that constraint a database-level
-- guarantee, not just an application convention.
create unique index stripe_subscriptions_one_active_per_user
	on public.stripe_subscriptions (user_id)
	where status in ('trialing', 'active', 'past_due');

create index stripe_subscriptions_user_id_idx
	on public.stripe_subscriptions (user_id);
create index stripe_subscriptions_stripe_customer_id_idx
	on public.stripe_subscriptions (stripe_customer_id);
create index stripe_subscriptions_status_idx
	on public.stripe_subscriptions (status);

create trigger stripe_subscriptions_set_updated_at
	before update on public.stripe_subscriptions
	for each row
	execute function public.set_updated_at();

comment on table public.stripe_subscriptions is
	'Local mirror of Stripe `sub_…`. Per ADR-002, scoped to user, '
	'not organization. Hydrated by customer.subscription.* webhook '
	'handlers (Module 7.4). Entitlement resolution (`tierForUser`) '
	'reads from this table.';

-- ---------------------------------------------------------------------
-- RLS — products + prices are public-read, write is service-role only
--
-- The pricing page is unauthenticated, so anonymous users must be
-- able to SELECT both tables. Modifications are only ever performed
-- by the webhook handler (service-role bypasses RLS).
-- ---------------------------------------------------------------------
alter table public.stripe_products enable row level security;
alter table public.stripe_prices enable row level security;

create policy "products are world-readable"
	on public.stripe_products
	for select
	to anon, authenticated
	using (true);

create policy "prices are world-readable"
	on public.stripe_prices
	for select
	to anon, authenticated
	using (true);

-- ---------------------------------------------------------------------
-- RLS — subscriptions are private to their owning user
-- ---------------------------------------------------------------------
alter table public.stripe_subscriptions enable row level security;

create policy "users read their own subscription"
	on public.stripe_subscriptions
	for select
	to authenticated
	using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE for `authenticated`. The webhook
-- handler is the sole writer; service_role bypasses RLS.
