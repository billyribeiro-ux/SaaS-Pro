/**
 * Contactly price catalog — the typed source of truth for every
 * reference to a Stripe Price the application code makes.
 *
 * Why a module, not inline strings. Stripe Price IDs (`price_xxx`) are
 * unstable — they're regenerated every time anyone re-runs
 * `pnpm run stripe:fixtures`, and they differ between test and live
 * mode. Lookup keys are stable: we assign them in
 * `stripe/fixtures/products.json` and they transfer to the newest
 * matching Price automatically (see Lesson 5.4 / 5.5). Code that
 * accepts a Price therefore accepts a `LookupKey`, not a raw string
 * and not a Stripe ID — typos become compile errors, price rotations
 * become zero-LoC changes, and `grep contactly_pro_monthly` finds
 * every reference.
 *
 * Source of truth: ADR-007 in `course/ARCHITECTURE.md`.
 *
 * Keep this file in sync with `stripe/fixtures/products.json` by hand
 * — there are only four entries, a test enforces the 1:1 mapping
 * (Module 7.2), and the fixtures file is the single PR you review when
 * this file changes.
 */

/** The four lookup keys Stripe stores in test + live mode. */
export const LOOKUP_KEYS = [
	'contactly_pro_monthly',
	'contactly_pro_yearly',
	'contactly_business_monthly',
	'contactly_business_yearly'
] as const;

/**
 * The union of every valid lookup key. Narrowed enough that a typo
 * like `contactly_pro_montly` fails `tsc` before it fails Stripe.
 */
export type LookupKey = (typeof LOOKUP_KEYS)[number];

/** The two paid tiers. `starter` is the absence of a subscription (ADR-007). */
export const PAID_TIERS = ['pro', 'business'] as const;
export type PaidTier = (typeof PAID_TIERS)[number];

/** Plans can be billed monthly or yearly. */
export const BILLING_INTERVALS = ['monthly', 'yearly'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * All tiers a user's entitlement state can resolve to, including the
 * implicit default when no subscription is active.
 */
export const ALL_TIERS = ['starter', ...PAID_TIERS] as const;
export type Tier = (typeof ALL_TIERS)[number];

/**
 * Resolve a `(tier, interval)` pair to its lookup key. Helpful for
 * the pricing page ("Pro, billed monthly → which Price do I send to
 * Checkout?") without repeating the string-concatenation pattern
 * everywhere.
 *
 * @example
 *   lookupKeyFor('pro', 'yearly');  // 'contactly_pro_yearly'
 */
export function lookupKeyFor(tier: PaidTier, interval: BillingInterval): LookupKey {
	return `contactly_${tier}_${interval}` satisfies LookupKey;
}

/**
 * Inverse of `lookupKeyFor` — parse a lookup key back into the tier +
 * interval it represents. Useful for webhook handlers that receive a
 * Price and need to decide what internal tier to grant.
 *
 * Throws (at runtime) if the key doesn't match the known pattern;
 * never feed this function an arbitrary string from user input.
 */
export function parseLookupKey(key: LookupKey): { tier: PaidTier; interval: BillingInterval } {
	const [, tier, interval] = key.split('_') as [string, PaidTier, BillingInterval];
	return { tier, interval };
}

/** Guard for narrowing an `unknown` value (e.g. from a webhook) to a `LookupKey`. */
export function isLookupKey(value: unknown): value is LookupKey {
	return typeof value === 'string' && (LOOKUP_KEYS as readonly string[]).includes(value);
}
