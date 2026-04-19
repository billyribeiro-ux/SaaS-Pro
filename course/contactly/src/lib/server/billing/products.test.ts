import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const productsUpsert = vi.fn();
const productsUpdate = vi.fn();
const pricesUpsert = vi.fn();
const pricesUpdate = vi.fn();
const pricesSelect = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({
	withAdmin: vi.fn((_op, _actor, fn) =>
		fn({
			from: (table: string) => {
				if (table === 'stripe_products') {
					return {
						upsert: productsUpsert,
						update: productsUpdate
					};
				}
				if (table === 'stripe_prices') {
					return {
						upsert: pricesUpsert,
						update: pricesUpdate,
						select: pricesSelect
					};
				}
				throw new Error(`unexpected table ${table}`);
			}
		})
	)
}));

const stripeProductsRetrieve = vi.fn();
vi.mock('$lib/server/stripe', () => ({
	stripe: () => ({
		products: { retrieve: stripeProductsRetrieve }
	})
}));

function fakeProduct(over: Partial<Stripe.Product> = {}): Stripe.Product {
	return {
		id: 'prod_test_123',
		object: 'product',
		active: true,
		name: 'Pro',
		description: 'The pro plan',
		metadata: { tier: 'pro', tier_rank: '1' },
		created: 1_700_000_000,
		updated: 1_700_000_500,
		tax_code: 'txcd_10103001',
		...over
	} as Stripe.Product;
}

function fakePrice(over: Partial<Stripe.Price> = {}): Stripe.Price {
	return {
		id: 'price_test_abc',
		object: 'price',
		active: true,
		product: 'prod_test_123',
		lookup_key: 'contactly_pro_monthly',
		unit_amount: 1500,
		currency: 'usd',
		type: 'recurring',
		recurring: { interval: 'month', interval_count: 1 },
		tax_behavior: 'exclusive',
		metadata: { tier: 'pro' },
		created: 1_700_000_000,
		...over
	} as unknown as Stripe.Price;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('upsertStripeProduct', () => {
	it('writes a row mapped from the Stripe payload', async () => {
		productsUpsert.mockResolvedValueOnce({ error: null });
		const { upsertStripeProduct } = await import('./products');
		await upsertStripeProduct(fakeProduct());
		expect(productsUpsert).toHaveBeenCalledOnce();
		const call = productsUpsert.mock.calls[0]!;
		const [row, opts] = call;
		expect(opts).toEqual({ onConflict: 'id' });
		expect(row).toMatchObject({
			id: 'prod_test_123',
			active: true,
			name: 'Pro',
			tax_code: 'txcd_10103001',
			metadata: { tier: 'pro', tier_rank: '1' }
		});
		expect(row.stripe_created_at).toBe('2023-11-14T22:13:20.000Z');
	});

	it('throws on a DB error so the webhook receiver returns 500', async () => {
		productsUpsert.mockResolvedValueOnce({
			error: { code: '08006', message: 'connection_failure' }
		});
		const { upsertStripeProduct } = await import('./products');
		await expect(upsertStripeProduct(fakeProduct())).rejects.toThrow(/upsertStripeProduct failed/);
	});

	it('handles a tax_code expanded to an object', async () => {
		productsUpsert.mockResolvedValueOnce({ error: null });
		const { upsertStripeProduct } = await import('./products');
		await upsertStripeProduct(
			fakeProduct({ tax_code: { id: 'txcd_other', object: 'tax_code' } as Stripe.TaxCode })
		);
		const [row] = productsUpsert.mock.calls[0]!;
		expect(row.tax_code).toBe('txcd_other');
	});
});

describe('upsertStripePrice', () => {
	it('writes a row mapped from the Stripe payload', async () => {
		pricesUpsert.mockResolvedValueOnce({ error: null });
		const { upsertStripePrice } = await import('./products');
		await upsertStripePrice(fakePrice());
		expect(pricesUpsert).toHaveBeenCalledOnce();
		const [row, opts] = pricesUpsert.mock.calls[0]!;
		expect(opts).toEqual({ onConflict: 'id' });
		expect(row).toMatchObject({
			id: 'price_test_abc',
			product_id: 'prod_test_123',
			lookup_key: 'contactly_pro_monthly',
			unit_amount: 1500,
			currency: 'usd',
			type: 'recurring',
			recurring_interval: 'month',
			recurring_interval_count: 1,
			tax_behavior: 'exclusive'
		});
	});

	it('writes a one-time price with null recurrence fields', async () => {
		pricesUpsert.mockResolvedValueOnce({ error: null });
		const { upsertStripePrice } = await import('./products');
		await upsertStripePrice(fakePrice({ type: 'one_time', recurring: null }));
		const [row] = pricesUpsert.mock.calls[0]!;
		expect(row.type).toBe('one_time');
		expect(row.recurring_interval).toBeNull();
		expect(row.recurring_interval_count).toBeNull();
	});

	it('rejects a malformed recurring price (type=recurring but recurring=null)', async () => {
		const { upsertStripePrice } = await import('./products');
		await expect(upsertStripePrice(fakePrice({ recurring: null }))).rejects.toThrow(
			/Stripe payload is malformed/
		);
		expect(pricesUpsert).not.toHaveBeenCalled();
	});

	it('backfills the parent product on a foreign-key violation, then retries once', async () => {
		pricesUpsert
			.mockResolvedValueOnce({ error: { code: '23503', message: 'fk violation' } })
			.mockResolvedValueOnce({ error: null });
		productsUpsert.mockResolvedValueOnce({ error: null });
		stripeProductsRetrieve.mockResolvedValueOnce(fakeProduct());

		const { upsertStripePrice } = await import('./products');
		await upsertStripePrice(fakePrice());

		expect(stripeProductsRetrieve).toHaveBeenCalledWith('prod_test_123');
		expect(productsUpsert).toHaveBeenCalledOnce();
		expect(pricesUpsert).toHaveBeenCalledTimes(2);
	});

	it('throws on a non-FK DB error', async () => {
		pricesUpsert.mockResolvedValueOnce({
			error: { code: '08006', message: 'connection_failure' }
		});
		const { upsertStripePrice } = await import('./products');
		await expect(upsertStripePrice(fakePrice())).rejects.toThrow(/upsertStripePrice failed/);
		expect(stripeProductsRetrieve).not.toHaveBeenCalled();
	});

	it('throws if the retry after backfill still fails', async () => {
		pricesUpsert
			.mockResolvedValueOnce({ error: { code: '23503', message: 'fk violation' } })
			.mockResolvedValueOnce({ error: { code: '23503', message: 'still missing' } });
		productsUpsert.mockResolvedValueOnce({ error: null });
		stripeProductsRetrieve.mockResolvedValueOnce(fakeProduct());

		const { upsertStripePrice } = await import('./products');
		await expect(upsertStripePrice(fakePrice())).rejects.toThrow(/retry failed/);
	});
});

describe('deleteStripeProduct / deleteStripePrice', () => {
	it('archives instead of physically deleting a product', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: null });
		productsUpdate.mockReturnValueOnce({ eq: eqFn });
		const { deleteStripeProduct } = await import('./products');
		await deleteStripeProduct('prod_test_123');
		expect(productsUpdate).toHaveBeenCalledOnce();
		const [updateArg] = productsUpdate.mock.calls[0]!;
		expect(updateArg.active).toBe(false);
		expect(eqFn).toHaveBeenCalledWith('id', 'prod_test_123');
	});

	it('archives a price', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: null });
		pricesUpdate.mockReturnValueOnce({ eq: eqFn });
		const { deleteStripePrice } = await import('./products');
		await deleteStripePrice('price_test_abc');
		const [updateArg] = pricesUpdate.mock.calls[0]!;
		expect(updateArg).toEqual({ active: false });
		expect(eqFn).toHaveBeenCalledWith('id', 'price_test_abc');
	});

	it('throws on archive failure (so the webhook handler returns 500)', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: { code: '42501', message: 'denied' } });
		productsUpdate.mockReturnValueOnce({ eq: eqFn });
		const { deleteStripeProduct } = await import('./products');
		await expect(deleteStripeProduct('prod_test_123')).rejects.toThrow(/failed to archive/);
	});
});

