import { describe, expect, it } from 'vitest';
import { CASSETTE_VERSION, parseCassette, parseCassetteOrThrow, type Cassette } from './cassette';

/**
 * The minimum cassette that satisfies the schema. Tests that exercise
 * a single failure path build off this object so the diff between
 * "valid" and "broken in exactly one way" is one field.
 */
function validCassette(): unknown {
	return {
		version: CASSETTE_VERSION,
		name: 'minimal',
		description: 'Smallest cassette that satisfies the schema.',
		recordedAt: '2026-04-19T18:00:00.000Z',
		stripeApiVersion: '2026-03-25.dahlia',
		events: [
			{
				offsetMs: 0,
				event: {
					id: 'evt_minimal_001',
					object: 'event',
					type: 'invoice.paid',
					api_version: '2026-03-25.dahlia',
					created: 1745000000,
					livemode: false,
					pending_webhooks: 1,
					request: { id: null, idempotency_key: null },
					data: { object: { id: 'in_test_min' } }
				}
			}
		]
	};
}

describe('parseCassette', () => {
	it('accepts a minimum-shaped valid cassette', () => {
		const result = parseCassette(validCassette());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.cassette.name).toBe('minimal');
			expect(result.cassette.events).toHaveLength(1);
		}
	});

	it('rejects an unknown version', () => {
		const cassette = validCassette() as Record<string, unknown>;
		cassette.version = 999;
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.includes('version'))).toBe(true);
		}
	});

	it('rejects an empty events array', () => {
		const cassette = validCassette() as Record<string, unknown>;
		cassette.events = [];
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.join('\n')).toContain('at least one event');
		}
	});

	it('rejects a Stripe event id that does not start with `evt_`', () => {
		const cassette = validCassette() as { events: Array<{ event: { id: string } }> };
		const first = cassette.events[0]!;
		first.event.id = 'sub_test_001';
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.includes('evt_'))).toBe(true);
		}
	});

	it('rejects an event with `object !== "event"`', () => {
		const cassette = validCassette() as { events: Array<{ event: { object: string } }> };
		cassette.events[0]!.event.object = 'subscription';
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
	});

	it('rejects a malformed recordedAt', () => {
		const cassette = validCassette() as Record<string, unknown>;
		cassette.recordedAt = 'yesterday';
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.includes('recordedAt'))).toBe(true);
		}
	});

	it('rejects a negative offsetMs', () => {
		const cassette = validCassette() as { events: Array<{ offsetMs: number }> };
		cassette.events[0]!.offsetMs = -1;
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
	});

	it('rejects events that are not in non-decreasing offset order', () => {
		const cassette = validCassette() as { events: Array<unknown> };
		cassette.events.push({
			offsetMs: 5_000,
			event: {
				id: 'evt_minimal_002',
				object: 'event',
				type: 'invoice.paid',
				api_version: null,
				created: 1745000010,
				livemode: false,
				pending_webhooks: 1,
				request: null,
				data: { object: { id: 'in_test_min_2' } }
			}
		});
		cassette.events.push({
			// Out-of-order offset.
			offsetMs: 1_000,
			event: {
				id: 'evt_minimal_003',
				object: 'event',
				type: 'invoice.paid',
				api_version: null,
				created: 1745000005,
				livemode: false,
				pending_webhooks: 1,
				request: null,
				data: { object: { id: 'in_test_min_3' } }
			}
		});
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.includes('precedes'))).toBe(true);
		}
	});

	it('rejects duplicate event ids within the same cassette', () => {
		const cassette = validCassette() as { events: Array<unknown> };
		cassette.events.push({
			offsetMs: 1_000,
			event: {
				// Same id as events[0].
				id: 'evt_minimal_001',
				object: 'event',
				type: 'invoice.paid',
				api_version: null,
				created: 1745000010,
				livemode: false,
				pending_webhooks: 1,
				request: null,
				data: { object: { id: 'in_test_min' } }
			}
		});
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.includes('Duplicate event id'))).toBe(true);
		}
	});

	it('issue paths use dotted notation for downstream pretty-printing', () => {
		const cassette = validCassette() as Record<string, unknown>;
		delete cassette.name;
		const result = parseCassette(cassette);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.startsWith('name:'))).toBe(true);
		}
	});

	it('preserves event order under round-trip parse → JSON.stringify → parse', () => {
		const cassette = validCassette() as Record<string, unknown>;
		(cassette.events as Array<unknown>).push({
			offsetMs: 100,
			event: {
				id: 'evt_minimal_002',
				object: 'event',
				type: 'invoice.finalized',
				api_version: null,
				created: 1745000010,
				livemode: false,
				pending_webhooks: 1,
				request: null,
				data: { object: { id: 'in_test_min_2' } }
			}
		});
		const first = parseCassette(cassette);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const roundTripped = parseCassette(JSON.parse(JSON.stringify(first.cassette)));
		expect(roundTripped.ok).toBe(true);
		if (roundTripped.ok) {
			const ids = roundTripped.cassette.events.map((e) => e.event.id);
			expect(ids).toEqual(['evt_minimal_001', 'evt_minimal_002']);
		}
	});

	it('parseCassetteOrThrow returns the cassette directly on success', () => {
		const cassette: Cassette = parseCassetteOrThrow(validCassette());
		expect(cassette.events[0]?.event.id).toBe('evt_minimal_001');
	});

	it('parseCassetteOrThrow throws a multi-line message listing every issue', () => {
		const cassette = validCassette() as Record<string, unknown>;
		delete cassette.name;
		delete cassette.description;
		expect(() => parseCassetteOrThrow(cassette)).toThrowError(/Invalid cassette/);
		try {
			parseCassetteOrThrow(cassette);
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain('name:');
			expect(msg).toContain('description:');
		}
	});
});
