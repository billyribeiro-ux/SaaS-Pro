import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const upsertSelect = vi.fn();
const upsertChain = { select: upsertSelect };
const fromUpsert = vi.fn(() => upsertChain);
const fromSelect = vi.fn();
const fromUpdate = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({
	withAdmin: vi.fn((_op, _actor, fn) =>
		fn({
			from: () => ({
				upsert: fromUpsert,
				select: fromSelect,
				update: fromUpdate
			})
		})
	)
}));

function fakeEvent(id = 'evt_test_123'): Stripe.Event {
	return {
		id,
		type: 'invoice.paid',
		api_version: '2026-03-25.dahlia',
		livemode: false,
		created: 0,
		data: { object: {} },
		object: 'event',
		pending_webhooks: 0,
		request: { id: null, idempotency_key: null }
	} as unknown as Stripe.Event;
}

describe('recordStripeEvent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	it('returns "fresh" when the upsert inserts a new row', async () => {
		upsertSelect.mockResolvedValueOnce({ data: [{ id: 'evt_test_123' }], error: null });
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent());
		expect(result).toBe('fresh');
		expect(fromUpsert).toHaveBeenCalledOnce();
	});

	it('returns "retry" when the row exists but processed_at is null', async () => {
		upsertSelect.mockResolvedValueOnce({ data: [], error: null });
		const eqChain = {
			maybeSingle: vi.fn().mockResolvedValue({ data: { processed_at: null }, error: null })
		};
		fromSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent());
		expect(result).toBe('retry');
	});

	it('returns "already-processed" when the existing row has processed_at set', async () => {
		upsertSelect.mockResolvedValueOnce({ data: [], error: null });
		const eqChain = {
			maybeSingle: vi
				.fn()
				.mockResolvedValue({ data: { processed_at: '2026-04-19T11:00:00Z' }, error: null })
		};
		fromSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent());
		expect(result).toBe('already-processed');
	});

	it('returns "failed" when the insert errors', async () => {
		upsertSelect.mockResolvedValueOnce({
			data: null,
			error: { code: '08006', message: 'connection_failure' }
		});
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent());
		expect(result).toBe('failed');
	});

	it('returns "failed" when the read-back errors', async () => {
		upsertSelect.mockResolvedValueOnce({ data: [], error: null });
		const eqChain = {
			maybeSingle: vi.fn().mockResolvedValue({
				data: null,
				error: { code: '42501', message: 'permission denied' }
			})
		};
		fromSelect.mockReturnValueOnce({ eq: vi.fn(() => eqChain) });
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent());
		expect(result).toBe('failed');
	});

	it('returns "failed" when the underlying call throws synchronously', async () => {
		upsertSelect.mockImplementationOnce(() => {
			throw new Error('network exploded');
		});
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent());
		expect(result).toBe('failed');
	});
});

describe('markStripeEventProcessed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	it('completes silently on success', async () => {
		const isFn = vi.fn().mockResolvedValue({ error: null });
		fromUpdate.mockReturnValueOnce({ eq: vi.fn(() => ({ is: isFn })) });
		const { markStripeEventProcessed } = await import('./stripe-events-store');
		await expect(markStripeEventProcessed('evt_test_123')).resolves.toBeUndefined();
	});

	it('logs a warning but does not throw on failure', async () => {
		const isFn = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'oops' } });
		fromUpdate.mockReturnValueOnce({ eq: vi.fn(() => ({ is: isFn })) });
		const { markStripeEventProcessed } = await import('./stripe-events-store');
		await expect(markStripeEventProcessed('evt_test_123')).resolves.toBeUndefined();
		expect(console.warn).toHaveBeenCalled();
	});
});
