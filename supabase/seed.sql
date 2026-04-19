-- Seed data for local development only.
-- This script runs after migrations on `supabase db reset`.

-- Test auth user (test@example.com / password123)
insert into auth.users (
	id,
	email,
	encrypted_password,
	email_confirmed_at,
	created_at,
	updated_at,
	raw_app_meta_data,
	raw_user_meta_data,
	is_super_admin,
	role
)
values (
	'00000000-0000-0000-0000-000000000001',
	'test@example.com',
	crypt('password123', gen_salt('bf')),
	now(),
	now(),
	now(),
	'{"provider":"email","providers":["email"]}'::jsonb,
	'{"full_name":"Test User"}'::jsonb,
	false,
	'authenticated'
)
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name)
values (
	'00000000-0000-0000-0000-000000000001',
	'test@example.com',
	'Test User'
)
on conflict (id) do nothing;

-- 20 realistic contacts for the seeded test user.
insert into public.contacts (user_id, first_name, last_name, email, phone, company)
values
	('00000000-0000-0000-0000-000000000001', 'Alice', 'Johnson', 'alice@example.com', '555-0101', 'Acme Corp'),
	('00000000-0000-0000-0000-000000000001', 'Bob', 'Williams', 'bob@example.com', '555-0102', 'TechStart Inc'),
	('00000000-0000-0000-0000-000000000001', 'Carol', 'Davis', 'carol@example.com', null, 'DataCo'),
	('00000000-0000-0000-0000-000000000001', 'David', 'Martinez', null, '555-0104', null),
	('00000000-0000-0000-0000-000000000001', 'Emma', 'Anderson', 'emma@example.com', '555-0105', 'BuildRight LLC'),
	('00000000-0000-0000-0000-000000000001', 'Frank', 'Taylor', 'frank@example.com', null, 'SalesForce Partners'),
	('00000000-0000-0000-0000-000000000001', 'Grace', 'Thomas', null, '555-0107', 'CloudNine'),
	('00000000-0000-0000-0000-000000000001', 'Henry', 'Jackson', 'henry@example.com', '555-0108', 'RetailHub'),
	('00000000-0000-0000-0000-000000000001', 'Isabel', 'White', 'isabel@example.com', '555-0109', null),
	('00000000-0000-0000-0000-000000000001', 'James', 'Harris', 'james@example.com', null, 'MediaWorks'),
	('00000000-0000-0000-0000-000000000001', 'Karen', 'Clark', null, '555-0111', 'FinanceFirst'),
	('00000000-0000-0000-0000-000000000001', 'Liam', 'Lewis', 'liam@example.com', '555-0112', 'AutoGroup'),
	('00000000-0000-0000-0000-000000000001', 'Mia', 'Lee', 'mia@example.com', '555-0113', 'HealthPlus'),
	('00000000-0000-0000-0000-000000000001', 'Noah', 'Walker', null, null, 'EduLearn'),
	('00000000-0000-0000-0000-000000000001', 'Olivia', 'Hall', 'olivia@example.com', '555-0115', 'GreenTech'),
	('00000000-0000-0000-0000-000000000001', 'Paul', 'Allen', 'paul@example.com', null, null),
	('00000000-0000-0000-0000-000000000001', 'Quinn', 'Young', 'quinn@example.com', '555-0117', 'LegalEdge'),
	('00000000-0000-0000-0000-000000000001', 'Rachel', 'King', null, '555-0118', 'PropServices'),
	('00000000-0000-0000-0000-000000000001', 'Sam', 'Wright', 'sam@example.com', '555-0119', 'ConsultPro'),
	('00000000-0000-0000-0000-000000000001', 'Tina', 'Scott', 'tina@example.com', '555-0120', 'CreativeStudio');

-- Placeholder product row for local-first pricing UI fallback.
insert into public.products (id, name, description, active, metadata)
values (
	'prod_seed_saas_pro',
	'SaaS-Pro (seed)',
	'Placeholder product - replaced by Stripe sync.',
	false,
	'{}'::jsonb
)
on conflict (id) do nothing;
