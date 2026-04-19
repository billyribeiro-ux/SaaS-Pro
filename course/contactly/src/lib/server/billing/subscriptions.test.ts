import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const customersSelect = vi.fn();
const subsUpsert = vi.fn();
const subsSelect = vi.fn();
const pricesSelect = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({
	withAdmin: vi.fn((_op, _actor, fn) =>
		fn({
			from: (table: string) => {
				if (table === 'stripe_customers') return { select: customersSelect };
				if (table === 'stripe_subscriptions') return { upsert: subsUpsert, select: subsSelect };
				if (table === 'stripe_prices') return { select: pricesSelect };
				throw new Error(`unexpected table ${table}`);
			}
		})
	)
}));

const upsertStripePriceMock = vi.fn();
vi.mock('$lib/server/billing/products', () => ({
	upsertStripePrice: upsertStripePriceMock
}));

const stripePricesRetrieve = vi.fn();
vi.mock('$lib/server/stripe', () => ({
	stripe: () => ({
		prices: { retrieve: stripePricesRetrieve }
	})
}));

function fakePrice(over: Partial<Stripe.Price> = {}): Stripe.Price {
	return {
		id: 'price_pro_monthly',
		object: 'price',
		active: true,
		product: 'prod_pro',
		lookup_key: 'contactly_pro_monthly',
		unit_amount: 1500,
		currency: 'usd',
		type: 'recurring',
		recurring: { interval: 'month', interval_count: 1 },
		metadata: { tier: 'pro' },
		created: 0,
		...over
	} as unknown as Stripe.Price;
}

function fakeSubscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
	const item = {
		id: 'si_test',
		price: fakePrice(),
		current_period_start: 1_700_000_000,
		current_period_end: 1_702_678_400
	};
	return {
		id: 'sub_test_xyz',
		object: 'subscription',
		customer: 'cus_test_abc',
		status: 'active',
		cancel_at_period_end: false,
		trial_start: null,
		trial_end: null,
		canceled_at: null,
		cancel_at: null,
		created: 1_700_000_000,
		items: { object: 'list', data: [item] },
		...over
	} as unknown as Stripe.Subscription;
}

function mockUserLookup(userId: string | null) {
	const eqChain = {
		maybeSingle: vi.fn().mockResolvedValueOnce({
			data: userId ? { user_id: userId } : null,
			error: null
		})
	};
	customersSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('upsertSubscription', () => {
	it('upserts a row mirroring the Stripe payload', async () => {
		mockUserLookup('user_uuid_42');
		subsUpsert.mockResolvedValueOnce({ error: null });
		const { upsertSubscription } = await import('./subscriptions');
		await upsertSubscription(fakeSubscription());

		expect(subsUpsert).toHaveBeenCalledOnce();
		const [row, opts] = subsUpsert.mock.calls[0]!;
		expect(opts).toEqual({ onConflict: 'id' });
		expect(row).toMatchObject({
			id: 'sub_test_xyz',
			user_id: 'user_uuid_42',
			stripe_customer_id: 'cus_test_abc',
			status: 'active',
			price_id: 'price_pro_monthly',
			cancel_at_period_end: false,
			tier_snapshot: 'pro'
		});
		expect(row.current_period_start).toBe('2023-11-14T22:13:20.000Z');
		expect(row.current_period_end).toBe('2023-12-15T22:13:20.000Z');
	});

	it('skips silently with a warning when status is unknown', async () => {
		const { upsertSubscription } = await import('./subscriptions');
		await upsertSubscription(
			fakeSubscription({ status: 'something_new_stripe_added' as Stripe.Subscription.Status })
		);
		expect(subsUpsert).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalled();
	});

	it('skips silently when no stripe_customers row exists for the customer', async () => {
		mockUserLookup(null);
		const { upsertSubscription } = await import('./subscriptions');
		await upsertSubscription(fakeSubscription());
		expect(subsUpsert).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalled();
	});

	it('throws when the subscription has no item (cannot derive price)', async () => {
		mockUserLookup('user_uuid_42');
		const { upsertSubscription } = await import('./subscriptions');
		await expect(
			upsertSubscription(
				fakeSubscription({
					items: { object: 'list', data: [] } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>
				})
			)
		).rejects.toThrow(/has no price on its first item/);
	});

	it('backfills price + retries on FK violation', async () => {
		mockUserLookup('user_uuid_42');
		subsUpsert
			.mockResolvedValueOnce({ error: { code: '23503', message: 'fk' } })
			.mockResolvedValueOnce({ error: null });
		stripePricesRetrieve.mockResolvedValueOnce(fakePrice());
		upsertStripePriceMock.mockResolvedValueOnce(undefined);

		const { upsertSubscription } = await import('./subscriptions');
		await upsertSubscription(fakeSubscription());

		expect(stripePricesRetrieve).toHaveBeenCalledWith('price_pro_monthly');
		expect(upsertStripePriceMock).toHaveBeenCalledOnce();
		expect(subsUpsert).toHaveBeenCalledTimes(2);
	});

	it('throws loudly on unique-violation (the second-active-sub-per-user invariant)', async () => {
		mockUserLookup('user_uuid_42');
		subsUpsert.mockResolvedValueOnce({
			error: { code: '23505', message: 'duplicate key value violates unique constraint' }
		});
		const { upsertSubscription } = await import('./subscriptions');
		await expect(upsertSubscription(fakeSubscription())).rejects.toThrow(
			/DUPLICATE active subscription/
		);
	});

	it('throws on non-FK / non-unique DB error', async () => {
		mockUserLookup('user_uuid_42');
		subsUpsert.mockResolvedValueOnce({
			error: { code: '08006', message: 'connection_failure' }
		});
		const { upsertSubscription } = await import('./subscriptions');
		await expect(upsertSubscription(fakeSubscription())).rejects.toThrow(
			/upsertSubscription failed/
		);
		expect(stripePricesRetrieve).not.toHaveBeenCalled();
	});

	it('mirrors trial fields when present', async () => {
		mockUserLookup('user_uuid_42');
		subsUpsert.mockResolvedValueOnce({ error: null });
		const { upsertSubscription } = await import('./subscriptions');
		await upsertSubscription(
			fakeSubscription({
				status: 'trialing',
				trial_start: 1_700_000_000,
				trial_end: 1_700_604_800
			})
		);
		const [row] = subsUpsert.mock.calls[0]!;
		expect(row.status).toBe('trialing');
		expect(row.trial_start).toBe('2023-11-14T22:13:20.000Z');
		expect(row.trial_end).toBe('2023-11-21T22:13:20.000Z');
	});
});

describe('handleSubscriptionTrialWillEnd', () => {
	it('logs only (notification wiring lands later)', async () => {
		const { handleSubscriptionTrialWillEnd } = await import('./subscriptions');
		await handleSubscriptionTrialWillEnd(fakeSubscription({ trial_end: 1_700_604_800 }));
		expect(console.info).toHaveBeenCalled();
		expect(subsUpsert).not.toHaveBeenCalled();
	});
});

describe('getActiveSubscription', () => {
	function mockActiveLookup(row: unknown) {
		const inChain = {
			maybeSingle: vi.fn().mockResolvedValueOnce({ data: row, error: null })
		};
		const eqChain = { in: vi.fn(() => inChain) };
		subsSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
	}

	it('returns the row when a trialing/active/past_due subscription exists', async () => {
		mockActiveLookup({
			id: 'sub_a',
			user_id: 'u1',
			status: 'active',
			price_id: 'price_pro_monthly'
		});
		const { getActiveSubscription } = await import('./subscriptions');
		const sub = await getActiveSubscription('u1');
		expect(sub?.id).toBe('sub_a');
	});

	it('returns null when there is no active subscription', async () => {
		mockActiveLookup(null);
		const { getActiveSubscription } = await import('./subscriptions');
		expect(await getActiveSubscription('u1')).toBeNull();
	});

	it('throws on DB error', async () => {
		const inChain = {
			maybeSingle: vi
				.fn()
				.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'down' } })
		};
		const eqChain = { in: vi.fn(() => inChain) };
		subsSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
		const { getActiveSubscription } = await import('./subscriptions');
		await expect(getActiveSubscription('u1')).rejects.toThrow(/getActiveSubscription failed/);
	});
});

