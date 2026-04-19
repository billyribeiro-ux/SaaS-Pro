import { describe, expect, it } from 'vitest';
import { CONTACT_CAP } from '$lib/billing/limits';
import { evaluateContactCap } from './contact-cap';

/**
 * The pure decision function is the contract — it owns the rule
 * and is what the rest of the code (sync banners, async gate,
 * future cached UI hints) leans on. We unit-test it directly so
 * we don't have to mock Supabase to assert business behavior.
 */

describe('billing/contact-cap — evaluateContactCap (Starter)', () => {
	it('allows when under cap and reports remaining', () => {
		const decision = evaluateContactCap({ tier: 'starter', currentCount: 10 });
		expect(decision).toEqual({
			allowed: true,
			tier: 'starter',
			limit: CONTACT_CAP.starter,
			used: 10,
			remaining: (CONTACT_CAP.starter as number) - 10
		});
	});

	it('refuses exactly at the cap (>=, not >)', () => {
		const limit = CONTACT_CAP.starter as number;
		const decision = evaluateContactCap({ tier: 'starter', currentCount: limit });
		expect(decision).toEqual({
			allowed: false,
			reason: 'cap_reached',
			tier: 'starter',
			limit,
			used: limit
		});
	});

	it('refuses past the cap (downgrade-stuck case)', () => {
		const limit = CONTACT_CAP.starter as number;
		const decision = evaluateContactCap({ tier: 'starter', currentCount: limit + 12 });
		expect(decision).toEqual({
			allowed: false,
			reason: 'cap_reached',
			tier: 'starter',
			limit,
			used: limit + 12
		});
	});

	it('treats negative counts as zero (defensive)', () => {
		const decision = evaluateContactCap({ tier: 'starter', currentCount: -5 });
		if (!decision.allowed) throw new Error('expected allowed for tier=starter, count=-5');
		expect(decision.used).toBe(0);
		expect(decision.remaining).toBe(CONTACT_CAP.starter);
	});

	it('truncates fractional counts (defensive)', () => {
		const decision = evaluateContactCap({ tier: 'starter', currentCount: 1.9 });
		if (!decision.allowed) throw new Error('expected allowed');
		expect(decision.used).toBe(1);
	});
});

describe('billing/contact-cap — evaluateContactCap (paid)', () => {
	it('Pro is unlimited (limit=null, remaining=null)', () => {
		const decision = evaluateContactCap({ tier: 'pro', currentCount: 50_000 });
		expect(decision).toEqual({
			allowed: true,
			tier: 'pro',
			limit: null,
			used: 50_000,
			remaining: null
		});
	});

	it('Business is unlimited (limit=null, remaining=null)', () => {
		const decision = evaluateContactCap({ tier: 'business', currentCount: 1_000_000 });
		expect(decision).toEqual({
			allowed: true,
			tier: 'business',
			limit: null,
			used: 1_000_000,
			remaining: null
		});
	});
});

describe('billing/contact-cap — limits table', () => {
	it('starter cap is finite, paid tiers are explicitly null (not Infinity)', () => {
		expect(typeof CONTACT_CAP.starter).toBe('number');
		expect(CONTACT_CAP.pro).toBeNull();
		expect(CONTACT_CAP.business).toBeNull();
	});
});
