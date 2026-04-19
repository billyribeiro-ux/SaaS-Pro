import { describe, expect, it, vi } from 'vitest';
import { loadCassette } from './cassette-loader';
import {
	CassettePlaybackError,
	outcomesOfType,
	playCassette,
	type CassetteTransport
} from './cassette-driver';
import { signWebhookBody } from './webhook-signing';

const TEST_SECRET = 'whsec_unit_test_placeholder_secret_DO_NOT_USE';

/**
 * Trivial transport that always returns 200 + the JSON body the
 * receiver normally sends. Used by tests that care about driver
 * behaviour, not handler behaviour.
 */
function alwaysOk(): CassetteTransport {
	return () => new Response(JSON.stringify({ received: true }), { status: 200 });
}

/**
 * Transport that returns a status keyed by index — `[200, 500, 200]`
 * means event 1 succeeds, event 2 explodes, event 3 succeeds. The
 * driver's `stopOnError` semantics are pinned against this.
 */
function statusSequence(statuses: number[]): CassetteTransport {
	let i = 0;
	return () => {
		const status = statuses[i++] ?? 200;
		const body = status === 200 ? JSON.stringify({ received: true }) : 'boom';
		return new Response(body, { status });
	};
}

describe('playCassette', () => {
	it('drives every event in order and collects outcomes', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const result = await playCassette(cassette, {
			transport: alwaysOk(),
			secret: TEST_SECRET
		});
		expect(result.outcomes).toHaveLength(cassette.events.length);
		expect(result.outcomes.every((o) => o.status === 200)).toBe(true);
		// Order is preserved.
		const playedIds = result.outcomes.map((o) => o.event.id);
		const cassetteIds = cassette.events.map((e) => e.event.id);
		expect(playedIds).toEqual(cassetteIds);
	});

	it('parses JSON response bodies into `outcome.body`', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const result = await playCassette(cassette, {
			transport: alwaysOk(),
			secret: TEST_SECRET
		});
		expect(result.outcomes[0]?.body).toEqual({ received: true });
	});

	it('passes the cassette through unchanged on the result', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const result = await playCassette(cassette, {
			transport: alwaysOk(),
			secret: TEST_SECRET
		});
		expect(result.cassette).toBe(cassette);
	});

	it('signs each request with the configured secret', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const captured: Request[] = [];
		const transport: CassetteTransport = async (req) => {
			// Clone so the body is consumable both here AND if downstream
			// code wanted to read it.
			captured.push(req.clone());
			return new Response(JSON.stringify({ received: true }), { status: 200 });
		};
		await playCassette(cassette, { transport, secret: TEST_SECRET, timestampSeconds: 12_345 });

		expect(captured).toHaveLength(cassette.events.length);
		// Cross-check signature byte-equality against the helper.
		for (let i = 0; i < captured.length; i++) {
			const req = captured[i]!;
			const body = await req.text();
			const expected = signWebhookBody(body, TEST_SECRET, { timestampSeconds: 12_345 }).signature;
			expect(req.headers.get('stripe-signature')).toBe(expected);
		}
	});

	it('continues past failures by default and records every status', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		// 5-event cassette; fail #2 and #4.
		const result = await playCassette(cassette, {
			transport: statusSequence([200, 500, 200, 400, 200]),
			secret: TEST_SECRET
		});
		expect(result.outcomes.map((o) => o.status)).toEqual([200, 500, 200, 400, 200]);
	});

	it('throws CassettePlaybackError at the first non-2xx when stopOnError=true', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		await expect(
			playCassette(cassette, {
				transport: statusSequence([200, 500, 200, 200, 200]),
				secret: TEST_SECRET,
				stopOnError: true
			})
		).rejects.toBeInstanceOf(CassettePlaybackError);
	});

	it('CassettePlaybackError exposes the partial result for inspection', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		try {
			await playCassette(cassette, {
				transport: statusSequence([200, 500, 200]),
				secret: TEST_SECRET,
				stopOnError: true
			});
			expect.fail('should have thrown');
		} catch (err) {
			if (!(err instanceof CassettePlaybackError)) throw err;
			// Two outcomes — the success and the failure that tripped it.
			expect(err.result.outcomes).toHaveLength(2);
			expect(err.result.outcomes[0]?.status).toBe(200);
			expect(err.result.outcomes[1]?.status).toBe(500);
		}
	});

	it('treats a non-JSON body as the raw text', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const transport: CassetteTransport = () =>
			new Response('plain old text', { status: 200, headers: { 'content-type': 'text/plain' } });
		const result = await playCassette(cassette, { transport, secret: TEST_SECRET });
		expect(result.outcomes[0]?.body).toBe('plain old text');
	});

	it('treats an empty body as null', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		// Status 200 with an empty body — Response disallows bodies on
		// 204/205/304, so 200 is the cleanest "ack with no payload"
		// shape for this assertion.
		const transport: CassetteTransport = () => new Response('', { status: 200 });
		const result = await playCassette(cassette, { transport, secret: TEST_SECRET });
		expect(result.outcomes[0]?.body).toBeNull();
	});

	it('awaits async transports', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const transport = vi.fn(
			async () =>
				new Promise<Response>((resolve) =>
					setTimeout(() => resolve(new Response('{}', { status: 200 })), 1)
				)
		);
		const result = await playCassette(cassette, { transport, secret: TEST_SECRET });
		expect(transport).toHaveBeenCalledTimes(cassette.events.length);
		expect(result.outcomes.every((o) => o.status === 200)).toBe(true);
	});
});

describe('outcomesOfType', () => {
	it('filters by exact event type string', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const result = await playCassette(cassette, { transport: alwaysOk(), secret: TEST_SECRET });
		const filtered = outcomesOfType(result, 'invoice.paid');
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.event.id).toBe('evt_test_keep_005_invoice_paid');
	});

	it('filters by predicate', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const result = await playCassette(cassette, { transport: alwaysOk(), secret: TEST_SECRET });
		const subscriptionEvents = outcomesOfType(result, (t) => t.startsWith('customer.subscription'));
		expect(subscriptionEvents.map((o) => o.event.type)).toEqual([
			'customer.subscription.created',
			'customer.subscription.updated'
		]);
	});

	it('returns an empty array when nothing matches', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const result = await playCassette(cassette, { transport: alwaysOk(), secret: TEST_SECRET });
		expect(outcomesOfType(result, 'payout.paid')).toEqual([]);
	});
});
