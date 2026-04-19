import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * Replay tests are mock-driven: we substitute `withAdmin`,
 * `dispatchStripeEvent`, and `markStripeEventProcessed` with vi
 * mocks so the suite never touches Postgres. The goal is to lock
 * in the *control flow* (when do we mark processed? when do we
 * skip? what shape does each outcome have?) — the side effects
 * themselves are covered end-to-end in Module 12.
 */

function silentLogger() {
	const noop = () => {};
	return {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		trace: noop,
		fatal: noop,
		child: () => silentLogger(),
		bindings: () => ({})
	};
}

const dispatchMock = vi.fn();
const markProcessedMock = vi.fn();
const withAdminMock = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({
	withAdmin: (label: string, actor: string, fn: (admin: unknown) => unknown) =>
		withAdminMock(label, actor, fn)
}));

vi.mock('$lib/server/stripe-events', () => ({
	dispatchStripeEvent: (event: Stripe.Event) => dispatchMock(event)
}));

vi.mock('$lib/server/stripe-events-store', () => ({
	markStripeEventProcessed: (id: string, log: unknown) => markProcessedMock(id, log)
}));

beforeEach(() => {
	dispatchMock.mockReset();
	markProcessedMock.mockReset();
	withAdminMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * Emulate Supabase's chainable query — `withAdmin` invokes the
 * provided function with a stand-in `admin` whose chained methods
 * return the value passed in here.
 */
function adminWithQueryResult(resultByLabel: Record<string, unknown>) {
	withAdminMock.mockImplementation(async (label: string) => {
		if (!(label in resultByLabel)) {
			throw new Error(`Unexpected withAdmin label in test: ${label}`);
		}
		return resultByLabel[label];
	});
}

const FRESH_PAYLOAD = {
	id: 'evt_replay_1',
	type: 'invoice.paid',
	data: { object: { id: 'in_1' } }
} as unknown as Stripe.Event;

describe('replayStripeEvent', () => {
	it('dispatches and marks processed for a fresh stuck event', async () => {
		adminWithQueryResult({
			'webhook-replay.read': {
				data: {
					id: 'evt_replay_1',
					type: 'invoice.paid',
					payload: FRESH_PAYLOAD,
					processed_at: null
				},
				error: null
			}
		});
		dispatchMock.mockResolvedValue({ kind: 'handled', type: 'invoice.paid' });

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_replay_1', silentLogger() as never);

		expect(outcome).toEqual({
			eventId: 'evt_replay_1',
			status: 'replayed',
			type: 'invoice.paid'
		});
		expect(dispatchMock).toHaveBeenCalledTimes(1);
		expect(markProcessedMock).toHaveBeenCalledWith('evt_replay_1', expect.anything());
	});

	it('returns "already-processed" without dispatching when processed_at is set', async () => {
		adminWithQueryResult({
			'webhook-replay.read': {
				data: {
					id: 'evt_done',
					type: 'invoice.paid',
					payload: FRESH_PAYLOAD,
					processed_at: '2026-04-19T13:00:00.000Z'
				},
				error: null
			}
		});

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_done', silentLogger() as never);

		expect(outcome).toEqual({
			eventId: 'evt_done',
			status: 'already-processed',
			type: 'invoice.paid'
		});
		expect(dispatchMock).not.toHaveBeenCalled();
		expect(markProcessedMock).not.toHaveBeenCalled();
	});

	it('returns "not-found" for an unknown id', async () => {
		adminWithQueryResult({
			'webhook-replay.read': { data: null, error: null }
		});

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_missing', silentLogger() as never);

		expect(outcome).toEqual({ eventId: 'evt_missing', status: 'not-found' });
		expect(dispatchMock).not.toHaveBeenCalled();
	});

	it('returns "failed" with the error message when dispatch throws', async () => {
		adminWithQueryResult({
			'webhook-replay.read': {
				data: {
					id: 'evt_boom',
					type: 'invoice.paid',
					payload: FRESH_PAYLOAD,
					processed_at: null
				},
				error: null
			}
		});
		dispatchMock.mockRejectedValue(new Error('handler exploded'));

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_boom', silentLogger() as never);

		expect(outcome).toEqual({
			eventId: 'evt_boom',
			status: 'failed',
			type: 'invoice.paid',
			error: 'handler exploded'
		});
		expect(markProcessedMock).not.toHaveBeenCalled();
	});

	it('returns "failed" when the row read errors', async () => {
		adminWithQueryResult({
			'webhook-replay.read': {
				data: null,
				error: { code: 'PG-XYZ', message: 'simulated outage' }
			}
		});

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_io', silentLogger() as never);

		expect(outcome).toEqual({
			eventId: 'evt_io',
			status: 'failed',
			error: 'simulated outage'
		});
		expect(dispatchMock).not.toHaveBeenCalled();
	});

	it('honours dryRun by skipping dispatch + markProcessed', async () => {
		adminWithQueryResult({
			'webhook-replay.read': {
				data: {
					id: 'evt_dry',
					type: 'invoice.paid',
					payload: FRESH_PAYLOAD,
					processed_at: null
				},
				error: null
			}
		});

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_dry', silentLogger() as never, { dryRun: true });

		expect(outcome).toEqual({ eventId: 'evt_dry', status: 'dry-run', type: 'invoice.paid' });
		expect(dispatchMock).not.toHaveBeenCalled();
		expect(markProcessedMock).not.toHaveBeenCalled();
	});

	it('treats an "unhandled" dispatch result as "replayed" and marks processed', async () => {
		// An "unhandled" type in the replay path means the row was
		// ingested historically with a type we no longer subscribe
		// to. The receiver returns 200 for these; replay matches.
		adminWithQueryResult({
			'webhook-replay.read': {
				data: {
					id: 'evt_unh',
					type: 'something.deprecated',
					payload: { ...FRESH_PAYLOAD, type: 'something.deprecated' },
					processed_at: null
				},
				error: null
			}
		});
		dispatchMock.mockResolvedValue({ kind: 'unhandled', type: 'something.deprecated' });

		const { replayStripeEvent } = await import('./webhook-replay');
		const outcome = await replayStripeEvent('evt_unh', silentLogger() as never);

		expect(outcome.status).toBe('replayed');
		expect(markProcessedMock).toHaveBeenCalledWith('evt_unh', expect.anything());
	});
});

describe('replayStuckEvents', () => {
	it('caps batch size at MAX_BATCH_REPLAY', async () => {
		const { MAX_BATCH_REPLAY, replayStuckEvents } = await import('./webhook-replay');
		const overflowIds = Array.from({ length: 100 }, (_, i) => ({ id: `evt_${i}` }));
		// listStuck returns the requested-many; verify the cap by
		// asserting the `.limit()` argument indirectly via the
		// number of mock calls below.
		const seenLimits: number[] = [];
		withAdminMock.mockImplementation(async (label: string, _actor: string, fn: unknown) => {
			if (label === 'webhook-replay.list-stuck') {
				const fakeAdmin = {
					from: () => ({
						select: () => ({
							is: () => ({
								lte: () => ({
									order: () => ({
										limit: (n: number) => {
											seenLimits.push(n);
											return { data: overflowIds.slice(0, n), error: null };
										}
									})
								})
							})
						})
					})
				};
				return await (fn as (a: unknown) => unknown)(fakeAdmin);
			}
			if (label === 'webhook-replay.read') {
				// Per-event read invoked from inside the loop. Each
				// event is dryRun-replayed in this test, which
				// fast-paths before dispatch / mark-processed.
				return {
					data: {
						id: 'evt_x',
						type: 'invoice.paid',
						payload: FRESH_PAYLOAD,
						processed_at: null
					},
					error: null
				};
			}
			throw new Error(`Unexpected label: ${label}`);
		});

		const result = await replayStuckEvents({ limit: 9999, dryRun: true }, silentLogger() as never);
		expect(seenLimits[0]).toBe(MAX_BATCH_REPLAY);
		expect(result.requested).toBeLessThanOrEqual(MAX_BATCH_REPLAY);
		expect(result.outcomes.every((o) => o.status === 'dry-run')).toBe(true);
	});

	it('returns empty result when the listing fails', async () => {
		withAdminMock.mockImplementation(async (label: string, _actor: string, fn: unknown) => {
			if (label === 'webhook-replay.list-stuck') {
				const fakeAdmin = {
					from: () => ({
						select: () => ({
							is: () => ({
								lte: () => ({
									order: () => ({
										limit: () => ({
											data: null,
											error: { code: 'PG-XYZ', message: 'fail' }
										})
									})
								})
							})
						})
					})
				};
				return await (fn as (a: unknown) => unknown)(fakeAdmin);
			}
			throw new Error(`Unexpected label: ${label}`);
		});

		const { replayStuckEvents } = await import('./webhook-replay');
		const result = await replayStuckEvents({}, silentLogger() as never);
		expect(result).toEqual({ requested: 0, outcomes: [] });
	});
});
