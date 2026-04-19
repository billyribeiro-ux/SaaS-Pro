-- =====================================================================
-- Multi-tenancy + first user-content table.
-- =====================================================================
--
-- Per ADR-001, Contactly is team-oriented from day one. This migration
-- lands the four pieces that make multi-tenancy real:
--
--   1. `organizations`            — the tenant boundary.
--   2. `organization_members`     — role-scoped membership pairs.
--   3. `is_organization_member`   — RLS helper that lets policies on
--                                   downstream tables (contacts now,
--                                   notes/files later) ask the
--                                   membership question without
--                                   re-implementing it everywhere.
--   4. `contacts`                 — the first table that's actually
--                                   user-generated content. Carries
--                                   `organization_id` and is gated
--                                   by membership, NOT by `auth.uid()
--                                   = user_id` (which is the trap
--                                   ADR-001 was written to prevent).
--
-- The same migration extends `handle_new_user` (Lesson 1.4) to create
-- the user's personal organization and insert them as its sole owner,
-- so a brand-new sign-up has a workspace to write into immediately.
-- =====================================================================

-- ---------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------
create table public.organizations (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	-- URL-safe slug. We DON'T use this for routing yet (Module 4 routes
	-- by `id`), but every org gets one so the day we want
	-- /:slug/contacts URLs the data model is already there.
	slug text not null,
	-- Personal orgs are created by the `handle_new_user` trigger and
	-- get special UI treatment (no "leave team" button, can't be
	-- transferred). The flag is the source of truth.
	is_personal boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint organizations_name_length
		check (char_length(name) between 1 and 200),
	-- Slug rules: lowercase alphanumeric + hyphens, must start and end
	-- alphanumeric. 2-64 chars is enough for any human-typed name.
	constraint organizations_slug_format
		check (
			slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
			and char_length(slug) between 2 and 64
		)
);

create unique index organizations_slug_unique on public.organizations (slug);

create trigger organizations_set_updated_at
	before update on public.organizations
	for each row
	execute function public.set_updated_at();

comment on table public.organizations is
	'A tenant. Owns all user-generated content via organization_id FKs. '
	'Every user has at least one (their personal workspace, '
	'auto-created by handle_new_user).';

-- ---------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------
create type public.organization_member_role as enum ('owner', 'admin', 'member');

create table public.organization_members (
	organization_id uuid not null
		references public.organizations (id) on delete cascade,
	user_id uuid not null
		references public.profiles (id) on delete cascade,
	role public.organization_member_role not null default 'member',
	created_at timestamptz not null default now(),

	-- Composite PK: a user can be in many orgs, an org has many users,
	-- but each (org, user) pair is unique. Cheaper than a synthetic
	-- id + unique index.
	primary key (organization_id, user_id)
);

-- Indexes for the two query directions we'll do constantly:
-- - "all members of this org"        → primary key handles it
-- - "all orgs this user belongs to"  → reverse lookup, needs its own index
create index organization_members_user_id_idx on public.organization_members (user_id);

comment on table public.organization_members is
	'Pairs users with the orgs they belong to and their role within.';

-- ---------------------------------------------------------------------
-- is_organization_member — RLS helper.
--
-- Every downstream table's RLS policies (contacts now, notes/files
-- later) need to ask: "is the current user a member of <org_id>?"
-- Inlining that subquery in every policy is repetitive AND triggers
-- Postgres-level RLS recursion if the table being checked has its own
-- RLS (which `organization_members` does). The standard Supabase fix
-- is a `security definer` helper that bypasses RLS when looking up
-- membership, then is called from policies that DO enforce it.
--
-- `stable` (not `volatile`) lets Postgres cache the result within a
-- single query — important when a policy fires for every row in a
-- result set.
-- ---------------------------------------------------------------------
create or replace function public.is_organization_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.organization_members
		where organization_id = org_id
		  and user_id = (select auth.uid())
	);
$$;

