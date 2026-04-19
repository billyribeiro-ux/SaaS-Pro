import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
	STRIPE_SIGNATURE_SCHEME,
	buildSignedWebhookRequest,
	signWebhookBody,
	signWebhookEvent
} from './webhook-signing';

const TEST_SECRET = 'whsec_unit_test_placeholder_secret_DO_NOT_USE';

describe('signWebhookBody', () => {
	it('produces a `t=<sec>,v1=<hex>` header value', () => {
		const out = signWebhookBody('{"hello":"world"}', TEST_SECRET, { timestampSeconds: 1000 });
		expect(out.signature).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
		expect(out.timestamp).toBe(1000);
		expect(out.body).toBe('{"hello":"world"}');
	});

	it('the v1= digest equals an independent HMAC-SHA256 over `${ts}.${body}`', () => {
		const body = '{"id":"evt_xyz","type":"invoice.paid"}';
		const ts = 1745000000;
		const out = signWebhookBody(body, TEST_SECRET, { timestampSeconds: ts });
		const expected = createHmac('sha256', TEST_SECRET).update(`${ts}.${body}`).digest('hex');
		expect(out.signature).toBe(`t=${ts},${STRIPE_SIGNATURE_SCHEME}=${expected}`);
	});

	it('different timestamps produce different signatures for the same body', () => {
		const a = signWebhookBody('x', TEST_SECRET, { timestampSeconds: 1000 });
		const b = signWebhookBody('x', TEST_SECRET, { timestampSeconds: 2000 });
		expect(a.signature).not.toBe(b.signature);
	});

	it('different bodies produce different signatures for the same timestamp', () => {
		const a = signWebhookBody('one', TEST_SECRET, { timestampSeconds: 1000 });
		const b = signWebhookBody('two', TEST_SECRET, { timestampSeconds: 1000 });
		expect(a.signature).not.toBe(b.signature);
	});

	it('throws when the secret is empty (no silent garbage signature)', () => {
		expect(() => signWebhookBody('x', '')).toThrowError(/secret is empty/);
	});

	it('defaults to a fresh timestamp when none is passed', () => {
		const before = Math.floor(Date.now() / 1000);
		const out = signWebhookBody('x', TEST_SECRET);
		const after = Math.floor(Date.now() / 1000);
		expect(out.timestamp).toBeGreaterThanOrEqual(before);
		expect(out.timestamp).toBeLessThanOrEqual(after + 1);
	});
});

describe('signWebhookEvent', () => {
	it('serializes the event object and signs the resulting bytes', () => {
		const event = { id: 'evt_x', object: 'event', type: 'invoice.paid' };
		const out = signWebhookEvent(event, TEST_SECRET, { timestampSeconds: 1000 });
		expect(out.body).toBe(JSON.stringify(event));
		const expected = createHmac('sha256', TEST_SECRET)
			.update(`1000.${JSON.stringify(event)}`)
			.digest('hex');
		expect(out.signature).toBe(`t=1000,v1=${expected}`);
	});

	it('signed bytes match exactly what `body` reports back', () => {
		// Critical invariant: the body we POST MUST be the exact bytes
		// we hashed. A `JSON.stringify` round-trip in between would
		// rewrite whitespace and break the HMAC.
		const event = { id: 'evt_x', nested: { a: 1, b: [1, 2] } };
		const out = signWebhookEvent(event, TEST_SECRET);
		const recomputed = createHmac('sha256', TEST_SECRET)
			.update(`${out.timestamp}.${out.body}`)
			.digest('hex');
		expect(out.signature).toBe(`t=${out.timestamp},v1=${recomputed}`);
	});
});

describe('buildSignedWebhookRequest', () => {
	it('returns a Request the SvelteKit handler can consume directly', async () => {
		const event = { id: 'evt_demo', object: 'event', type: 'invoice.paid' };
		const req = buildSignedWebhookRequest(event, TEST_SECRET, { timestampSeconds: 1000 });
		expect(req.method).toBe('POST');
		expect(req.headers.get('stripe-signature')).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
		expect(req.headers.get('content-type')).toBe('application/json');
		// The body bytes are exactly the JSON serialization of `event`.
		const raw = await req.text();
		expect(raw).toBe(JSON.stringify(event));
	});

	it('targets /api/webhooks/stripe by default', () => {
		const req = buildSignedWebhookRequest({ id: 'evt_x', object: 'event' }, TEST_SECRET);
		expect(new URL(req.url).pathname).toBe('/api/webhooks/stripe');
	});

	it('honours a url override for tests against a future mount point', () => {
		const req = buildSignedWebhookRequest({ id: 'evt_x', object: 'event' }, TEST_SECRET, {
			url: 'http://localhost/api/webhooks/stripe-v2'
		});
		expect(new URL(req.url).pathname).toBe('/api/webhooks/stripe-v2');
	});
});
