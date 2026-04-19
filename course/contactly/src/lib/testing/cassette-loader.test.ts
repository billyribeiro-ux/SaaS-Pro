import { describe, expect, it } from 'vitest';
import { CASSETTES_DIR, listCassettes, loadCassette } from './cassette-loader';
import { CASSETTE_VERSION } from './cassette';

describe('cassette-loader', () => {
	it('lists every .cassette.json file in the cassettes directory, sorted', () => {
		const names = listCassettes();
		// At least the seed cassette from Lesson 12.1 must be present.
		expect(names).toContain('subscribe-pro-monthly-keep');
		// Sorted, so test diffs are stable when new cassettes land.
		const sorted = [...names].sort();
		expect(names).toEqual(sorted);
	});

	it('loads and validates the seed cassette', () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		expect(cassette.version).toBe(CASSETTE_VERSION);
		expect(cassette.name).toBe('subscribe-pro-monthly-keep');
		expect(cassette.events.length).toBeGreaterThan(0);
	});

	it('every cassette on disk validates', () => {
		// The "no broken cassettes" sweep — adding a bad cassette
		// fails this test even if no individual scenario test
		// references it. Cheap insurance against silent rot.
		for (const name of listCassettes()) {
			expect(() => loadCassette(name)).not.toThrow();
		}
	});

	it('throws a helpful error for a missing cassette', () => {
		expect(() => loadCassette('does-not-exist')).toThrowError(
			/Cassette "does-not-exist" not found/
		);
	});

	it('error message lists available cassettes for discovery', () => {
		try {
			loadCassette('does-not-exist');
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain('Available cassettes:');
			expect(msg).toContain('subscribe-pro-monthly-keep');
		}
	});

	it('exposes CASSETTES_DIR so callers can write fresh cassettes in dev', () => {
		expect(CASSETTES_DIR).toMatch(/cassettes$/);
	});
});
