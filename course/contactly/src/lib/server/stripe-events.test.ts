import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';

// Mock the products service so the dispatch table doesn't actually
// hit Supabase. We're testing the *routing*, not the side effects;
// each service has its own dedicated test file.
vi.mock('$lib/server/billing/products', () => ({
	upsertStripeProduct: vi.fn().mockResolvedValue(undefined),
	upsertStripePrice: vi.fn().mockResolvedValue(undefined),
	deleteStripeProduct: vi.fn().mockResolvedValue(undefined),
	deleteStripePrice: vi.fn().mockResolvedValue(undefined)
}));

import { SUBSCRIBED_EVENTS, dispatchStripeEvent, isSubscribedEvent } from './stripe-events';

function fakeEvent<T extends string>(type: T, object: Record<string, unknown> = {}): Stripe.Event {
	return {
		id: `evt_test_${Math.random().toString(36).slice(2, 10)}`,
		object: 'event',
		api_version: '2026-03-25.dahlia',
		created: Math.floor(Date.now() / 1000),
		livemode: false,
		pending_webhooks: 0,
		request: { id: null, idempotency_key: null },
		type,
		data: {
			object: { id: 'obj_test', ...object } as unknown as Stripe.Event.Data['object']
		}
	} as unknown as Stripe.Event;
}

describe('isSubscribedEvent', () => {
	it('accepts events Contactly listens for', () => {
		for (const t of SUBSCRIBED_EVENTS) {
			expect(isSubscribedEvent(t)).toBe(true);
		}
	});

	it('rejects events Contactly does not handle', () => {
		expect(isSubscribedEvent('customer.tax_id.created')).toBe(false);
		expect(isSubscribedEvent('payout.paid')).toBe(false);
		expect(isSubscribedEvent('')).toBe(false);
	});
});

describe('dispatchStripeEvent', () => {
	beforeEach(() => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns "handled" for every subscribed event type', async () => {
		for (const t of SUBSCRIBED_EVENTS) {
			const result = await dispatchStripeEvent(fakeEvent(t));
			expect(result).toEqual({ kind: 'handled', type: t });
		}
	});

	it('returns "unhandled" without throwing for unknown event types', async () => {
		const result = await dispatchStripeEvent(fakeEvent('payout.paid'));
		expect(result).toEqual({ kind: 'unhandled', type: 'payout.paid' });
	});
});
