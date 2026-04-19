import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

const TEST_SECRET = 'whsec_unit_test_placeholder_secret_DO_NOT_USE';

vi.mock('$lib/server/env', () => ({
	serverEnv: {
		STRIPE_SECRET_KEY: 'sk_test_unit_test_placeholder_key_DO_NOT_USE',
		STRIPE_WEBHOOK_SECRET: TEST_SECRET
	}
}));

// Default: every event looks `fresh` so the dispatcher runs. Tests
// that need a different storage outcome re-mock per case via
// `vi.doMock`.
vi.mock('$lib/server/stripe-events-store', () => ({
	recordStripeEvent: vi.fn().mockResolvedValue('fresh'),
	markStripeEventProcessed: vi.fn().mockResolvedValue(undefined)
}));

/**
 * Compose the canonical `Stripe-Signature` header value the SDK
 * verifies against. Mirrors `stripe.webhooks.generateTestHeaderString`
 * but inlined so we don't depend on an SDK helper that might move.
 *
 * Format: `t=<timestamp>,v1=<HMAC-SHA256(secret, "<timestamp>.<payload>")>`
 */
function signPayload(
	payload: string,
	secret: string,
	timestampSeconds = Math.floor(Date.now() / 1000)
) {
	const signedPayload = `${timestampSeconds}.${payload}`;
	const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
	return `t=${timestampSeconds},v1=${signature}`;
}

function makeEventBody(type: string, id = 'evt_test_unit') {
	return JSON.stringify({
		id,
		object: 'event',
		api_version: '2026-03-25.dahlia',
		created: Math.floor(Date.now() / 1000),
		livemode: false,
		pending_webhooks: 0,
		request: { id: null, idempotency_key: null },
		type,
		data: { object: { id: 'obj_test_unit', object: 'subscription', status: 'active' } }
	});
}

describe('POST /api/webhooks/stripe', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function callPost(req: Request) {
		const mod = await import('./+server');
		// SvelteKit's RequestHandler is invoked with a partial event;
		// the handler only reads `request`, so a minimal stub suffices.
		return (mod.POST as (e: { request: Request }) => Promise<Response>)({ request: req });
	}

	it('returns 400 when the stripe-signature header is missing', async () => {
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			body: makeEventBody('invoice.paid')
		});
		await expect(callPost(req)).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when the signature does not verify', async () => {
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': 't=1,v1=deadbeef' },
			body: makeEventBody('invoice.paid')
		});
		await expect(callPost(req)).rejects.toMatchObject({ status: 400 });
	});

	it('returns 200 for a valid, subscribed event', async () => {
		const body = makeEventBody('invoice.paid');
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': signPayload(body, TEST_SECRET) },
			body
		});
		const res = await callPost(req);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ received: true });
	});

	it('returns 200 for a valid event we do not subscribe to (silent ack)', async () => {
		const body = makeEventBody('payout.paid');
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': signPayload(body, TEST_SECRET) },
			body
		});
		const res = await callPost(req);
		expect(res.status).toBe(200);
	});

	it('returns 500 when the dispatched handler throws', async () => {
		// Re-mock the dispatch module to throw.
		vi.doMock('$lib/server/stripe-events', () => ({
			dispatchStripeEvent: vi.fn().mockRejectedValue(new Error('boom: db down'))
		}));
		const body = makeEventBody('invoice.paid');
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': signPayload(body, TEST_SECRET) },
			body
		});
		await expect(callPost(req)).rejects.toMatchObject({ status: 500 });
	});

	it('returns 200 + duplicate flag when the event has already been processed', async () => {
		vi.doMock('$lib/server/stripe-events-store', () => ({
			recordStripeEvent: vi.fn().mockResolvedValue('already-processed'),
			markStripeEventProcessed: vi.fn()
		}));
		const body = makeEventBody('invoice.paid');
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': signPayload(body, TEST_SECRET) },
			body
		});
		const res = await callPost(req);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ received: true, duplicate: true });
	});

	it('still dispatches when the event row exists but processing previously failed (retry)', async () => {
		const dispatchSpy = vi.fn().mockResolvedValue({ kind: 'handled', type: 'invoice.paid' });
		const markSpy = vi.fn().mockResolvedValue(undefined);
		vi.doMock('$lib/server/stripe-events-store', () => ({
			recordStripeEvent: vi.fn().mockResolvedValue('retry'),
			markStripeEventProcessed: markSpy
		}));
		vi.doMock('$lib/server/stripe-events', () => ({
			dispatchStripeEvent: dispatchSpy
		}));
		const body = makeEventBody('invoice.paid');
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': signPayload(body, TEST_SECRET) },
			body
		});
		const res = await callPost(req);
		expect(res.status).toBe(200);
		expect(dispatchSpy).toHaveBeenCalledOnce();
		expect(markSpy).toHaveBeenCalledOnce();
	});

	it('returns 500 when the storage layer fails to record the event', async () => {
		vi.doMock('$lib/server/stripe-events-store', () => ({
			recordStripeEvent: vi.fn().mockResolvedValue('failed'),
			markStripeEventProcessed: vi.fn()
		}));
		const body = makeEventBody('invoice.paid');
		const req = new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			headers: { 'stripe-signature': signPayload(body, TEST_SECRET) },
			body
		});
		await expect(callPost(req)).rejects.toMatchObject({ status: 500 });
	});
});
