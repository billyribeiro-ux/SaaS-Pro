-- Stripe webhook idempotency ledger.
-- Stripe guarantees at-least-once delivery; record every processed event id
-- so handler retries (or duplicate fan-out from the dashboard) become no-ops.
create table public.stripe_events (
	id text primary key,
	type text not null,
	received_at timestamptz default now() not null
);

alter table public.stripe_events enable row level security;

-- Server-only table. No RLS policies — supabaseAdmin (service role) bypasses RLS;
-- browser clients have no business reading this.

create index stripe_events_received_at_idx on public.stripe_events(received_at desc);
