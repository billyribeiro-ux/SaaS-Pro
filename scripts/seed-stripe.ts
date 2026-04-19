import Stripe from 'stripe';
import { PRICING_LOOKUP_KEYS } from '../src/lib/config/pricing.config';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
	throw new Error('Missing STRIPE_SECRET_KEY in environment.');
}

const stripe = new Stripe(stripeSecretKey, {
	apiVersion: '2026-03-25.dahlia'
});

const MANAGED_PRODUCT_MARKER = 'saas-pro-core';

type PriceSpec = {
	lookupKey: string;
	unitAmount: number;
	currency: 'usd';
	recurringInterval: Stripe.Price.Recurring.Interval | null;
	nickname: string;
};

const PRICE_SPECS: readonly PriceSpec[] = [
	{
		lookupKey: PRICING_LOOKUP_KEYS.monthly,
		unitAmount: 9700,
		currency: 'usd',
		recurringInterval: 'month',
		nickname: 'SaaS-Pro Monthly'
	},
	{
		lookupKey: PRICING_LOOKUP_KEYS.yearly,
		unitAmount: 99700,
		currency: 'usd',
		recurringInterval: 'year',
		nickname: 'SaaS-Pro Yearly'
	},
	{
		lookupKey: PRICING_LOOKUP_KEYS.lifetime,
		unitAmount: 499700,
		currency: 'usd',
		recurringInterval: null,
		nickname: 'SaaS-Pro Lifetime'
	}
];

async function findOrCreateManagedProduct(): Promise<Stripe.Product> {
	const existing = await stripe.products.list({ limit: 100, active: true });
	const managed = existing.data.find((product) => product.metadata.catalog === MANAGED_PRODUCT_MARKER);
	if (managed) {
		console.log(`Using existing product ${managed.id}`);
		return managed;
	}

	const created = await stripe.products.create({
		name: 'SaaS-Pro Access',
		description: 'Subscription catalog managed from source control.',
		metadata: { catalog: MANAGED_PRODUCT_MARKER }
	});
	console.log(`Created product ${created.id}`);
	return created;
}

function priceMatchesSpec(price: Stripe.Price, productId: string, spec: PriceSpec): boolean {
	const sameProduct = (typeof price.product === 'string' ? price.product : price.product.id) === productId;
	const sameAmount = price.unit_amount === spec.unitAmount && price.currency === spec.currency;
	const sameCadence =
		(spec.recurringInterval === null && price.type === 'one_time') ||
		(spec.recurringInterval !== null &&
			price.type === 'recurring' &&
			price.recurring?.interval === spec.recurringInterval);

	return sameProduct && sameAmount && sameCadence && price.active;
}

async function ensurePrice(productId: string, spec: PriceSpec): Promise<void> {
	const result = await stripe.prices.list({
		lookup_keys: [spec.lookupKey],
		expand: ['data.product'],
		limit: 1
	});
	const existing = result.data[0] ?? null;

	if (existing && priceMatchesSpec(existing, productId, spec)) {
		console.log(`Price ${spec.lookupKey} already correct (${existing.id})`);
		return;
	}

	if (existing) {
		console.log(`Archiving stale price ${existing.id} for ${spec.lookupKey}`);
		await stripe.prices.update(existing.id, { active: false });
	}

	const recurring =
		spec.recurringInterval === null ? undefined : { interval: spec.recurringInterval };
	const created = await stripe.prices.create({
		product: productId,
		unit_amount: spec.unitAmount,
		currency: spec.currency,
		recurring,
		lookup_key: spec.lookupKey,
		transfer_lookup_key: true,
		nickname: spec.nickname,
		metadata: { catalog: MANAGED_PRODUCT_MARKER, lookup_key: spec.lookupKey }
	});

	console.log(`Created price ${spec.lookupKey} -> ${created.id}`);
}

async function main() {
	console.log('Seeding Stripe catalog from code...');
	const product = await findOrCreateManagedProduct();
	for (const spec of PRICE_SPECS) {
		await ensurePrice(product.id, spec);
	}
	console.log('Stripe catalog seed complete.');
}

main().catch((err) => {
	console.error('Stripe seed failed:', err);
	process.exitCode = 1;
});
