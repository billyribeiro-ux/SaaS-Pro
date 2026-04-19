-- Contacts CRUD table for app users.
-- Shared-table multi-tenancy with RLS policy guardrails.

create table if not exists public.contacts (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references public.profiles(id) on delete cascade,
	first_name text not null check (char_length(first_name) <= 100),
	last_name text not null check (char_length(last_name) <= 100),
	email text check (email is null or char_length(email) <= 255),
	phone text check (phone is null or char_length(phone) <= 50),
	company text check (company is null or char_length(company) <= 200),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists contacts_user_id_idx on public.contacts (user_id);
create index if not exists contacts_user_sort_idx
	on public.contacts (user_id, last_name, first_name);

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
	before update on public.contacts
	for each row execute function public.set_updated_at();

alter table public.contacts enable row level security;

drop policy if exists "Users can view own contacts" on public.contacts;
create policy "Users can view own contacts"
	on public.contacts for select
	using (auth.uid() = user_id);

drop policy if exists "Users can create own contacts" on public.contacts;
create policy "Users can create own contacts"
	on public.contacts for insert
	with check (auth.uid() = user_id);

drop policy if exists "Users can update own contacts" on public.contacts;
create policy "Users can update own contacts"
	on public.contacts for update
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

drop policy if exists "Users can delete own contacts" on public.contacts;
create policy "Users can delete own contacts"
	on public.contacts for delete
	using (auth.uid() = user_id);
