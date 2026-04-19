import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Logger } from '$lib/server/logger';

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

/**
 * Test-double logger (Module 10.1). The store accepts an optional
 * `Logger` so we can assert structured-log shape from the call sites
 * without touching `console.*`. Keeping this minimal — only the
 * methods the store actually uses are typed.
 */
function fakeLogger(): Logger & {
	__calls: { warn: unknown[][]; error: unknown[][] };
} {
	const calls = { warn: [] as unknown[][], error: [] as unknown[][] };
	const log = {
		warn: (...args: unknown[]) => calls.warn.push(args),
		error: (...args: unknown[]) => calls.error.push(args),
		info: () => {},
		debug: () => {},
		trace: () => {},
		fatal: () => {},
		child: () => log,
		__calls: calls
	};
	return log as unknown as Logger & {
		__calls: { warn: unknown[][]; error: unknown[][] };
	};
}

describe('recordStripeEvent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		const log = fakeLogger();
		const { recordStripeEvent } = await import('./stripe-events-store');
		const result = await recordStripeEvent(fakeEvent(), log);
		expect(result).toBe('failed');
		expect(log.__calls.error).toHaveLength(1);
		expect(log.__calls.error[0]?.[0]).toMatchObject({
			pg_code: '08006',
			err: 'connection_failure'
		});
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
		const log = fakeLogger();
		const { markStripeEventProcessed } = await import('./stripe-events-store');
		await expect(markStripeEventProcessed('evt_test_123', log)).resolves.toBeUndefined();
		expect(log.__calls.warn).toHaveLength(1);
		expect(log.__calls.warn[0]?.[0]).toMatchObject({
			pg_code: '23505',
			err: 'oops'
		});
	});
});
