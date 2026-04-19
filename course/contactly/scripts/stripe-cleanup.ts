/**
 * scripts/stripe-cleanup.ts — archive every Contactly-tagged Stripe
 * Product and its Prices in the currently-authenticated test account.
 *
 * Run with `pnpm run stripe:cleanup`. Requires the Stripe CLI to be
 * logged in (`stripe login`), which this script shells out to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Stripe **does not let you delete** a Product that has ever had a
 * Subscription or a successful Invoice attached. The Dashboard's
 * "Delete" button is disabled; the API returns `resource_in_use`.
 * Archival (`active: false`) is the supported equivalent — archived
 * resources are hidden from the Dashboard product-catalog UI, hidden
 * from Checkout, and stop appearing in pricing-page queries that
 * filter for `active: true`.
 *
 * WHEN TO RUN
 * -----------
 *   - After a failed `stripe fixtures` run that partially succeeded.
 *   - After iterating on products.json with throwaway prices.
 *   - When rotating a test account between feature branches.
 *
 * NEVER run this in live mode without review. The script refuses to
 * proceed if your CLI is authenticated against a live key.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Only Products where `metadata.app = 'contactly'`. Third-party
 * products in the same test account are untouched.
 */
import { execFileSync } from 'node:child_process';

interface StripeProduct {
	id: string;
	name: string;
	active: boolean;
	metadata: Record<string, string>;
	livemode: boolean;
}
interface StripePrice {
	id: string;
	active: boolean;
	lookup_key: string | null;
	product: string;
	unit_amount: number | null;
	recurring: { interval: string } | null;
}
interface StripeList<T> {
	object: 'list';
	data: T[];
	has_more: boolean;
}

function stripe(args: string[]): string {
	try {
		return execFileSync('stripe', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (err) {
		const e = err as { stderr?: Buffer; message?: string };
		const stderr = e.stderr?.toString() ?? e.message ?? 'unknown error';
		throw new Error(`stripe ${args.join(' ')} failed:\n${stderr}`, { cause: err });
	}
}

function listAll<T>(resource: string, extraArgs: string[]): T[] {
	const out: T[] = [];
	let startingAfter: string | undefined;
	do {
		const args = [resource, 'list', '--limit', '100', ...extraArgs];
		if (startingAfter) args.push('--starting-after', startingAfter);
		const raw = stripe(args);
		const parsed = JSON.parse(raw) as StripeList<T & { id: string }>;
		out.push(...parsed.data);
		startingAfter = parsed.has_more ? parsed.data.at(-1)?.id : undefined;
	} while (startingAfter);
	return out;
}

function refuseOnLive(): void {
	const raw = stripe(['config', '--list']);
	if (/live_mode_api_key/i.test(raw) && !/test_mode_api_key/i.test(raw)) {
		console.error(
			'✗ Refusing to run: the Stripe CLI appears to be authenticated against a live account.'
		);
		console.error(
			'  Cleanup is only safe in test mode. Re-run `stripe login` with a test account.'
		);
		process.exit(2);
	}
}

function confirmDryRun(args: string[]): boolean {
	return !args.includes('--yes') && !args.includes('-y');
}

async function main() {
	const argv = process.argv.slice(2);
	const dryRun = confirmDryRun(argv);

	refuseOnLive();

	console.info('→ Listing active Contactly products (metadata.app=contactly)…');
	const products = listAll<StripeProduct>('products', ['--active=true']).filter(
		(p) => p.metadata?.app === 'contactly'
	);

	if (products.length === 0) {
		console.info(
			'✓ Nothing to clean up. The test account has no active contactly-tagged products.'
		);
		return;
	}

	console.info(`→ Found ${products.length} product(s) to archive:`);
	for (const p of products) console.info(`    - ${p.id} (${p.name})`);

	if (dryRun) {
		console.info('');
		console.info('… running in dry-run mode (no changes will be made).');
		console.info('    Re-run with `--yes` to actually archive these resources.');
		return;
	}

	for (const product of products) {
		console.info(`\n→ Archiving prices under ${product.id} (${product.name})…`);
		const prices = listAll<StripePrice>('prices', ['--product', product.id, '--active=true']);
		for (const price of prices) {
			console.info(`    · price ${price.id}  lookup=${price.lookup_key ?? '∅'}  → active=false`);
			stripe(['prices', 'update', price.id, '--active=false']);
		}
		console.info(`→ Archiving product ${product.id}…`);
		stripe(['products', 'update', product.id, '--active=false']);
	}

	console.info('\n✓ Cleanup complete.');
	console.info(
		'  Note: Stripe does not allow DELETE of products that have ever had a subscription.'
	);
	console.info('  Archived products remain in your account under "Archived" in the Dashboard.');
}

main().catch((err: unknown) => {
	console.error('✗ stripe-cleanup failed');
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
