/**
 * Pricing catalog — turns the raw `ActivePlanRow[]` from the
 * `stripe_prices`/`stripe_products` mirror (Module 7.2) into the
 * typed view-model the marketing pricing page renders (Lesson 8.2)
 * and the `/account` plan section consumes (Lesson 8.4).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The marketing page wants three cards (`Starter`, `Pro`, `Business`)
 * with two billing intervals on the paid tiers and a curated feature
 * list per tier — a different shape than what comes out of the DB.
 * Doing the reshape inline in `+page.server.ts` mixes presentation
 * concerns with data fetching, makes the page hard to unit-test, and
 * spreads the Starter-is-implicit-tier knowledge around the codebase.
 *
 * Centralizing the transform here means:
 *
 *   - The marketing page is pure presentation: `cards = buildPricingCatalog(rows)`.
 *   - `/account` (Lesson 8.4) reuses the same view-model to highlight
 *     the user's current card without re-deriving prices.
 *   - The function is pure (no I/O), so the unit test in
 *     `catalog.test.ts` exercises every edge case — Starter never
 *     missing, single-interval cards, malformed rows, currency
 *     mismatches — without touching Stripe or Supabase.
 *
 * STARTER IS NOT A STRIPE PRODUCT
 * -------------------------------
 * Per ADR-007, the Starter tier is the *absence* of a Stripe
 * subscription, not a $0 price. We never iterate the input looking
 * for a "starter" row because there isn't one — instead, the catalog
 * ALWAYS prepends a hard-coded Starter card built from
 * `STATIC_TIER_COPY`.
 *
 * COPY LIVES HERE, NOT IN STRIPE
 * ------------------------------
 * Stripe stores the canonical product name + (terse) description, but
 * the bulleted feature list a marketing page wants is curated copy
 * that doesn't belong in product metadata — it changes for marketing
 * reasons that have nothing to do with billing, and trying to round-
 * trip it through a JSON metadata field is its own maintenance fire.
 * `STATIC_TIER_COPY` is the source of truth for that copy; tier IDs
 * are typed against `Tier` so a typo won't compile.
 */
import type { ActivePlanRow } from '$lib/server/billing/products';
import {
	BILLING_INTERVALS,
	type BillingInterval,
	type LookupKey,
	lookupKeyFor,
	type Tier
} from '$lib/billing/lookup-keys';

/**
 * One billing-interval offering on a paid card. Always present in
 * pairs (monthly + yearly) for Pro/Business — if a yearly price is
 * missing in the DB, the field on the card is `null` and the page
 * hides the toggle for that card.
 */
export type CatalogPrice = {
	priceId: string;
	lookupKey: LookupKey;
	/** Cents. Stripe stores integer minor units; we never coerce to dollars in the model. */
	unitAmount: number;
	currency: string;
	interval: BillingInterval;
	/** "$19/mo" or "$190/yr" — locale-stable, computed at build time below. */
	formatted: string;
	/**
	 * For yearly cards: the equivalent monthly cost in cents (e.g.
	 * `$190 / yr → 1583` ≈ `$15.83/mo`). Lets the page render
	 * "$15.83/mo billed annually" alongside the headline yearly price
	 * without recomputing the math in the template. `null` for monthly
	 * prices (would be a tautology).
	 */
	monthlyEquivalentCents: number | null;
};

/** A single card in the pricing grid. */
export type PricingCard = {
	tier: Tier;
	name: string;
	tagline: string;
	/** Marketing bullets. Curated copy, not from Stripe. */
	features: readonly string[];
	/** Renders the "most popular" badge. Exactly one card should be `true`. */
	recommended: boolean;
	prices: {
		monthly: CatalogPrice | null;
		yearly: CatalogPrice | null;
	};
};

/**
 * Marketing copy keyed by tier. The single source of truth for the
 * pricing-page bullets. Edit here, NOT in Stripe metadata.
 *
 * Numeric caps (e.g. "Up to 25 contacts") are duplicated from the
 * entitlements module in Lesson 8.5; if you change one, change the
 * other. The unit test in `catalog.test.ts` does NOT enforce that
 * coupling because the marketing copy could legitimately round/blur
 * the limit ("Unlimited" vs "100,000"); it's a deliberate human
 * editorial decision per release.
 */
const STATIC_TIER_COPY: Record<Tier, { name: string; tagline: string; features: string[] }> = {
	starter: {
		name: 'Starter',
		tagline: 'Try Contactly without a credit card.',
		features: [
			'Up to 25 contacts',
			'Personal workspace',
			'Email + magic-link sign-in',
			'Community support'
		]
	},
	pro: {
		name: 'Pro',
		tagline: 'For individual professionals who outgrew Starter.',
		features: [
			'Up to 10,000 contacts',
			'Advanced search + filters',
			'CSV import / export',
			'Priority email support',
			'14-day free trial'
		]
	},
	business: {
		name: 'Business',
		tagline: 'For small teams collaborating on shared lists.',
		features: [
			'Unlimited contacts',
			'Shared workspaces with roles',
			'Audit log',
			'Priority chat support',
			'14-day free trial'
		]
	}
};

/**
 * Tier we recommend by default. Pro is the volume tier — it's the
 * most common conversion target and the price comparison ladder reads
 * better when the middle card is highlighted.
 */
const RECOMMENDED_TIER: Tier = 'pro';

