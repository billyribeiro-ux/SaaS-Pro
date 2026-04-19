-- =====================================================================
-- Stripe billing storage — Module 6.4.
-- =====================================================================
--
-- Lays the two foundation tables every later billing lesson reads from
-- or writes to:
--
--   1. `stripe_customers`   — one-to-one user ↔ Stripe Customer
--                             mapping. Per ADR-002, billing belongs to
--                             the *user*, not the organization. The
--                             Stripe Customer is created lazily on the
--                             user's first checkout (Module 7.3) and
--                             persists for the lifetime of the account.
--
--   2. `stripe_events`      — webhook idempotency dedupe. Every
--                             inbound `evt_…` we successfully verify
--                             goes here, with the event id as PRIMARY
--                             KEY. The handler tries to insert FIRST;
--                             on `unique_violation` it returns 200
--                             without re-running the dispatcher. This
--                             is the "storage layer" half of the
--                             two-layer idempotency story from
--                             Lesson 6.2 — the "logic layer" half is
--                             that each individual handler is itself
--                             written to be reentrant.
--
-- Subscription mirroring (`subscriptions` table) intentionally lands
-- in a *separate* migration in Module 7.4. Two reasons:
--   - The shape of `subscriptions` depends on entitlement decisions
--     we haven't taken yet (Module 7.2 ADR).
--   - Keeping migrations small means a student rewinding to a previous
--     lesson tag has a small, focused diff to read.
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- stripe_customers
-- ---------------------------------------------------------------------
create table public.stripe_customers (
	-- The Supabase user this Stripe Customer represents. PK + FK in
	-- one move because the relationship is strictly one-to-one
	-- (ADR-002): a user has zero-or-one Stripe Customer; a Stripe
	-- Customer maps to exactly one user. Cascade on user delete so
	-- the row goes when the account does.
	user_id uuid primary key
		references public.profiles (id) on delete cascade,

	-- The `cus_…` id Stripe issues when we first call
	-- `stripe.customers.create({ email, metadata: { user_id } })`.
	-- Format check is permissive (Stripe sometimes prefixes with
	-- `cus_test_` in restricted environments).
	stripe_customer_id text not null,

	-- Snapshot of the email we sent to Stripe at creation time.
	-- Useful for audit ("which email did Stripe think this user had
	-- in March?") even after the user changes their email locally.
	-- The source of truth for "current email" is `auth.users.email`,
	-- not this column.
	email text,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint stripe_customers_id_format
		check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$')
);

-- Reverse lookup: "given a Stripe Customer id from a webhook, find
-- the user." Hot path for every subscription event handler.
create unique index stripe_customers_stripe_customer_id_unique
	on public.stripe_customers (stripe_customer_id);

create trigger stripe_customers_set_updated_at
	before update on public.stripe_customers
	for each row
	execute function public.set_updated_at();

comment on table public.stripe_customers is
	'One-to-one mapping from Supabase user → Stripe Customer (cus_…). '
	'Created lazily on a user''s first checkout (Module 7.3). Per '
	'ADR-002, billing is per-user, not per-organization.';

-- ---------------------------------------------------------------------
-- RLS — stripe_customers
--
-- This table is service-role-only for writes (the webhook handler
-- runs as service role; users never write it directly). For reads:
-- a user can SELECT their own row (so we can render "you're a
-- customer of Stripe since 2026-04-19" in account settings without
-- piping through the server every time).
-- ---------------------------------------------------------------------
alter table public.stripe_customers enable row level security;

create policy "users read their own stripe_customer mapping"
	on public.stripe_customers
	for select
	to authenticated
	using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE policy for `authenticated`. Service
-- role bypasses RLS, which is what the webhook handler needs.

-- ---------------------------------------------------------------------
-- stripe_events
--
-- The audit + idempotency dedupe table for inbound Stripe webhooks.
-- Every event we successfully verify gets one row, regardless of
-- whether our dispatcher had a handler for its type. This gives us
-- two valuable properties:
--
--   1. Replaying the same event-id is a no-op (PK collision → 200).
--   2. We can `select count(*) from stripe_events where type = 'X'`
--      to see what Stripe is actually sending us, independent of the
--      Dashboard's view.
--
-- Schema notes:
--   - `id` is the Stripe event id (`evt_…`). Use it as PK directly,
--     not a synthetic uuid — saves a column AND the unique index.
--   - `payload jsonb` stores the full event so we can re-derive any
--     downstream side effect from the audit table during a backfill.
--     This costs ~1KB per event; over a year of webhook traffic that
--     is a few MB. Cheap insurance.
--   - `received_at` is when WE saw it (server clock); `created` from
--     the event payload is when STRIPE issued it. The skew between
--     them is sometimes interesting during incident review.
--   - `processed_at` is null until the dispatcher returns successfully.
--     A row with `processed_at IS NULL` and `received_at < now() - 5m`
--     is a stuck event and worth alerting on. Module 12 wires up
--     observability on this column.
-- ---------------------------------------------------------------------
create table public.stripe_events (
	id text primary key,
	type text not null,
	payload jsonb not null,
	received_at timestamptz not null default now(),
	processed_at timestamptz,
	livemode boolean not null,
	api_version text,

	constraint stripe_events_id_format
		check (id ~ '^evt_[A-Za-z0-9_]+$')
);

-- "All events of type X in the last hour" — common during incident
-- triage. Without this index it's a sequential scan over (eventually)
-- millions of rows.
create index stripe_events_type_received_at_idx
	on public.stripe_events (type, received_at desc);

-- "Stuck events" — see comment above.
create index stripe_events_unprocessed_idx
	on public.stripe_events (received_at)
	where processed_at is null;

comment on table public.stripe_events is
	'Audit + idempotency table for verified Stripe webhook events. '
	'Insert-first dispatch: a unique violation on the PK means we''ve '
	'already processed this delivery and return 200 without re-running '
	'side effects. See docs/stripe/11-what-data-to-store.md.';

-- ---------------------------------------------------------------------
-- RLS — stripe_events
--
-- This table is purely operational; users have no business reading
-- it. Enable RLS with no policies → only service_role (which
-- bypasses RLS) can touch it.
-- ---------------------------------------------------------------------
alter table public.stripe_events enable row level security;
