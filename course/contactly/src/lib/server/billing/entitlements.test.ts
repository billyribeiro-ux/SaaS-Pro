import { describe, expect, it } from 'vitest';
import type { Database } from '$lib/database.types';
import { snapshotFor } from './entitlements';

type SubscriptionRow = Database['public']['Tables']['stripe_subscriptions']['Row'];

/**
 * Build a synthetic subscription row. Defaults are sane for an
 * active, non-trialing, non-cancelling Pro user — each test
 * overrides only the fields it cares about.
 */
function fakeSubscription(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
	return {
		id: 'sub_test',
		user_id: 'usr_1',
		stripe_customer_id: 'cus_test',
		status: 'active',
		price_id: 'price_pro_monthly',
		cancel_at_period_end: false,
		current_period_start: '2026-04-01T00:00:00.000Z',
		current_period_end: '2026-05-01T00:00:00.000Z',
		trial_start: null,
		trial_end: null,
		canceled_at: null,
		cancel_at: null,
		tier_snapshot: 'pro',
		stripe_created_at: '2026-04-01T00:00:00.000Z',
		created_at: '2026-04-01T00:00:00.000Z',
		updated_at: '2026-04-01T00:00:00.000Z',
		...over
	};
}

describe('billing/entitlements — snapshotFor (Starter)', () => {
	it('returns the Starter snapshot when tier is starter', () => {
		const snap = snapshotFor({ tier: 'starter', subscription: null });
		expect(snap.tier).toBe('starter');
		expect(snap.isPaid).toBe(false);
		expect(snap.isTrialing).toBe(false);
		expect(snap.status).toBeNull();
		expect(snap.badgeLabel).toBe('Starter');
		expect(snap.badgeTone).toBe('starter');
		expect(snap.currentPeriodEnd).toBeNull();
		expect(snap.cancelAtPeriodEnd).toBe(false);
		expect(snap.trialEnd).toBeNull();
		expect(snap.priceId).toBeNull();
	});

	it('forces Starter when tier is paid but the subscription row is missing (defense in depth)', () => {
		const snap = snapshotFor({ tier: 'pro', subscription: null });
		expect(snap.tier).toBe('starter');
		expect(snap.isPaid).toBe(false);
		expect(snap.badgeLabel).toBe('Starter');
	});

	it('forces Starter when tier is starter even if a (probably canceled) row leaks through', () => {
		const snap = snapshotFor({
			tier: 'starter',
			subscription: fakeSubscription({ status: 'canceled' })
		});
		expect(snap.badgeLabel).toBe('Starter');
		expect(snap.priceId).toBeNull();
	});
});

describe('billing/entitlements — snapshotFor (Pro)', () => {
	it('produces a healthy Pro snapshot with the paid tone', () => {
		const snap = snapshotFor({ tier: 'pro', subscription: fakeSubscription() });
		expect(snap.tier).toBe('pro');
		expect(snap.isPaid).toBe(true);
		expect(snap.isTrialing).toBe(false);
		expect(snap.status).toBe('active');
		expect(snap.badgeLabel).toBe('Pro');
		expect(snap.badgeTone).toBe('paid');
		expect(snap.priceId).toBe('price_pro_monthly');
		expect(snap.currentPeriodEnd).toBe('2026-05-01T00:00:00.000Z');
	});

	it('marks isTrialing + trial tone when status is trialing', () => {
		const snap = snapshotFor({
			tier: 'pro',
			subscription: fakeSubscription({
				status: 'trialing',
				trial_start: '2026-04-01T00:00:00.000Z',
				trial_end: '2026-04-15T00:00:00.000Z'
			})
		});
		expect(snap.isPaid).toBe(true);
		expect(snap.isTrialing).toBe(true);
		expect(snap.badgeTone).toBe('trial');
		expect(snap.trialEnd).toBe('2026-04-15T00:00:00.000Z');
	});

	it('marks past_due tone when status is past_due (user keeps Pro features but sees the warning)', () => {
		const snap = snapshotFor({
			tier: 'pro',
			subscription: fakeSubscription({ status: 'past_due' })
		});
		expect(snap.isPaid).toBe(true);
		expect(snap.isTrialing).toBe(false);
		expect(snap.badgeTone).toBe('past_due');
	});

	it('surfaces cancel_at_period_end so /account can render "Cancels on …"', () => {
		const snap = snapshotFor({
			tier: 'pro',
			subscription: fakeSubscription({ cancel_at_period_end: true })
		});
		expect(snap.cancelAtPeriodEnd).toBe(true);
	});
});

describe('billing/entitlements — snapshotFor (Business)', () => {
	it('uses the Business label', () => {
		const snap = snapshotFor({
			tier: 'business',
			subscription: fakeSubscription({ price_id: 'price_business_monthly' })
		});
		expect(snap.tier).toBe('business');
		expect(snap.badgeLabel).toBe('Business');
		expect(snap.badgeTone).toBe('paid');
		expect(snap.priceId).toBe('price_business_monthly');
	});
});