revoke execute on function public.is_organization_member(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated, service_role;

comment on function public.is_organization_member(uuid) is
	'RLS helper. Returns true iff the current authenticated user is a '
	'member of the given organization. Bypasses RLS via SECURITY '
	'DEFINER so policies that call it never recurse.';

-- ---------------------------------------------------------------------
-- RLS — organizations + organization_members.
--
-- READ ACCESS
--   - Members can see the orgs they belong to.
--   - Members can see the membership rows of orgs they belong to
--     (so the team page can render "Bob, Carol, Dave").
--
-- WRITE ACCESS
--   - INSERT into organizations is intentionally disabled for
--     authenticated users: orgs are created either by the trigger
--     (personal) or by a future "create team" form action that goes
--     through a server-side helper using the service-role client.
--   - UPDATE on organizations is owner-only (rename, slug change).
--   - DELETE is owner-only and only allowed for non-personal orgs
--     (you can't delete your personal workspace; account deletion
--     handles that).
--   - INSERT into organization_members happens only via invite flow
--     (Module 13). Disabled at the row-level here.
-- ---------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create policy "organizations_select_member"
	on public.organizations
	for select
	to authenticated
	using (public.is_organization_member(id));

create policy "organizations_update_owner"
	on public.organizations
	for update
	to authenticated
	using (
		exists (
			select 1
			from public.organization_members
			where organization_id = id
			  and user_id = (select auth.uid())
			  and role = 'owner'
		)
	)
	with check (
		exists (
			select 1
			from public.organization_members
			where organization_id = id
			  and user_id = (select auth.uid())
			  and role = 'owner'
		)
	);

create policy "organization_members_select_same_org"
	on public.organization_members
	for select
	to authenticated
	using (public.is_organization_member(organization_id));

-- ---------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------
create table public.contacts (
	id uuid primary key default gen_random_uuid(),
	organization_id uuid not null
		references public.organizations (id) on delete cascade,
	-- created_by is auditing/UX (show "Added by Bob" in the UI). NOT
	-- the access key — RLS keys off org membership. SET NULL on
	-- profile delete so contacts survive a member leaving the team.
	created_by uuid
		references public.profiles (id) on delete set null,
	full_name text not null,
	email text,
	phone text,
	company text,
	job_title text,
	notes text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint contacts_full_name_length
		check (char_length(full_name) between 1 and 200),
	-- Loose email check — enough to reject obvious garbage, lets
	-- Zod do the real format work in the form layer.
	constraint contacts_email_format
		check (email is null or (char_length(email) between 3 and 320 and email like '%@%')),
	constraint contacts_phone_length
		check (phone is null or char_length(phone) between 4 and 64),
	constraint contacts_company_length
		check (company is null or char_length(company) between 1 and 200),
	constraint contacts_job_title_length
		check (job_title is null or char_length(job_title) between 1 and 200),
	constraint contacts_notes_length
		check (notes is null or char_length(notes) <= 10000)
);

-- Composite indexes matching the read patterns we'll add in 4.5:
--   - List page         → ORDER BY created_at DESC for an org
--   - Search-by-name    → name ILIKE on the same org
create index contacts_organization_id_idx
	on public.contacts (organization_id);
create index contacts_org_created_at_idx
	on public.contacts (organization_id, created_at desc);
create index contacts_org_full_name_idx
	on public.contacts (organization_id, lower(full_name));

create trigger contacts_set_updated_at
	before update on public.contacts
	for each row
	execute function public.set_updated_at();

comment on table public.contacts is
	'User-generated CRM contacts. Tenant boundary is organization_id. '
	'created_by is audit metadata, not access control.';

-- ---------------------------------------------------------------------
-- RLS — contacts (membership-based, all four operations).
--
-- WITH CHECK on INSERT/UPDATE both verifies the *resulting* row sits
-- inside an org the user belongs to. This stops the classic "edit a
-- legitimate contact and silently move it into another org" attack
-- via UPDATE … SET organization_id = '<other>'.
-- ---------------------------------------------------------------------
alter table public.contacts enable row level security;

create policy "contacts_select_member"
	on public.contacts
	for select
	to authenticated
	using (public.is_organization_member(organization_id));

create policy "contacts_insert_member"
	on public.contacts
	for insert
	to authenticated
	with check (public.is_organization_member(organization_id));

create policy "contacts_update_member"
	on public.contacts
	for update
	to authenticated
	using (public.is_organization_member(organization_id))
	with check (public.is_organization_member(organization_id));

create policy "contacts_delete_member"
	on public.contacts
	for delete
	to authenticated
	using (public.is_organization_member(organization_id));

-- ---------------------------------------------------------------------
-- Extend handle_new_user — also create the personal organization and
-- insert the user as its sole owner.
--
-- We REPLACE the function (CREATE OR REPLACE) rather than dropping +
-- re-creating because the trigger that calls it stays bound to the
-- function name. Postgres rebinds to the new body atomically; no
-- window where new sign-ups would skip the trigger.
--
-- Slug strategy for personal orgs: prefix `personal-` plus the user's
-- UUID with hyphens stripped. Guaranteed unique (UUIDs are), opaque
-- (no PII), and visually obvious as "this is a system-created
-- workspace, not a real team name" if it ever leaks into a URL.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	new_org_id uuid;
	display_name text;
begin
	insert into public.profiles (id, email, full_name, avatar_url)
	values (
		new.id,
		new.email,
		nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
		nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
	);

	-- "Bob's Workspace" if we have a name; otherwise the email's
	-- local part. Never empty — the org name has a NOT NULL +
	-- length check.
	display_name := coalesce(
		nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
		split_part(new.email, '@', 1)
	);

	insert into public.organizations (name, slug, is_personal)
	values (
		display_name || '''s Workspace',
		'personal-' || replace(new.id::text, '-', ''),
		true
	)
	returning id into new_org_id;

	insert into public.organization_members (organization_id, user_id, role)
	values (new_org_id, new.id, 'owner');

	return new;
end;
$$;

comment on function public.handle_new_user() is
	'Trigger function: mirrors auth.users insert into public.profiles, '
	'then creates the user''s personal organization and adds them as '
	'its first owner (per ADR-001).';
