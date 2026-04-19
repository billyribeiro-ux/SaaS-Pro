/**
 * scripts/seed-contacts.ts — Faker-based contact seeder.
 *
 * Run with `pnpm run seed:contacts` (or `pnpm run seed:contacts -- 100`
 * to override the count). Targets the local Supabase stack by default;
 * point it at staging by exporting a different
 * `SUPABASE_SERVICE_ROLE_KEY` + `PUBLIC_SUPABASE_URL` first.
 *
 * WHY THIS LIVES OUTSIDE seed.sql
 * --------------------------------
 * `supabase/seed.sql` is replayed on every `db reset` and SHOULD stay
 * deterministic (same accounts, same baseline rows, every time). A
 * 200-contact randomized fixture would make every reset bloat your
 * git diff and your local IDE noise.
 *
 * Faker output also doesn't belong in version control: regenerating
 * is one shell command, and the value is in the *shape* of the data
 * (long names, weird Unicode, missing fields), not the specific
 * rows. So we keep that randomness in a script that you opt in to.
 *
 * SAFETY
 * ------
 * The service-role client bypasses RLS, so we hard-target the demo
 * user's personal org by email. Refusing to run if the demo user
 * doesn't exist makes "I accidentally pointed this at production"
 * an exceptionally loud failure instead of a silent disaster.
 */
import { config as loadEnv } from 'dotenv';
import { faker } from '@faker-js/faker';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types.js';

loadEnv();

const DEMO_EMAIL = 'demo@contactly.test';
const DEFAULT_COUNT = 50;
const BATCH_SIZE = 100; // PostgREST handles large bulk inserts; we batch to keep memory + log noise low.

function readEnv(name: string): string {
	const value = process.env[name];
	if (!value || value.length === 0) {
		console.error(`✗ Missing required env var: ${name}`);
		console.error('  Run `supabase status` for local values, or export your staging credentials.');
		process.exit(1);
	}
	return value;
}

async function main() {
	const supabaseUrl = readEnv('PUBLIC_SUPABASE_URL');
	const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

	const requested = Number.parseInt(process.argv[2] ?? `${DEFAULT_COUNT}`, 10);
	const count = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_COUNT;

	const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});

	console.info(`→ Looking up demo user ${DEMO_EMAIL}…`);
	const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
	if (listError) {
		console.error('✗ listUsers failed:', listError.message);
		process.exit(1);
	}
	const demoUser = list.users.find((u) => u.email === DEMO_EMAIL);
	if (!demoUser) {
		console.error(`✗ Demo user ${DEMO_EMAIL} not found.`);
		console.error('  Run `pnpm run db:reset` first to create the seed users.');
		process.exit(1);
	}

	console.info('→ Resolving demo user’s personal org…');
	const { data: membership, error: memErr } = await admin
		.from('organization_members')
		.select('organization_id')
		.eq('user_id', demoUser.id)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (memErr || !membership) {
		console.error('✗ Could not find demo user membership:', memErr?.message ?? 'no rows');
		process.exit(1);
	}

	console.info(`→ Generating ${count} contacts via faker…`);
	const rows = Array.from({ length: count }, () =>
		buildFakeContact(membership.organization_id, demoUser.id)
	);

	console.info(`→ Inserting in batches of ${BATCH_SIZE}…`);
	let inserted = 0;
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		const { error: insertError, count: returned } = await admin
			.from('contacts')
			.insert(batch, { count: 'exact' });
		if (insertError) {
			console.error(`✗ Batch ${i / BATCH_SIZE + 1} failed:`, insertError.message);
			process.exit(1);
		}
		inserted += returned ?? batch.length;
	}

	console.info(`✓ Inserted ${inserted} contacts into ${membership.organization_id}.`);
}

/**
 * One realistic-but-fake contact row.
 *
 * We intentionally leave 30% of the optional columns blank — real
 * CRM data has gaps, and the empty-state rendering should be
 * exercised by the seeded fixture, not just by clicking through new
 * forms.
 */
function buildFakeContact(organizationId: string, createdBy: string) {
	const firstName = faker.person.firstName();
	const lastName = faker.person.lastName();
	const company = faker.company.name();
	return {
		organization_id: organizationId,
		created_by: createdBy,
		full_name: `${firstName} ${lastName}`,
		email:
			faker.helpers.maybe(() => faker.internet.email({ firstName, lastName }), {
				probability: 0.85
			}) ?? null,
		phone:
			faker.helpers.maybe(() => faker.phone.number({ style: 'international' }), {
				probability: 0.7
			}) ?? null,
		company: faker.helpers.maybe(() => company, { probability: 0.8 }) ?? null,
		job_title: faker.helpers.maybe(() => faker.person.jobTitle(), { probability: 0.7 }) ?? null,
		notes:
			faker.helpers.maybe(() => faker.lorem.paragraph({ min: 1, max: 3 }), { probability: 0.4 }) ??
			null
	};
}

main().catch((err) => {
	console.error('✗ Unexpected error:', err);
	process.exit(1);
});
