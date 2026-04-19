-- Products — synced from Stripe.
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

create policy "Products are publicly readable"
	on public.products for select using (true);

create trigger products_set_updated_at
	before update on public.products
	for each row execute procedure public.set_updated_at();

-- Prices — synced from Stripe. Lookup keys drive dynamic pricing.
create table public.prices (
	id text primary key,
	product_id text references public.products(id) on delete cascade,
	active boolean default true,
	currency text not null,
	type text not null check (type in ('one_time', 'recurring')),
	unit_amount bigint,
	interval text check (interval in ('day', 'week', 'month', 'year') or interval is null),
	interval_count integer,
	lookup_key text unique,
	metadata jsonb,
	created_at timestamptz default now() not null,
	updated_at timestamptz default now() not null
);

alter table public.prices enable row level security;

create policy "Prices are publicly readable"
	on public.prices for select using (true);

create trigger prices_set_updated_at
	before update on public.prices
	for each row execute procedure public.set_updated_at();

-- Customers — maps a profile to its Stripe customer.
create table public.customers (
	id uuid references public.profiles(id) on delete cascade primary key,
	stripe_customer_id text unique not null,
	created_at timestamptz default now() not null
);

alter table public.customers enable row level security;

create policy "Users can view own customer record"
	on public.customers for select
	using (auth.uid() = id);

-- Subscriptions — authoritative source for subscription status per user.
create table public.subscriptions (
	id text primary key,
	user_id uuid references public.profiles(id) on delete cascade not null,
	status text not null check (status in (
		'trialing', 'active', 'canceled', 'incomplete',
		'incomplete_expired', 'past_due', 'unpaid', 'paused'
	)),
	price_id text references public.prices(id),
	quantity integer,
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
	on public.subscriptions for select
	using (auth.uid() = user_id);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_status_idx on public.subscriptions(status);
