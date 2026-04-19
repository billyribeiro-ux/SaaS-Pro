-- ============================================================================
-- Stripe invoice mirror — Lesson 9.5
-- ============================================================================
--
-- Adds `stripe_invoices`, the local cache of Stripe invoice objects.
--
-- WHY MIRROR INVOICES AT ALL
-- --------------------------
-- The Customer Portal already shows the user their invoice history,
-- but we want our own surface for two reasons:
--
--   1. **Latency.** A logged-in user clicking "Billing" in our app
--      should see their invoices instantly, not wait for a Stripe-
--      hosted page round-trip after a portal redirect.
--
--   2. **Self-contained UX.** The billing-history list is the right
--      surface for in-app links — "view receipt", "download PDF",
--      "what was this charge?" — without bouncing the user out to a
--      Stripe-hosted UI for every interaction.
--
-- We do NOT use this table for any payments-decision logic. Stripe is
-- still the source of truth for "is this invoice paid"; we mirror the
-- public-facing view of it. Webhook lag of a few seconds is fine here
-- (entitlements stay correct via the subscription mirror, which is on
-- the entitlement hot path; this table is for display only).
--
-- COMPATIBILITY WITH MULTIPLE WEBHOOK EVENTS
-- ------------------------------------------
-- The same table is hydrated by `invoice.finalized`, `invoice.paid`,
-- `invoice.payment_failed`, `invoice.voided`, and
-- `invoice.marked_uncollectible`. All five carry the full
-- `Stripe.Invoice` payload, so a single `upsertInvoice` handler does
-- the right thing for each — the per-event semantics live in the
-- service layer, not here.
--
-- API VERSION 2026-03-25.dahlia
-- ------------------------------
-- The (legacy) `Invoice.subscription` field has moved to
-- `Invoice.parent.subscription_details.subscription`. We follow the
-- new path in the service code and store the resolved subscription
-- id here as `subscription_id`.
-- ============================================================================

create type public.stripe_invoice_status as enum (
	-- Mirrors the canonical Stripe `Invoice.Status` enum exactly so
	-- a future Stripe addition surfaces as an enum cast failure
	-- (loud), not a silent string field.
	'draft',
	'open',
	'paid',
	'uncollectible',
	'void'
);

create table public.stripe_invoices (
	-- Stripe `in_…` invoice id. PK so duplicate webhook deliveries
	-- collapse on upsert.
	id text primary key,

	-- Owning user. ON DELETE CASCADE so deleting an account also
	-- removes its (immutable, mirrored) billing history. The
	-- authoritative copy still lives in Stripe.
	user_id uuid not null
		references public.profiles (id) on delete cascade,

	-- Customer + subscription denorm so the billing-history page
	-- doesn't need a join. `subscription_id` is nullable: ad-hoc
	-- invoices created in the Dashboard outside a subscription are
	-- legal in Stripe and we don't want them to fail the FK.
	stripe_customer_id text not null,
	subscription_id text
		references public.stripe_subscriptions (id) on delete set null,

	status public.stripe_invoice_status not null,

	-- Stripe stores monetary values in the smallest currency unit
	-- (cents for USD). We mirror the integer directly + currency
	-- code; the JS layer formats with the same `formatCurrency`
	-- helper the pricing page uses.
	currency text not null,
	amount_due bigint not null default 0,
	amount_paid bigint not null default 0,
	amount_remaining bigint not null default 0,
	subtotal bigint not null default 0,
	total bigint not null default 0,
	-- Tax line. NULL for line-items below the Stripe Tax threshold;
	-- 0 vs NULL is meaningful so we don't coalesce.
	tax bigint,

	-- Customer-visible identifier (e.g. `D1A2C3-0001`). Distinct
	-- from `id` (`in_…`) — `number` is what appears on the PDF.
	number text,

	-- Stripe-hosted surfaces. Either may be null on a draft invoice
	-- (the page only renders rows with a non-null URL).
	hosted_invoice_url text,
	invoice_pdf text,

	-- Service period the invoice covers. Useful for "Pro · monthly,
	-- Apr 1 → May 1" subtitles in the billing-history list.
	period_start timestamptz,
	period_end timestamptz,

	-- Lifecycle timestamps. We store both the Stripe-side `created`
	-- (used for sort order) and `paid_at` (from
	-- `status_transitions.paid_at`) so the row can stand on its own
	-- without re-deriving timestamps from event metadata.
	created_at_stripe timestamptz,
	paid_at timestamptz,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint stripe_invoices_id_format
		check (id ~ '^in_[A-Za-z0-9_]+$')
);

-- Hot path: "give me this user's invoices, newest first". Compound
-- index over (user_id, created_at_stripe DESC) so the billing-
-- history page paginates without a sort.
create index stripe_invoices_user_created_idx
	on public.stripe_invoices (user_id, created_at_stripe desc);

create index stripe_invoices_subscription_id_idx
	on public.stripe_invoices (subscription_id);

create index stripe_invoices_stripe_customer_id_idx
	on public.stripe_invoices (stripe_customer_id);

create trigger stripe_invoices_set_updated_at
	before update on public.stripe_invoices
	for each row
	execute function public.set_updated_at();

comment on table public.stripe_invoices is
	'Local mirror of Stripe `in_…`. Hydrated by invoice.* webhook '
	'handlers (Module 9.5). DISPLAY-ONLY — never used for payments '
	'decisions; Stripe remains source of truth for "is this paid".';

-- ---------------------------------------------------------------------
-- RLS — invoices are private to their owning user
-- ---------------------------------------------------------------------
alter table public.stripe_invoices enable row level security;

create policy "users read their own invoices"
	on public.stripe_invoices
	for select
	to authenticated
	using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE for `authenticated`. The webhook
-- handler is the sole writer; service_role bypasses RLS.
