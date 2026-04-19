import { describe, expect, it } from 'vitest';
import { buildSubscriptionCheckoutParams } from './checkout';

/**
 * The pure params-builder is the contract: given the inputs we have
 * server-side (customer, price, lookup_key, user, origin), produce
 * the Stripe Checkout Session create-params with every Contactly
 * invariant baked in.
 *
 * We unit-test this directly so the integration flow doesn't need to
 * mock the Stripe SDK to assert "we always pass automatic_tax" or
 * "we always set client_reference_id".
 */

const baseInputs = {
	customerId: 'cus_test_acme',
	priceId: 'price_test_pro_monthly',
	lookupKey: 'contactly_pro_monthly' as const,
	tier: 'pro' as const,
	interval: 'monthly' as const,
	userId: 'usr_acme',
	origin: 'https://contactly.test',
	trialPeriodDays: 14
};

describe('billing/checkout — buildSubscriptionCheckoutParams', () => {
	it('locks the integration shape (mode, automatic_tax, address, locale)', () => {
		const params = buildSubscriptionCheckoutParams(baseInputs);
		expect(params.mode).toBe('subscription');
		expect(params.automatic_tax).toEqual({ enabled: true });
		expect(params.billing_address_collection).toBe('required');
		expect(params.customer_update).toEqual({ address: 'auto', name: 'auto' });
		expect(params.allow_promotion_codes).toBe(true);
		expect(params.payment_method_collection).toBe('always');
		expect(params.locale).toBe('en');
	});

	it('sets the customer + line item from the resolved price', () => {
		const params = buildSubscriptionCheckoutParams(baseInputs);
		expect(params.customer).toBe('cus_test_acme');
		expect(params.line_items).toEqual([{ price: 'price_test_pro_monthly', quantity: 1 }]);
	});

	it('sets client_reference_id and metadata at both top-level and subscription_data', () => {
		const params = buildSubscriptionCheckoutParams(baseInputs);
		expect(params.client_reference_id).toBe('usr_acme');
		expect(params.metadata).toEqual({
			user_id: 'usr_acme',
			lookup_key: 'contactly_pro_monthly',
			tier: 'pro',
			interval: 'monthly'
		});
		expect(params.subscription_data?.metadata).toEqual({
			user_id: 'usr_acme',
			lookup_key: 'contactly_pro_monthly',
			tier: 'pro',
			interval: 'monthly'
		});
	});

	it('attaches a 14-day trial when trialPeriodDays > 0', () => {
		const params = buildSubscriptionCheckoutParams(baseInputs);
		expect(params.subscription_data?.trial_period_days).toBe(14);
	});

	it('omits trial_period_days entirely when trialPeriodDays = 0', () => {
		const params = buildSubscriptionCheckoutParams({ ...baseInputs, trialPeriodDays: 0 });
		expect(params.subscription_data).toBeDefined();
		// We deliberately omit the field rather than passing 0 — Stripe
		// treats `0` as "no trial" but the explicit omission keeps
		// the audit log clean of zero-day-trial entries.
		expect((params.subscription_data ?? {}).trial_period_days).toBeUndefined();
	});

	it('builds success/cancel URLs from the request origin (not env)', () => {
		const params = buildSubscriptionCheckoutParams({
			...baseInputs,
			origin: 'https://preview-pr-42.vercel.app'
		});
		expect(params.success_url).toBe(
			'https://preview-pr-42.vercel.app/account/billing/success?session_id={CHECKOUT_SESSION_ID}'
		);
		expect(params.cancel_url).toBe('https://preview-pr-42.vercel.app/pricing?checkout=cancelled');
	});

	it('uses the {CHECKOUT_SESSION_ID} placeholder Stripe expands server-side', () => {
		const params = buildSubscriptionCheckoutParams(baseInputs);
		expect(params.success_url).toContain('{CHECKOUT_SESSION_ID}');
	});

	it('describes Pro / Business correctly in subscription_data.description', () => {
		const pro = buildSubscriptionCheckoutParams(baseInputs);
		expect(pro.subscription_data?.description).toBe('Contactly Pro (monthly)');
		const biz = buildSubscriptionCheckoutParams({
			...baseInputs,
			lookupKey: 'contactly_business_yearly',
			tier: 'business',
			interval: 'yearly'
		});
		expect(biz.subscription_data?.description).toBe('Contactly Business (yearly)');
	});
});
