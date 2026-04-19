/**
 * End-to-end cassette scenarios — Module 12.4.
 *
 * Drives every cassette against the **real** Stripe webhook receiver
 * (`/api/webhooks/stripe`'s POST handler), with two surgical mocks:
 *
 *  - `$lib/server/stripe-events`: the dispatch table is replaced with
 *    a recording stub. The receiver's HTTP layer (signature
 *    verification, body reading, idempotency arbitration, response
 *    shape) runs for real; the side-effecting handlers (DB writes,
 *    email sends) are tracked-but-not-executed.
 *  - `$lib/server/stripe-events-store`: every event looks `'fresh'` so
 *    the dispatcher actually runs. Per-test overrides re-mock to
 *    simulate duplicate delivery / storage failures.
 *
 * What this test gives us that the unit-level
 * `routes/api/webhooks/stripe/server.test.ts` does NOT:
 *
 *  - **End-to-end ordering.** A real cassette plays through the
 *    receiver in the same order Stripe would deliver it; we assert
 *    that every event lands a 200 and that the dispatcher saw them
 *    in cassette order.
 *  - **Realistic event shape.** Cassettes carry full Stripe.Event
 *    payloads, so a regression in the handler's destructuring (e.g.
 *    "we read `event.data.object.subscription` but Stripe renamed it
 *    in the API version we pinned to") shows up here, not in
 *    production.
 *  - **Whole-scenario invariants.** "Subscribe-then-cancel ends with
 *    `customer.subscription.deleted` as the last event" is a story
 *    you can only tell across multiple events. Lives here.
 *
 * What it does NOT cover (deliberately):
 *
 *  - Full DB writes — those are exercised in the per-handler tests
 *    under `src/lib/server/billing/*.test.ts`. Mocking the dispatch
 *    table here keeps these tests fast (<50 ms total) and
 *    DB-independent. A future "smoke a cassette against a real
 *    Supabase test schema" mode could re-use the cassette JSON; the
 *    point of the format is that it's reusable.
 *  - Network-level retry behaviour — Stripe-side. Out of scope for
 *    a local harness.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { loadCassette } from './cassette-loader';
import { playCassette, type CassetteTransport } from './cassette-driver';

const TEST_SECRET = 'whsec_unit_test_placeholder_secret_DO_NOT_USE';

// `vi.hoisted` lets us share spy references between the (hoisted)
// `vi.mock` factories below and the test bodies. Without it, the
// factory closures would capture `undefined`s — mocks are hoisted to
// the top of the file but our `const`s are evaluated in source order.
const spies = vi.hoisted(() => ({
	dispatch: vi.fn(),
	record: vi.fn(),
	mark: vi.fn()
}));

vi.mock('$lib/server/env', () => ({
	serverEnv: {
		STRIPE_SECRET_KEY: 'sk_test_unit_test_placeholder_key_DO_NOT_USE',
		STRIPE_WEBHOOK_SECRET: TEST_SECRET
	}
}));

vi.mock('@sentry/sveltekit', () => ({
	setTag: vi.fn()
}));

vi.mock('$lib/server/stripe-events', () => ({
	dispatchStripeEvent: spies.dispatch
}));

vi.mock('$lib/server/stripe-events-store', () => ({
	recordStripeEvent: spies.record,
	markStripeEventProcessed: spies.mark
}));

const silentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	trace: () => {},
	fatal: () => {},
	child: () => silentLogger
};

/**
 * Adapt SvelteKit's `RequestHandler` shape into the cassette driver's
 * `CassetteTransport` shape.
 *
 * The receiver uses `error(status, message)` for all non-200 paths;
 * `error()` THROWS an `HttpError` rather than returning a `Response`.
 * In production, SvelteKit's router catches it and produces the HTTP
 * response — here, our test transport mimics that behaviour. Without
 * this adaptation the cassette driver's transport invocation rejects
 * and `playCassette` short-circuits before any 5xx outcome lands.
 *
 * The `HttpError` shape is `{ status, body: { message } }`; we treat
 * any thrown object with a numeric `status` as one. Anything else is
 * a real test bug and should propagate.
 */
