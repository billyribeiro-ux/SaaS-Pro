-- Profiles — one row per auth.users entry.
create table public.profiles (
	id uuid references auth.users on delete cascade primary key,
	email text not null,
	full_name text,
	avatar_url text,
	created_at timestamptz default now() not null,
	updated_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
	on public.profiles for select
	using (auth.uid() = id);

create policy "Users can update own profile"
	on public.profiles for update
	using (auth.uid() = id)
	with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.profiles (id, email, full_name)
	values (new.id, new.email, new.raw_user_meta_data->>'full_name');
	return new;
end;
$$;

create trigger on_auth_user_created
	after insert on auth.users
	for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create trigger profiles_set_updated_at
	before update on public.profiles
	for each row execute procedure public.set_updated_at();
