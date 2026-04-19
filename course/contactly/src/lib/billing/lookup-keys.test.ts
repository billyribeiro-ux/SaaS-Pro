import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
	BILLING_INTERVALS,
	isLookupKey,
	LOOKUP_KEYS,
	lookupKeyFor,
	parseLookupKey,
	PAID_TIERS,
	type LookupKey
} from './lookup-keys';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesPath = resolve(here, '../../../stripe/fixtures/products.json');

interface StripeFixture {
	name: string;
	path: string;
	method: string;
	params: Record<string, unknown> & { lookup_key?: string };
}
interface FixturesFile {
	fixtures: StripeFixture[];
}

describe('billing/lookup-keys', () => {
	it('lookupKeyFor generates every key in LOOKUP_KEYS exactly once', () => {
		const generated = PAID_TIERS.flatMap((tier) =>
			BILLING_INTERVALS.map((interval) => lookupKeyFor(tier, interval))
		);
		expect(new Set(generated)).toEqual(new Set(LOOKUP_KEYS));
		expect(generated).toHaveLength(LOOKUP_KEYS.length);
	});

	it('parseLookupKey round-trips every LOOKUP_KEY', () => {
		for (const key of LOOKUP_KEYS) {
			const parsed = parseLookupKey(key);
			expect(lookupKeyFor(parsed.tier, parsed.interval)).toBe(key);
		}
	});

	it('isLookupKey accepts every known key and rejects typos', () => {
		for (const key of LOOKUP_KEYS) expect(isLookupKey(key)).toBe(true);
		expect(isLookupKey('contactly_pro_montly')).toBe(false);
		expect(isLookupKey('pro_monthly')).toBe(false);
		expect(isLookupKey(null)).toBe(false);
		expect(isLookupKey(42)).toBe(false);
	});

	it('every LOOKUP_KEY is declared in stripe/fixtures/products.json', () => {
		const contents = readFileSync(fixturesPath, 'utf-8');
		const parsed = JSON.parse(contents) as FixturesFile;
		const fixturesKeys = parsed.fixtures
			.filter((f) => f.path === '/v1/prices')
			.map((f) => f.params.lookup_key)
			.filter((k): k is LookupKey => typeof k === 'string' && isLookupKey(k));
		expect(new Set(fixturesKeys)).toEqual(new Set(LOOKUP_KEYS));
	});

	it('stripe/fixtures/products.json has no EXTRA lookup keys the app does not know about', () => {
		const contents = readFileSync(fixturesPath, 'utf-8');
		const parsed = JSON.parse(contents) as FixturesFile;
		const fixturesKeys = parsed.fixtures
			.filter((f) => f.path === '/v1/prices')
			.map((f) => f.params.lookup_key);
		for (const key of fixturesKeys) {
			expect(isLookupKey(key)).toBe(true);
		}
	});
});