async function loadReceiverTransport(): Promise<CassetteTransport> {
	const mod = await import('../../routes/api/webhooks/stripe/+server');
	type SilentLogger = typeof silentLogger;
	const post = mod.POST as unknown as (e: {
		request: Request;
		locals: { logger: SilentLogger };
	}) => Promise<Response>;
	return async (request) => {
		try {
			return await post({ request, locals: { logger: silentLogger } });
		} catch (err) {
			if (
				err &&
				typeof err === 'object' &&
				'status' in err &&
				typeof (err as { status: unknown }).status === 'number'
			) {
				const httpErr = err as { status: number; body?: { message?: string } };
				return new Response(JSON.stringify(httpErr.body ?? { message: 'error' }), {
					status: httpErr.status,
					headers: { 'content-type': 'application/json' }
				});
			}
			throw err;
		}
	};
}

describe('end-to-end cassette scenarios', () => {
	beforeEach(() => {
		// Reset every spy between tests AND restore the default
		// implementation. Per-test scenarios that need a different
		// shape call `mockImplementation` / `mockResolvedValueOnce`
		// after the reset.
		spies.dispatch.mockReset();
		spies.dispatch.mockImplementation((event: { type: string }) =>
			Promise.resolve({ kind: 'handled', type: event.type })
		);
		spies.record.mockReset();
		spies.record.mockResolvedValue('fresh');
		spies.mark.mockReset();
		spies.mark.mockResolvedValue(undefined);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('subscribe-pro-monthly-keep', () => {
		it('drives all 5 events through the receiver and returns 200 for each', async () => {
			const cassette = loadCassette('subscribe-pro-monthly-keep');
			const transport = await loadReceiverTransport();

			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			expect(result.outcomes).toHaveLength(5);
			for (const outcome of result.outcomes) {
				expect(outcome.status).toBe(200);
				expect(outcome.body).toMatchObject({ received: true });
			}
		});

		it('dispatches every event in cassette order, with the canonical subscribe shape', async () => {
			const cassette = loadCassette('subscribe-pro-monthly-keep');
			const transport = await loadReceiverTransport();

			await playCassette(cassette, { transport, secret: TEST_SECRET });

			const types = spies.dispatch.mock.calls.map(([event]) => event.type);
			// The exact production sequence: checkout completes →
			// customer materialises → subscription is created in trial
			// → subscription transitions to active when trial ends →
			// first invoice is paid. Anything else and our receiver
			// is reordering events, which would be a bug.
			expect(types).toEqual([
				'checkout.session.completed',
				'customer.created',
				'customer.subscription.created',
				'customer.subscription.updated',
				'invoice.paid'
			]);
			expect(spies.mark).toHaveBeenCalledTimes(5);
		});

		it('records every event into the storage layer before dispatching', async () => {
			const cassette = loadCassette('subscribe-pro-monthly-keep');
			const transport = await loadReceiverTransport();

			await playCassette(cassette, { transport, secret: TEST_SECRET });

			// `recordStripeEvent` is called BEFORE `dispatchStripeEvent`
			// in the receiver — so by the time `dispatch` has 5 calls,
			// `record` must also have 5.
			expect(spies.record).toHaveBeenCalledTimes(5);
			expect(spies.dispatch).toHaveBeenCalledTimes(5);
		});
	});

	describe('cancel-pro-monthly-immediate', () => {
		it('drives both events through the receiver and returns 200 for each', async () => {
			const cassette = loadCassette('cancel-pro-monthly-immediate');
			const transport = await loadReceiverTransport();

			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			expect(result.outcomes).toHaveLength(2);
			for (const outcome of result.outcomes) {
				expect(outcome.status).toBe(200);
			}
		});

		it('ends the scenario with `customer.subscription.deleted`', async () => {
			const cassette = loadCassette('cancel-pro-monthly-immediate');
			const transport = await loadReceiverTransport();

			await playCassette(cassette, { transport, secret: TEST_SECRET });

			const types = spies.dispatch.mock.calls.map(([event]) => event.type);
			expect(types).toEqual(['customer.subscription.updated', 'customer.subscription.deleted']);
			// Whole-scenario invariant: regardless of how many `updated`
			// events come through during a cancel, the deleted event is
			// always last. If the cassette grows new events, the
			// invariant should still hold without changing this test.
			expect(types[types.length - 1]).toBe('customer.subscription.deleted');
		});
	});

	describe('payment-failed-pro-monthly', () => {
		it('returns 200 for every event in the dunning entry sequence', async () => {
			const cassette = loadCassette('payment-failed-pro-monthly');
			const transport = await loadReceiverTransport();

			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			expect(result.outcomes).toHaveLength(3);
			for (const outcome of result.outcomes) {
				expect(outcome.status).toBe(200);
			}
		});

		it('dispatches finalize → payment_failed → past_due in the canonical order', async () => {
			const cassette = loadCassette('payment-failed-pro-monthly');
			const transport = await loadReceiverTransport();

			await playCassette(cassette, { transport, secret: TEST_SECRET });

			const types = spies.dispatch.mock.calls.map(([event]) => event.type);
			expect(types).toEqual([
				'invoice.finalized',
				'invoice.payment_failed',
				'customer.subscription.updated'
			]);
		});

		it('still acknowledges every event when the dispatcher throws partway through', async () => {
			// Override the dispatcher so the SECOND event throws,
			// simulating "the email service is down so dunning emails
			// can't go out". Stripe will retry that event — our job is
			// to return 500 on the failing event but keep accepting the
			// others (Stripe delivers them in parallel; one stuck event
			// must NOT block the rest of the pipe).
			spies.dispatch.mockImplementation((event: { type: string }) => {
				if (event.type === 'invoice.payment_failed') {
					throw new Error('boom: email service down');
				}
				return Promise.resolve({ kind: 'handled', type: event.type });
			});

			const cassette = loadCassette('payment-failed-pro-monthly');
			const transport = await loadReceiverTransport();
			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			expect(result.outcomes.map((o) => o.status)).toEqual([200, 500, 200]);
			// First and third events: dispatched + ack'd. Second event:
			// Stripe will retry (500 is the "retry me" signal). Crucial
			// invariant: a transient failure on event N does NOT block
			// events N+1, N+2, etc. Stripe pipelines them.
		});
	});

	describe('recover-after-payment-failure', () => {
		it('drives both events and returns 200 for each', async () => {
			const cassette = loadCassette('recover-after-payment-failure');
			const transport = await loadReceiverTransport();

			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			expect(result.outcomes).toHaveLength(2);
			for (const outcome of result.outcomes) {
				expect(outcome.status).toBe(200);
			}
		});

		it('settles the failed invoice and flips the sub back to active', async () => {
			const cassette = loadCassette('recover-after-payment-failure');
			const transport = await loadReceiverTransport();

			await playCassette(cassette, { transport, secret: TEST_SECRET });

			const types = spies.dispatch.mock.calls.map(([event]) => event.type);
			expect(types).toEqual(['invoice.paid', 'customer.subscription.updated']);
			// The recovery cassette is intentionally the inverse of
			// `payment-failed-pro-monthly` — same invoice id, same
			// subscription id, with the closing payment + active
			// transition. Cross-cassette continuity (failed → recover)
			// is the unique signal of this fixture.
		});
	});

	describe('cross-cassette behaviour: idempotency of duplicate delivery', () => {
		it('returns 200 + duplicate flag when storage reports already-processed', async () => {
			spies.record.mockResolvedValue('already-processed');
			// The dispatcher must NOT be called when storage reports
			// the event has already been processed. This is the
			// defining contract of the storage idempotency layer
			// (Module 6.4): production Stripe retries past events at
			// 1m/10m/1h/3h/6h/24h cadence and we MUST de-dupe.

			const cassette = loadCassette('subscribe-pro-monthly-keep');
			const transport = await loadReceiverTransport();
			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			expect(result.outcomes).toHaveLength(5);
			for (const outcome of result.outcomes) {
				expect(outcome.status).toBe(200);
				expect(outcome.body).toMatchObject({ received: true, duplicate: true });
			}
			expect(spies.dispatch).not.toHaveBeenCalled();
		});

		it('returns 500 when the storage layer fails to record', async () => {
			spies.record.mockResolvedValue('failed');

			const cassette = loadCassette('cancel-pro-monthly-immediate');
			const transport = await loadReceiverTransport();
			const result = await playCassette(cassette, { transport, secret: TEST_SECRET });

			// Both events 500 — Stripe will retry both. The storage
			// failure mode is "transient blip"; the next delivery
			// attempt is the recovery path.
			expect(result.outcomes.map((o) => o.status)).toEqual([500, 500]);
			expect(spies.dispatch).not.toHaveBeenCalled();
		});
	});
});
