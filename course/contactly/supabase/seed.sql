-- =====================================================================
-- Contactly seed data.
--
-- Replayed every time you run `pnpm run db:reset`. Two demo users +
-- their auto-created personal orgs + a handful of contacts each, so a
-- fresh local stack drops you into a usable app instantly:
--
--   demo@contactly.test     (password: Password123!)
--   teammate@contactly.test (password: Password123!)
--
-- The two users are deliberately in SEPARATE personal orgs. Module
-- 13's team-invitation lesson will be the one that actually puts them
-- in the same org — which means the RLS check we wrote in 4.1
-- ("teammate cannot see demo's contacts") is verifiable by hand right
-- now: sign in as teammate, navigate to /contacts, and the list is
-- empty. That's the security boundary working as designed.
--
-- ---------------------------------------------------------------------
-- WHY WE INSERT INTO auth.users DIRECTLY
-- ---------------------------------------------------------------------
-- Supabase Auth normally owns this table and forbids direct writes.
-- For seed data we genuinely need to bypass GoTrue: we want
-- deterministic UUIDs (so any FK we hard-code below stays stable)
-- and pre-confirmed emails (so demo accounts work without the
-- e-mail flow). The `handle_new_user` trigger fires on these inserts
-- and creates the personal org + membership for each user, exactly
-- like a real signup would.
--
-- The encrypted_password value is the bcrypt hash of "Password123!".
-- Generated once with `crypt('Password123!', gen_salt('bf'))`; safe
-- to commit because it's only ever used in local development.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bail out if the demo users already exist. `db reset` always starts
-- from a clean schema so this is paranoia, but it makes the file
-- safe to source twice in any context (e.g. by copy/pasting into
-- psql for quick experimentation).
-- ---------------------------------------------------------------------
do $$
begin
	if exists (select 1 from auth.users where email in (
		'demo@contactly.test',
		'teammate@contactly.test'
	)) then
		raise notice 'Seed users already exist — skipping seed.';
		return;
	end if;

	-- ----------------------------------------------------------------
	-- demo@contactly.test — primary demo account.
	-- ----------------------------------------------------------------
	insert into auth.users (
		id,
		instance_id,
		aud,
		role,
		email,
		encrypted_password,
		email_confirmed_at,
		raw_app_meta_data,
		raw_user_meta_data,
		created_at,
		updated_at,
		confirmation_token,
		email_change,
		email_change_token_new,
		recovery_token
	) values (
		'00000000-0000-4000-8000-000000000001',
		'00000000-0000-0000-0000-000000000000',
		'authenticated',
		'authenticated',
		'demo@contactly.test',
		crypt('Password123!', gen_salt('bf')),
		now(),
		'{"provider":"email","providers":["email"]}'::jsonb,
		'{"full_name":"Demo Owner"}'::jsonb,
		now(),
		now(),
		'',
		'',
		'',
		''
	);

	-- ----------------------------------------------------------------
	-- teammate@contactly.test — separate-tenant account, used for
	-- eyeballing the RLS boundary (their /contacts list MUST be empty).
	-- ----------------------------------------------------------------
	insert into auth.users (
		id,
		instance_id,
		aud,
		role,
		email,
		encrypted_password,
		email_confirmed_at,
		raw_app_meta_data,
		raw_user_meta_data,
		created_at,
		updated_at,
		confirmation_token,
		email_change,
		email_change_token_new,
		recovery_token
	) values (
		'00000000-0000-4000-8000-000000000002',
		'00000000-0000-0000-0000-000000000000',
		'authenticated',
		'authenticated',
		'teammate@contactly.test',
		crypt('Password123!', gen_salt('bf')),
		now(),
		'{"provider":"email","providers":["email"]}'::jsonb,
		'{"full_name":"Teammate Tester"}'::jsonb,
		now(),
		now(),
		'',
		'',
		'',
		''
	);

	-- ----------------------------------------------------------------
	-- Six starter contacts inside the demo user's personal org.
	-- We look the org up via the membership row the trigger just
	-- created, so we never have to know its UUID up front.
	--
	-- A richer Faker-based seeder lands in 4.8 — these six are just
	-- enough to verify the list/detail/edit/delete flows render in
	-- 4.5 / 4.6 / 4.7 against real data.
	-- ----------------------------------------------------------------
	insert into public.contacts (organization_id, created_by, full_name, email, phone, company, job_title, notes)
	select
		om.organization_id,
		om.user_id,
		c.full_name,
		c.email,
		c.phone,
		c.company,
		c.job_title,
		c.notes
	from public.organization_members om
	cross join (values
		('Ada Lovelace',     'ada@analyticalengine.org',  '+1 415 555 0101', 'Analytical Engine Co.', 'Founder',                  'Met at the Babbage commemorative lecture; interested in our import/export API.'),
		('Alan Turing',      'alan@bletchley.example',    '+44 20 7946 0958', 'Bletchley Labs',         'Principal Cryptographer',  'Prefers async comms; follow up after his sabbatical.'),
		('Grace Hopper',     'grace@cobol.dev',           '+1 202 555 0117', 'COBOL Heritage',         'Director of Engineering',  'Asked for an enterprise SSO demo; sent over the docs link.'),
		('Margaret Hamilton','margaret@apollo.example',   '+1 713 555 0142', 'Apollo Software',        'VP, Software Engineering', 'Wants the audit-log export feature; high-priority renewal.'),
		('Hedy Lamarr',      'hedy@frequency.test',       '+1 310 555 0188', 'Frequency Hopping Inc.', 'Inventor in Residence',    'Open to a paid pilot; needs SOC2 letter first.'),
		('Edsger Dijkstra',  'edsger@goto.example',       '+31 20 555 0123', 'Structured Software',    'Distinguished Engineer',   'Strong opinions on form validation; share the Zod blog post.')
	) as c(full_name, email, phone, company, job_title, notes)
	where om.user_id = '00000000-0000-4000-8000-000000000001';
end $$;
