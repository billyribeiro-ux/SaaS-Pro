import { describe, expect, it } from 'vitest';
import type { ActivePlanRow } from '$lib/server/billing/products';
import { buildPricingCatalog, formatCurrency } from './catalog';
import { LOOKUP_KEYS } from './lookup-keys';

/**
 * Build a fully-populated set of rows that mirrors what `listActivePlans()`
 * returns when the seed fixtures (`stripe/fixtures/products.json`) are
 * loaded. Each test starts from a deep-ish clone so individual cases can
 * mutate fields without bleeding into siblings.
 */
function fixtureRows(): ActivePlanRow[] {
	return [
		{
			price_id: 'price_pro_monthly_test',
			lookup_key: 'contactly_pro_monthly',
			unit_amount: 1900,
			currency: 'usd',
			recurring_interval: 'month',
			product_id: 'prod_contactly_pro',
			product_name: 'Contactly Pro',
			product_description: 'For individual professionals.',
			product_metadata: { tier: 'pro', tier_rank: '1' }
		},
		{
			price_id: 'price_pro_yearly_test',
			lookup_key: 'contactly_pro_yearly',
			unit_amount: 19000,
			currency: 'usd',
			recurring_interval: 'year',
			product_id: 'prod_contactly_pro',
			product_name: 'Contactly Pro',
			product_description: 'For individual professionals.',
			product_metadata: { tier: 'pro', tier_rank: '1' }
		},
		{
			price_id: 'price_business_monthly_test',
			lookup_key: 'contactly_business_monthly',
			unit_amount: 4900,
			currency: 'usd',
			recurring_interval: 'month',
			product_id: 'prod_contactly_business',
			product_name: 'Contactly Business',
			product_description: 'For small teams.',
			product_metadata: { tier: 'business', tier_rank: '2' }
		},
		{
			price_id: 'price_business_yearly_test',
			lookup_key: 'contactly_business_yearly',
			unit_amount: 49000,
			currency: 'usd',
			recurring_interval: 'year',
			product_id: 'prod_contactly_business',
			product_name: 'Contactly Business',
			product_description: 'For small teams.',
			product_metadata: { tier: 'business', tier_rank: '2' }
		}
	];
}

