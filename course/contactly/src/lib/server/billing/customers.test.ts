import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const customersUpsert = vi.fn();
const customersUpdate = vi.fn();
const customersDelete = vi.fn();
const customersSelect = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({
	withAdmin: vi.fn((_op, _actor, fn) =>
		fn({
			from: (table: string) => {
				if (table !== 'stripe_customers') {
					throw new Error(`unexpected table ${table}`);
				}
				return {
					upsert: customersUpsert,
					update: customersUpdate,
					delete: customersDelete,
					select: customersSelect
				};
			}
		})
	)
}));

const stripeCustomersCreate = vi.fn();
vi.mock('$lib/server/stripe', () => ({
	stripe: () => ({
		customers: { create: stripeCustomersCreate }
	}),
	withIdempotencyKey: <T>(key: string, fn: (key: string) => Promise<T>) => fn(key)
}));

function fakeStripeCustomer(over: Partial<Stripe.Customer> = {}): Stripe.Customer {
	return {
		id: 'cus_test_abc',
		object: 'customer',
		email: 'user@example.com',
		metadata: { user_id: 'user_uuid_123' },
		created: 0,
		...over
	} as Stripe.Customer;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ensureStripeCustomer', () => {
	function mockCacheHit(customerId: string | null) {
		const eqChain = {
			maybeSingle: vi.fn().mockResolvedValueOnce({
				data: customerId ? { stripe_customer_id: customerId } : null,
				error: null
			})
		};
		customersSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
	}

	it('returns the cached id without hitting Stripe', async () => {
		mockCacheHit('cus_existing_xyz');
		const { ensureStripeCustomer } = await import('./customers');
		const id = await ensureStripeCustomer({ userId: 'user_uuid_123' });
		expect(id).toBe('cus_existing_xyz');
		expect(stripeCustomersCreate).not.toHaveBeenCalled();
		expect(customersUpsert).not.toHaveBeenCalled();
	});

	it('creates a Stripe customer + caches it on first call', async () => {
		mockCacheHit(null);
		stripeCustomersCreate.mockResolvedValueOnce(fakeStripeCustomer({ id: 'cus_new_001' }));
		customersUpsert.mockResolvedValueOnce({ error: null });

		const { ensureStripeCustomer } = await import('./customers');
		const id = await ensureStripeCustomer({
			userId: 'user_uuid_123',
			email: 'user@example.com'
		});

		expect(id).toBe('cus_new_001');
		expect(stripeCustomersCreate).toHaveBeenCalledOnce();
		const [createBody, createOpts] = stripeCustomersCreate.mock.calls[0]!;
		expect(createBody).toEqual({
			email: 'user@example.com',
			metadata: { user_id: 'user_uuid_123' }
		});
		expect(createOpts).toEqual({ idempotencyKey: 'ensure-customer-user-user_uuid_123' });

		expect(customersUpsert).toHaveBeenCalledOnce();
		const [row, upsertOpts] = customersUpsert.mock.calls[0]!;
		expect(row).toEqual({
			user_id: 'user_uuid_123',
			stripe_customer_id: 'cus_new_001',
			email: 'user@example.com'
		});
		expect(upsertOpts).toEqual({ onConflict: 'user_id' });
	});

	it('omits email from the Stripe payload when not provided', async () => {
		mockCacheHit(null);
		stripeCustomersCreate.mockResolvedValueOnce(
			fakeStripeCustomer({ id: 'cus_new_002', email: null })
		);
		customersUpsert.mockResolvedValueOnce({ error: null });

		const { ensureStripeCustomer } = await import('./customers');
		await ensureStripeCustomer({ userId: 'user_uuid_456' });

		const [createBody] = stripeCustomersCreate.mock.calls[0]!;
		expect(createBody.email).toBeUndefined();
		expect(createBody.metadata).toEqual({ user_id: 'user_uuid_456' });
	});

	it('throws on cache-read failure (caller surfaces 5xx)', async () => {
		const eqChain = {
			maybeSingle: vi
				.fn()
				.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'down' } })
		};
		customersSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
		const { ensureStripeCustomer } = await import('./customers');
		await expect(ensureStripeCustomer({ userId: 'user_uuid_123' })).rejects.toThrow(
			/readCachedCustomer failed/
		);
		expect(stripeCustomersCreate).not.toHaveBeenCalled();
	});

	it('throws on upsert failure after a successful Stripe create', async () => {
		mockCacheHit(null);
		stripeCustomersCreate.mockResolvedValueOnce(fakeStripeCustomer({ id: 'cus_new_003' }));
		customersUpsert.mockResolvedValueOnce({
			error: { code: '23505', message: 'duplicate' }
		});
		const { ensureStripeCustomer } = await import('./customers');
		await expect(ensureStripeCustomer({ userId: 'user_uuid_xyz' })).rejects.toThrow(
			/upsertCustomerRow failed/
		);
	});
});

