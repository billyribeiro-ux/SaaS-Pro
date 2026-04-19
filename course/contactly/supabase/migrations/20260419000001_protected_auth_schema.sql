-- =====================================================================
-- Lock down Supabase's `auth` schema to defense-in-depth defaults.
-- =====================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Supabase boots the `auth` schema with permissive defaults so the
-- platform's own internal services can read/write users, identities,
-- sessions, etc. The PostgREST gateway (the thing serving
-- `https://<project>.supabase.co/rest/v1/`) is configured at the API
-- layer to only expose `public`, `storage`, and `graphql_public` — so
-- in normal operation an end user can never call an `auth.*` table
-- through the REST API.
--
-- That is one layer of defense. This migration is a second one. We
-- explicitly REVOKE every permission the `anon` and `authenticated`
-- roles might inherit on anything inside the `auth` schema, and we
-- set up DEFAULT PRIVILEGES so anything Supabase creates in the
-- future inside `auth` (e.g. on a CLI upgrade) inherits the same
-- locked-down posture without us having to remember to re-run this.
--
-- WHAT WE DELIBERATELY DO NOT TOUCH
-- ---------------------------------
-- - `service_role` keeps full access. Server-only code authenticated
--   with the service-role JWT routinely needs to read auth.users to
--   resolve identities — that's expected and safe because the key is
--   never shipped to a browser.
-- - `supabase_auth_admin` keeps full access. That's the role
--   GoTrue (Supabase Auth) itself uses internally; revoking from it
--   would brick sign-up and sign-in.
-- - `postgres` keeps full access (the local superuser).
-- - We do NOT drop anything. Migrations should be additive whenever
--   possible; explicit REVOKEs are reversible by a future GRANT.
--
-- WHAT TO ADD HERE LATER
-- ----------------------
-- If we ever add custom tables/functions/views inside the `auth`
-- schema (rare — most app schema goes in `public`), prefer extending
-- this migration's pattern in a NEW migration that re-asserts the
-- same revokes after creating the object. Postgres role privileges
-- on a newly-created object follow ALTER DEFAULT PRIVILEGES, but
-- belt-and-suspenders is cheap.
-- =====================================================================

REVOKE ALL ON SCHEMA auth FROM anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA auth FROM anon, authenticated;

-- Future-proofing: any object that gets created in `auth` later by
-- the `postgres` role (which is what Supabase migrations and the
-- CLI use) starts life with no access for `anon` / `authenticated`.
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
	REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
	REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
	REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
	REVOKE ALL ON ROUTINES FROM anon, authenticated;

-- Same posture for the `supabase_auth_admin`'s default privileges,
-- so anything GoTrue itself creates also stays locked down.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
	REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
	REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
	REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
	REVOKE ALL ON ROUTINES FROM anon, authenticated;

COMMENT ON SCHEMA auth IS
	'Supabase Auth (GoTrue) state. Locked down to anon + authenticated; '
	'service_role and supabase_auth_admin retain access. See migration '
	'20260419000001 for the full posture rationale.';