describe('billing/catalog — buildPricingCatalog', () => {
	it('returns Starter, Pro, Business in that exact order', () => {
		const cards = buildPricingCatalog(fixtureRows());
		expect(cards.map((c) => c.tier)).toEqual(['starter', 'pro', 'business']);
	});

	it('Starter is always present even when the input is empty (it is the absence of a subscription)', () => {
		const cards = buildPricingCatalog([]);
		expect(cards).toHaveLength(3);
		expect(cards[0]?.tier).toBe('starter');
		expect(cards[0]?.prices.monthly).toBeNull();
		expect(cards[0]?.prices.yearly).toBeNull();
		// Pro / Business cards still render their static copy + bullets,
		// just with no prices — so the page can still show "Coming soon".
		expect(cards[1]?.tier).toBe('pro');
		expect(cards[1]?.prices.monthly).toBeNull();
		expect(cards[1]?.prices.yearly).toBeNull();
	});

	it('marks Pro as the recommended tier and nothing else', () => {
		const cards = buildPricingCatalog(fixtureRows());
		const recommended = cards.filter((c) => c.recommended).map((c) => c.tier);
		expect(recommended).toEqual(['pro']);
	});

	it('formats USD prices as whole-dollar headlines with the right interval suffix', () => {
		const cards = buildPricingCatalog(fixtureRows());
		const pro = cards.find((c) => c.tier === 'pro');
		expect(pro?.prices.monthly?.formatted).toBe('$19/mo');
		expect(pro?.prices.yearly?.formatted).toBe('$190/yr');

		const biz = cards.find((c) => c.tier === 'business');
		expect(biz?.prices.monthly?.formatted).toBe('$49/mo');
		expect(biz?.prices.yearly?.formatted).toBe('$490/yr');
	});

	it('computes monthlyEquivalentCents only for yearly prices', () => {
		const cards = buildPricingCatalog(fixtureRows());
		const pro = cards.find((c) => c.tier === 'pro');
		expect(pro?.prices.monthly?.monthlyEquivalentCents).toBeNull();
		// 19000 / 12 = 1583.33… → rounded to nearest cent
		expect(pro?.prices.yearly?.monthlyEquivalentCents).toBe(1583);
	});

	it('preserves price IDs and currency from the input row (drives the Checkout URL in Module 9)', () => {
		const cards = buildPricingCatalog(fixtureRows());
		const proMonthly = cards.find((c) => c.tier === 'pro')?.prices.monthly;
		expect(proMonthly?.priceId).toBe('price_pro_monthly_test');
		expect(proMonthly?.lookupKey).toBe('contactly_pro_monthly');
		expect(proMonthly?.currency).toBe('usd');
	});

	it('hides the yearly interval when only monthly is in the mirror', () => {
		const rows = fixtureRows().filter((r) => r.recurring_interval !== 'year');
		const cards = buildPricingCatalog(rows);
		const pro = cards.find((c) => c.tier === 'pro');
		expect(pro?.prices.monthly).not.toBeNull();
		expect(pro?.prices.yearly).toBeNull();
	});

	it('drops rows with a NULL lookup_key (one-off SKUs are not part of the public catalog)', () => {
		const rows = fixtureRows();
		// Mutate the Pro monthly row to look like a hand-created Dashboard SKU.
		rows[0]!.lookup_key = null;
		const cards = buildPricingCatalog(rows);
		const pro = cards.find((c) => c.tier === 'pro');
		expect(pro?.prices.monthly).toBeNull();
	});

	it('drops rows with a NULL unit_amount (display would be ambiguous)', () => {
		const rows = fixtureRows();
		rows[0]!.unit_amount = null;
		const cards = buildPricingCatalog(rows);
		expect(cards.find((c) => c.tier === 'pro')?.prices.monthly).toBeNull();
	});

	it('drops rows with an unrecognized recurring_interval (e.g. weekly trials we never sell)', () => {
		const rows = fixtureRows();
		// `recurring_interval` is the DB enum — assigning an out-of-band
		// value here matches what would happen if Stripe added a new
		// interval before our DB enum was migrated.
		rows[0]!.recurring_interval = 'week' as ActivePlanRow['recurring_interval'];
		const cards = buildPricingCatalog(rows);
		expect(cards.find((c) => c.tier === 'pro')?.prices.monthly).toBeNull();
	});

	it('exposes a curated feature list for every tier (single source of truth for marketing copy)', () => {
		const cards = buildPricingCatalog(fixtureRows());
		for (const card of cards) {
			expect(card.features.length).toBeGreaterThanOrEqual(3);
			expect(card.name.length).toBeGreaterThan(0);
			expect(card.tagline.length).toBeGreaterThan(0);
		}
	});

	it('every fixture lookup key resolves to a card price (smoke check vs lookup-keys.ts)', () => {
		const cards = buildPricingCatalog(fixtureRows());
		const found = new Set<string>();
		for (const card of cards) {
			if (card.prices.monthly) found.add(card.prices.monthly.lookupKey);
			if (card.prices.yearly) found.add(card.prices.yearly.lookupKey);
		}
		expect(found).toEqual(new Set(LOOKUP_KEYS));
	});
});

describe('billing/catalog — formatCurrency', () => {
	it('matches the headline format used inside the cards', () => {
		expect(formatCurrency(1900, 'usd', 'monthly')).toBe('$19/mo');
		expect(formatCurrency(19000, 'usd', 'yearly')).toBe('$190/yr');
	});

	it('uppercases lowercase ISO currency codes', () => {
		// Sanity check: callers pulling `currency` straight from Stripe
		// pass lowercase; Intl.NumberFormat requires uppercase. We do
		// the conversion ourselves to keep callers ignorant of that quirk.
		expect(() => formatCurrency(1900, 'usd', 'monthly')).not.toThrow();
	});
});