describe('handleCustomerCreated', () => {
	it('upserts a row when metadata.user_id is present', async () => {
		customersUpsert.mockResolvedValueOnce({ error: null });
		const { handleCustomerCreated } = await import('./customers');
		await handleCustomerCreated(fakeStripeCustomer());
		expect(customersUpsert).toHaveBeenCalledOnce();
		const [row] = customersUpsert.mock.calls[0]!;
		expect(row).toEqual({
			user_id: 'user_uuid_123',
			stripe_customer_id: 'cus_test_abc',
			email: 'user@example.com'
		});
	});

	it('skips silently (with a warn log) when metadata.user_id is missing', async () => {
		const { handleCustomerCreated } = await import('./customers');
		await handleCustomerCreated(fakeStripeCustomer({ metadata: {} }));
		expect(customersUpsert).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalled();
	});
});

describe('handleCustomerUpdated', () => {
	it('updates the email by stripe_customer_id', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: null });
		customersUpdate.mockReturnValueOnce({ eq: eqFn });
		const { handleCustomerUpdated } = await import('./customers');
		await handleCustomerUpdated(fakeStripeCustomer({ email: 'new@example.com' }));
		const [updateArg] = customersUpdate.mock.calls[0]!;
		expect(updateArg).toEqual({ email: 'new@example.com' });
		expect(eqFn).toHaveBeenCalledWith('stripe_customer_id', 'cus_test_abc');
	});

	it('throws on DB error (so the receiver returns 500 and Stripe retries)', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: { code: '08006', message: 'down' } });
		customersUpdate.mockReturnValueOnce({ eq: eqFn });
		const { handleCustomerUpdated } = await import('./customers');
		await expect(handleCustomerUpdated(fakeStripeCustomer())).rejects.toThrow(
			/handleCustomerUpdated failed/
		);
	});
});

describe('handleCustomerDeleted', () => {
	it('physically deletes the local mapping', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: null });
		customersDelete.mockReturnValueOnce({ eq: eqFn });
		const { handleCustomerDeleted } = await import('./customers');
		await handleCustomerDeleted({
			id: 'cus_test_abc',
			deleted: true,
			object: 'customer'
		} as Stripe.DeletedCustomer);
		expect(customersDelete).toHaveBeenCalledOnce();
		expect(eqFn).toHaveBeenCalledWith('stripe_customer_id', 'cus_test_abc');
	});

	it('throws on DB error', async () => {
		const eqFn = vi.fn().mockResolvedValueOnce({ error: { code: '42501', message: 'denied' } });
		customersDelete.mockReturnValueOnce({ eq: eqFn });
		const { handleCustomerDeleted } = await import('./customers');
		await expect(
			handleCustomerDeleted({
				id: 'cus_test_abc',
				deleted: true,
				object: 'customer'
			} as Stripe.DeletedCustomer)
		).rejects.toThrow(/handleCustomerDeleted failed/);
	});
});
