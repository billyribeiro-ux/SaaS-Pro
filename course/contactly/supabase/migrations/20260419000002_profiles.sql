-- =====================================================================
-- profiles — one app-level row per `auth.users`.
-- =====================================================================
--
-- WHY A SEPARATE TABLE
-- --------------------
-- `auth.users` is owned by Supabase Auth (GoTrue). We never write to it
-- from app code — even server-side, with the service-role key, mutating
-- it directly is a recipe for race conditions against GoTrue's own
-- writers. So we mirror the parts we care about into `public.profiles`
-- and treat that as the source of truth for user-facing display data
-- (name, avatar, future preferences).
--
-- The mirror is kept in sync via the `handle_new_user` trigger below.
--
-- PER ADR-001 (multi-tenancy)
-- ---------------------------
-- This lesson creates **only the profile**. The same trigger will be
-- EXTENDED in Module 4 when we add the `organizations` + `members`
-- tables — that migration will replace `handle_new_user` with a
-- version that also creates the user's personal organization and
-- inserts them as its sole owner. Keeping the trigger profile-only
-- here lets Lesson 1.4 stand on its own without the multi-tenant
-- machinery a student hasn't seen yet.
-- =====================================================================

create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	email text not null,
	full_name text,
	avatar_url text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	-- RFC 5321 caps a fully-qualified email at 320 chars. Anything
	-- longer is a malformed input we shouldn't even accept.
	constraint profiles_email_length check (char_length(email) between 3 and 320),
	-- Cap display names at a reasonable length. Long names break UI
	-- truncation logic and are almost always abuse.
	constraint profiles_full_name_length check (
		full_name is null or char_length(full_name) between 1 and 200
	),
	-- Avatar URLs come from Supabase Storage in Module 5. Cap them.
	constraint profiles_avatar_url_length check (
		avatar_url is null or char_length(avatar_url) between 1 and 2048
	)
);

-- Email is unique CASE-INSENSITIVELY (Bob@x.com == bob@x.com). A unique
-- index on `lower(email)` is the standard pattern; using a generated
-- column or `citext` would also work but pulls in extra surface area.
create unique index profiles_email_lower_unique on public.profiles (lower(email));

comment on table public.profiles is
	'Application-level mirror of auth.users. One row per user. The '
	'handle_new_user trigger keeps this table in sync with auth.users '
	'inserts; updates flow back the other way through app actions.';
comment on column public.profiles.id is
	'Same UUID as auth.users.id. Cascade-deletes when the auth user is '
	'deleted so we never have orphan profiles.';
comment on column public.profiles.email is
	'Mirror of auth.users.email at insert time. Email *changes* in '
	'auth.users do not currently propagate here — that lands in the '
	'account-management lesson (Module 3.6) along with the email-change '
	'verification flow.';

-- =====================================================================
-- Row Level Security.
--
-- Posture for v1: a user can only read and update their own row.
-- Module 4 adds a workspace-scoped SELECT policy so members of the
-- same organization can see each other's display name + avatar (which
-- is what "Show Bob in the contact list" requires). We do not relax
-- it here because we don't yet have a workspace concept to scope it
-- to.
-- =====================================================================
alter table public.profiles enable row level security;

create policy "profiles_select_self"
	on public.profiles
	for select
	to authenticated
	using ((select auth.uid()) = id);

create policy "profiles_update_self"
	on public.profiles
	for update
	to authenticated
	using ((select auth.uid()) = id)
	with check ((select auth.uid()) = id);

-- Note: NO insert policy. Profile rows are only ever created by the
-- `handle_new_user` trigger, which runs as `security definer` and
-- bypasses RLS. App code that tries to `insert into public.profiles`
-- will be denied — exactly what we want.
--
-- Note: NO delete policy. Account deletion runs via auth.users delete
-- (Module 3.6 wires this), which cascades to profiles automatically.

-- =====================================================================
-- Reusable updated_at trigger.
--
-- Every table we add later (organizations, contacts, notes, …) wants
-- the same "bump updated_at on every row update" behavior. We define
-- the function once here and attach a trigger per table going forward.
-- Migrations that add new tables will reference this same function.
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- `set search_path = ''` forces every identifier inside this function
-- to be schema-qualified. Defends against search_path injection — a
-- real attack vector for SECURITY DEFINER functions, harmless habit
-- for plain ones too.
set search_path = ''
as $$
begin
	new.updated_at = clock_timestamp();
	return new;
end;
$$;

revoke execute on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to authenticated, service_role;

create trigger profiles_set_updated_at
	before update on public.profiles
	for each row
	execute function public.set_updated_at();

-- =====================================================================
-- handle_new_user — fires after every auth.users INSERT, mirrors the
-- new user into public.profiles.
--
-- SECURITY DEFINER runs the function with the privileges of the
-- function's owner (the migration role, i.e. `postgres`), bypassing
-- RLS. Required because the inserting context (GoTrue) is not the
-- new user yet — auth.uid() returns null at that moment, and the
-- profiles_update_self policy wouldn't help on insert anyway.
--
-- `set search_path = ''` plus fully-qualified `public.profiles` and
-- `public.profiles.*` references is the canonical Supabase guidance
-- (https://supabase.com/docs/guides/database/functions#security-definer-and-search_path)
-- and prevents an attacker who can create a same-named object in a
-- schema earlier on the path from hijacking the function.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, email, full_name, avatar_url)
	values (
		new.id,
		new.email,
		-- nullif(trim(...), '') turns "  " or "" into NULL so we never
		-- store whitespace-only display names.
		nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
		nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
	);
	return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;
-- Only the auth admin role (the one GoTrue runs as when it inserts
-- into auth.users) and the migration role need to execute this
-- function. Nobody else should be able to call it directly.
grant execute on function public.handle_new_user() to supabase_auth_admin, postgres;

create trigger on_auth_user_created
	after insert on auth.users
	for each row
	execute function public.handle_new_user();

comment on function public.handle_new_user() is
	'Trigger function: mirrors auth.users insert into public.profiles. '
	'Extended in Module 4 to also create the user''s personal '
	'organization and add them as its first owner.';
comment on function public.set_updated_at() is
	'Generic BEFORE UPDATE trigger function: stamps updated_at with the '
	'current statement timestamp. Reused across every mutable table.';
