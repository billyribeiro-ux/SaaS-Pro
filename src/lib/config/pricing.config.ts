// Dynamic pricing — no hardcoded Price IDs.
// Prices are fetched from Stripe by lookup key at runtime.
// To change price amounts: update the price in the Stripe dashboard, no redeploy needed.

export const PRICING_LOOKUP_KEYS = {
	monthly: 'saas_pro_monthly',
	yearly: 'saas_pro_yearly',
	lifetime: 'saas_pro_lifetime'
} as const;

export type PricingTier = keyof typeof PRICING_LOOKUP_KEYS;

export type PricingTierConfig = {
	key: PricingTier;
	name: string;
	lookupKey: string;
	description: string;
	features: readonly string[];
	highlighted: boolean;
	cadenceLabel: string;
};

export const PRICING_TIERS: readonly PricingTierConfig[] = [
	{
		key: 'monthly',
		name: 'Monthly',
		lookupKey: PRICING_LOOKUP_KEYS.monthly,
		description: 'Full access, billed monthly.',
		features: [
			'All 73 lessons',
			'Full source code access',
			'Course updates included',
			'Community Discord access'
		],
		highlighted: false,
		cadenceLabel: 'per month'
	},
	{
		key: 'yearly',
		name: 'Yearly',
		lookupKey: PRICING_LOOKUP_KEYS.yearly,
		description: 'Full access, billed annually — best value.',
		features: [
			'Everything in Monthly',
			'Save over 14% vs monthly',
			'Priority support',
			'Early access to new content'
		],
		highlighted: true,
		cadenceLabel: 'per year'
	},
	{
		key: 'lifetime',
		name: 'Lifetime',
		lookupKey: PRICING_LOOKUP_KEYS.lifetime,
		description: 'One-time payment, lifetime access.',
		features: [
			'Everything in Yearly',
			'Lifetime updates',
			'Private community access',
			'Direct Q&A with instructor'
		],
		highlighted: false,
		cadenceLabel: 'one-time'
	}
] as const;

export const ALL_LOOKUP_KEYS: readonly string[] = [
	PRICING_LOOKUP_KEYS.monthly,
	PRICING_LOOKUP_KEYS.yearly,
	PRICING_LOOKUP_KEYS.lifetime
];

export function tierForLookupKey(lookupKey: string | null): PricingTier | null {
	if (!lookupKey) return null;
	for (const tier of PRICING_TIERS) {
		if (tier.lookupKey === lookupKey) return tier.key;
	}
	return null;
}
