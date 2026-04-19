-- =====================================================================
-- platform admin flag (Module 10.3 — webhook backlog health surface).
--
-- WHY A SCHEMA-LEVEL FLAG INSTEAD OF AN ENV-VAR ALLOW-LIST?
-- ---------------------------------------------------------
-- Two reasons: rotation and audit.
--
--   • Rotation. An env-var allow-list of admin emails (`ADMIN_EMAILS=
--     a@x.com,b@y.com`) has the same operational footprint as a
--     hard-coded constant: a redeploy is required to add or remove
--     anyone. A schema flag is a one-row UPDATE, instantly auditable
--     in the standard Postgres write log, and works the same in dev,
--     preview, and production with zero env-var sprawl.
--
--   • Audit. RLS policies, foreign-key cascades, and routine database
--     queries can all reference `is_platform_admin` directly. There
--     is no comparable trick for "this hard-coded list of emails".
--
-- WHY NOT A SEPARATE `platform_admins` TABLE?
-- -------------------------------------------
-- One row per user, lifetime-coupled to the profile row, never
-- composite — there's no shape on the join table that wouldn't be
-- noise at this scale. We can promote later if we ever introduce
-- granular admin scopes (`can_replay_webhooks`, `can_view_billing`,
-- …); right now a boolean is the right tool. ADR-006 records the
-- decision (linked from docs/operations/03-webhook-health.md).
--
-- THIS COLUMN IS WRITE-FORBIDDEN FROM RLS PATHS
-- ---------------------------------------------
-- The `profiles_update_self` policy lets a signed-in user update
-- *their own* profile row — full name, avatar, etc. We do NOT want
-- a malicious user to be able to PATCH `is_platform_admin = true`
-- on their own row through that policy. The trigger added below
-- forces the column to its OLD value on every RLS-driven UPDATE
-- (i.e. every UPDATE not running as service-role / postgres),
-- so a user attempting to elevate themselves silently no-ops on
-- that column while everything else they own is updatable as
-- before.
--
-- Promotion is therefore deliberately a service-role-only
-- operation: a DBA UPDATE, a migration, or a server-side admin tool
-- using `withAdmin(...)`. There is no client surface for it.
-- =====================================================================

alter table public.profiles
	add column is_platform_admin boolean not null default false;

comment on column public.profiles.is_platform_admin is
	'Platform-level admin flag (Module 10.3). Gates access to the '
	'/admin/* routes and the /api/admin/* endpoints. Mutable only '
	'via service-role (no client surface) — see the '
	'profiles_protect_admin_flag trigger below.';

-- ---------------------------------------------------------------------
-- Tiny partial index. The admin set is one or two rows in practice;
-- a partial WHERE-true index keeps `select count(*) from profiles
-- where is_platform_admin` and the gating SELECT below O(rows-in-set)
-- regardless of how big `profiles` grows.
-- ---------------------------------------------------------------------
create index profiles_is_platform_admin_idx
	on public.profiles (id)
	where is_platform_admin;

-- ---------------------------------------------------------------------
-- profiles_protect_admin_flag — RLS-safe write guard.
--
-- Rationale: see the long header. The function has no SECURITY
-- DEFINER (so it runs with the caller's privileges), uses an empty
-- `search_path`, and short-circuits whenever the caller IS
-- service-role / postgres (the two roles we want to be able to
-- promote a user). Every other role's UPDATE has the column
-- silently pinned to its OLD value, so the policy-allowed user-
-- updates-self path can't elevate.
-- ---------------------------------------------------------------------
create or replace function public.profiles_protect_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if current_user in ('service_role', 'postgres') then
		return new;
	end if;
	new.is_platform_admin = old.is_platform_admin;
	return new;
end;
$$;

revoke execute on function public.profiles_protect_admin_flag() from public;

create trigger profiles_protect_admin_flag
	before update on public.profiles
	for each row
	execute function public.profiles_protect_admin_flag();

comment on function public.profiles_protect_admin_flag() is
	'BEFORE UPDATE trigger on public.profiles: pins is_platform_admin '
	'to its OLD value for every role except service_role / postgres. '
	'Stops a malicious client from self-promoting via the '
	'profiles_update_self RLS policy (Module 10.3).';