describe('listActivePlans', () => {
	function mockListResult(rows: unknown[]) {
		const eqType = vi.fn().mockResolvedValueOnce({ data: rows, error: null });
		const eqActive = { eq: eqType };
		pricesSelect.mockReturnValueOnce({ eq: vi.fn(() => eqActive) });
	}

	it('joins prices with their products and sorts by tier_rank then interval', async () => {
		mockListResult([
			{
				id: 'price_business_yearly',
				lookup_key: 'contactly_business_yearly',
				unit_amount: 30000,
				currency: 'usd',
				recurring_interval: 'year',
				product: {
					id: 'prod_business',
					name: 'Business',
					description: null,
					metadata: { tier: 'business', tier_rank: '2' },
					active: true
				}
			},
			{
				id: 'price_pro_monthly',
				lookup_key: 'contactly_pro_monthly',
				unit_amount: 1500,
				currency: 'usd',
				recurring_interval: 'month',
				product: {
					id: 'prod_pro',
					name: 'Pro',
					description: 'Pro plan',
					metadata: { tier: 'pro', tier_rank: '1' },
					active: true
				}
			},
			{
				id: 'price_pro_yearly',
				lookup_key: 'contactly_pro_yearly',
				unit_amount: 15000,
				currency: 'usd',
				recurring_interval: 'year',
				product: {
					id: 'prod_pro',
					name: 'Pro',
					description: 'Pro plan',
					metadata: { tier: 'pro', tier_rank: '1' },
					active: true
				}
			}
		]);

		const { listActivePlans } = await import('./products');
		const plans = await listActivePlans();

		expect(plans.map((p) => p.lookup_key)).toEqual([
			'contactly_pro_monthly',
			'contactly_pro_yearly',
			'contactly_business_yearly'
		]);
	});

	it('filters out rows whose joined product is inactive', async () => {
		mockListResult([
			{
				id: 'price_dead',
				lookup_key: 'contactly_pro_monthly',
				unit_amount: 1500,
				currency: 'usd',
				recurring_interval: 'month',
				product: {
					id: 'prod_dead',
					name: 'Pro (archived)',
					description: null,
					metadata: {},
					active: false
				}
			}
		]);
		const { listActivePlans } = await import('./products');
		const plans = await listActivePlans();
		expect(plans).toEqual([]);
	});

	it('throws on DB error', async () => {
		const eqType = vi
			.fn()
			.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'down' } });
		pricesSelect.mockReturnValueOnce({ eq: vi.fn(() => ({ eq: eqType })) });
		const { listActivePlans } = await import('./products');
		await expect(listActivePlans()).rejects.toThrow(/listActivePlans failed/);
	});
});