/**
 * Format a cents amount as a human-readable headline price.
 *
 * `Intl.NumberFormat` with a *locale-stable* call ('en-US') is used
 * deliberately. The pricing page renders identically on the server
 * (SSR) and client (after hydration), so we cannot let the server
 * pick "en" while the browser picks "fr-FR" — that would print
 * "$19.00" on one side and "19,00 $US" on the other and trip the
 * Svelte hydration mismatch warning. v1 is USD-only (ADR-007); when
 * we ship multi-currency in Module 13+, the locale will become a
 * function of the currency, not the visitor.
 */
function formatHeadline(cents: number, currency: string, interval: BillingInterval): string {
	const formatter = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currency.toUpperCase(),
		// Whole dollars look cleaner on a price card. Stripe Tax adds
		// the cents at checkout, so the headline is always integer.
		// `Number.isInteger(cents / 100)` would let us conditionally
		// show fractions, but ADR-007 fixed every paid price to a
		// round number, so we lock it.
		maximumFractionDigits: 0,
		minimumFractionDigits: 0
	});
	const suffix = interval === 'monthly' ? '/mo' : '/yr';
	return `${formatter.format(cents / 100)}${suffix}`;
}

/** Stripe `recurring.interval` ('month' | 'year') → our union. */
function intervalFromStripe(value: string | null | undefined): BillingInterval | null {
	if (value === 'month') return 'monthly';
	if (value === 'year') return 'yearly';
	return null;
}

/**
 * Build the four-card pricing grid (Starter + Pro × {monthly,yearly}
 * + Business × {monthly,yearly}) from the raw mirror rows.
 *
 * Rows that don't match a known lookup key are silently dropped — a
 * row in `stripe_prices` with `lookup_key = NULL` (e.g. a one-off
 * SKU created by hand in the Dashboard) is irrelevant to the public
 * pricing page. Rows with `unit_amount = NULL` or a non-recurring
 * type are also dropped: the page is for *recurring* SaaS plans.
 *
 * Order is fixed: Starter → Pro → Business (matches `tier_rank` in
 * the fixtures).
 */
export function buildPricingCatalog(rows: readonly ActivePlanRow[]): PricingCard[] {
	// Index rows by lookup key for O(1) lookup. Last-write-wins if the
	// mirror somehow has two active prices with the same lookup key —
	// not possible in practice (Stripe enforces per-account uniqueness)
	// but defensive code is cheap.
	const byLookupKey = new Map<LookupKey, ActivePlanRow>();
	for (const row of rows) {
		if (!row.lookup_key) continue;
		if (row.unit_amount === null) continue;
		if (!intervalFromStripe(row.recurring_interval)) continue;
		// Narrow `lookup_key: string` to `LookupKey`. We deliberately
		// allow only known keys — an unknown key in the DB shouldn't
		// pollute the pricing page; it's likely a fixture that escaped
		// review and the catalog should fail closed.
		const key = row.lookup_key as LookupKey;
		byLookupKey.set(key, row);
	}

	const paidCards: PricingCard[] = (['pro', 'business'] as const).map((tier) => {
		const copy = STATIC_TIER_COPY[tier];
		const monthly = priceFor(byLookupKey, lookupKeyFor(tier, 'monthly'));
		const yearly = priceFor(byLookupKey, lookupKeyFor(tier, 'yearly'));
		return {
			tier,
			name: copy.name,
			tagline: copy.tagline,
			features: copy.features,
			recommended: tier === RECOMMENDED_TIER,
			prices: { monthly, yearly }
		} satisfies PricingCard;
	});

	const starterCard: PricingCard = {
		tier: 'starter',
		name: STATIC_TIER_COPY.starter.name,
		tagline: STATIC_TIER_COPY.starter.tagline,
		features: STATIC_TIER_COPY.starter.features,
		recommended: false,
		prices: { monthly: null, yearly: null }
	};

	return [starterCard, ...paidCards];
}

/**
 * Look up one (tier, interval) → CatalogPrice. Returns `null` if the
 * row is missing OR if it failed the validation in
 * `buildPricingCatalog` (e.g. unit_amount null). The caller renders
 * "—" or hides that interval rather than crashing.
 */
function priceFor(
	rows: ReadonlyMap<LookupKey, ActivePlanRow>,
	key: LookupKey
): CatalogPrice | null {
	const row = rows.get(key);
	if (!row) return null;
	const interval = intervalFromStripe(row.recurring_interval);
	// Both checks are theoretically redundant — `buildPricingCatalog`
	// already filtered — but keeping them here means `priceFor` can be
	// reused safely if we ever expose it directly.
	if (!interval) return null;
	if (row.unit_amount === null) return null;

	return {
		priceId: row.price_id,
		lookupKey: key,
		unitAmount: row.unit_amount,
		currency: row.currency,
		interval,
		formatted: formatHeadline(row.unit_amount, row.currency, interval),
		monthlyEquivalentCents: interval === 'yearly' ? Math.round(row.unit_amount / 12) : null
	};
}

/**
 * Convenience: format an arbitrary cents+currency pair the same way
 * the cards do, for callers that already know the interval (e.g. the
 * `/account` "current plan" line: "$19/mo, renews on …").
 *
 * Exported so the marketing page and `/account` print prices
 * identically — divergence here would be visible to users.
 */
export function formatCurrency(cents: number, currency: string, interval: BillingInterval): string {
	return formatHeadline(cents, currency, interval);
}

/**
 * Re-export the canonical interval list so consumers don't have to
 * import from two modules to render an interval toggle.
 */
export const CATALOG_INTERVALS = BILLING_INTERVALS;