describe('tierForUser', () => {
	function mockActiveLookup(row: unknown) {
		const inChain = {
			maybeSingle: vi.fn().mockResolvedValueOnce({ data: row, error: null })
		};
		const eqChain = { in: vi.fn(() => inChain) };
		subsSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
	}
	function mockPriceLookup(lookupKey: string | null) {
		const eqChain = {
			maybeSingle: vi
				.fn()
				.mockResolvedValueOnce({ data: lookupKey ? { lookup_key: lookupKey } : null, error: null })
		};
		pricesSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
	}

	it('returns "starter" when there is no active subscription', async () => {
		mockActiveLookup(null);
		const { tierForUser } = await import('./subscriptions');
		expect(await tierForUser('u1')).toBe('starter');
	});

	it('returns "pro" for a contactly_pro_* lookup key', async () => {
		mockActiveLookup({ id: 'sub_a', price_id: 'price_pro_monthly', status: 'active' });
		mockPriceLookup('contactly_pro_monthly');
		const { tierForUser } = await import('./subscriptions');
		expect(await tierForUser('u1')).toBe('pro');
	});

	it('returns "business" for a contactly_business_* lookup key', async () => {
		mockActiveLookup({ id: 'sub_b', price_id: 'price_biz_yearly', status: 'active' });
		mockPriceLookup('contactly_business_yearly');
		const { tierForUser } = await import('./subscriptions');
		expect(await tierForUser('u1')).toBe('business');
	});

	it('falls back to starter (with warn) when the active price has no recognized lookup key', async () => {
		mockActiveLookup({ id: 'sub_c', price_id: 'price_legacy', status: 'active' });
		mockPriceLookup('legacy_key_we_dont_know');
		const { tierForUser } = await import('./subscriptions');
		expect(await tierForUser('u1')).toBe('starter');
		expect(console.warn).toHaveBeenCalled();
	});

	it('falls back to starter when the active price is missing entirely', async () => {
		mockActiveLookup({ id: 'sub_d', price_id: 'price_missing', status: 'active' });
		mockPriceLookup(null);
		const { tierForUser } = await import('./subscriptions');
		expect(await tierForUser('u1')).toBe('starter');
	});
});
