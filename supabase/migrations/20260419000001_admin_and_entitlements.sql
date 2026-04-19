-- Admin role + comp entitlements + audit log.
-- Designed to be operated as production: deny-by-default RLS, single source
-- of truth for "can this user act as admin", and an audit trail for any
-- admin-initiated state change.

-- 1. Role on profiles --------------------------------------------------------
alter table public.profiles
	add column if not exists role text not null default 'user'
		check (role in ('user', 'admin'));

create index if not exists profiles_role_idx on public.profiles (role)
	where role = 'admin';

-- Single helper used by every other policy. SECURITY DEFINER so it bypasses
-- the policies on `profiles` itself (otherwise an admin checking their own
-- role under a restrictive policy would deadlock the check).
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select coalesce(
		(select role = 'admin' from public.profiles where id = uid),
		false
	);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to anon, authenticated, service_role;

-- 2. Profiles: admins can read & update every row ---------------------------
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
	on public.profiles for select
	using (public.is_admin());

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
	on public.profiles for update
	using (public.is_admin())
	with check (public.is_admin());

-- 3. Entitlements ------------------------------------------------------------
-- A grant of access independent of Stripe — used for comps, internal users,
-- or temporary access. Access checks are: entitlement OR active subscription.
create table if not exists public.entitlements (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references public.profiles(id) on delete cascade,
	tier text not null check (tier in ('monthly', 'yearly', 'lifetime')),
	reason text not null,
	granted_by uuid references public.profiles(id) on delete set null,
	granted_at timestamptz not null default now(),
	expires_at timestamptz,
	revoked_at timestamptz
);

create index if not exists entitlements_user_active_idx
	on public.entitlements (user_id)
	where revoked_at is null;

alter table public.entitlements enable row level security;

drop policy if exists "Users see own entitlements" on public.entitlements;
create policy "Users see own entitlements"
	on public.entitlements for select
	using (auth.uid() = user_id);

drop policy if exists "Admins manage entitlements" on public.entitlements;
create policy "Admins manage entitlements"
	on public.entitlements for all
	using (public.is_admin())
	with check (public.is_admin());

-- 4. Admin audit log ---------------------------------------------------------
create table if not exists public.admin_audit_log (
	id uuid primary key default gen_random_uuid(),
	actor_id uuid references public.profiles(id) on delete set null,
	action text not null,
	target_user_id uuid references public.profiles(id) on delete set null,
	metadata jsonb,
	created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
	on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx
	on public.admin_audit_log (target_user_id);

alter table public.admin_audit_log enable row level security;

drop policy if exists "Admins read audit log" on public.admin_audit_log;
create policy "Admins read audit log"
	on public.admin_audit_log for select
	using (public.is_admin());

-- Service role inserts via supabaseAdmin bypass RLS, so no INSERT policy
-- is needed. Explicitly forbid anonymous writes.
drop policy if exists "Admins write audit log" on public.admin_audit_log;
create policy "Admins write audit log"
	on public.admin_audit_log for insert
	with check (public.is_admin());

-- 5. Admin allowlist promotion ----------------------------------------------
-- New users whose email appears in `app.admin_emails` (a comma-separated
-- string set as a Postgres GUC) are auto-promoted on insert. This means
-- bootstrapping an admin requires no manual SQL after deployment — set the
-- env var and the next sign-up gets the role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	allowlist text;
	resolved_role text := 'user';
begin
	insert into public.profiles (id, email, full_name)
	values (new.id, new.email, new.raw_user_meta_data->>'full_name');

	-- current_setting(..., true) returns null instead of erroring when unset.
	allowlist := current_setting('app.admin_emails', true);
	if allowlist is not null and length(trim(allowlist)) > 0 then
		if exists (
			select 1
			from unnest(string_to_array(lower(allowlist), ',')) as email
			where trim(email) = lower(new.email)
		) then
			resolved_role := 'admin';
			update public.profiles set role = 'admin' where id = new.id;
		end if;
	end if;

	return new;
end;
$$;

-- 6. Promote-by-email RPC for one-shot bootstrapping ------------------------
-- Useful when you already signed up before setting ADMIN_EMAILS. Callable
-- only by the service role (i.e. supabaseAdmin) — anon and authenticated
-- have execute revoked.
create or replace function public.promote_user_to_admin(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	update public.profiles
	set role = 'admin'
	where lower(email) = lower(target_email);
end;
$$;

revoke all on function public.promote_user_to_admin(text) from public;
revoke all on function public.promote_user_to_admin(text) from anon, authenticated;
grant execute on function public.promote_user_to_admin(text) to service_role;
