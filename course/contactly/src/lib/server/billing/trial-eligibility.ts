/**
 * Trial eligibility — the serial-trial guard for Contactly.
 *
 * THE PROBLEM
 * -----------
 * Stripe's `trial_period_days` is a per-Checkout-Session knob. Without
 * a guard, a user could:
 *
 *   1. Sign up, take the 14-day Pro trial.
 *   2. Cancel during the trial (no charge).
 *   3. Re-subscribe → fresh 14-day trial. Repeat forever.
 *
 * This module provides the check that closes that loop. The checkout
 * service (Lesson 9.1) calls `hasUserUsedTrial(userId)` before deciding
 * whether to set `trial_period_days`. If the user has ever had a
 * subscription with `trial_start IS NOT NULL` — *regardless of current
 * status* — we skip the trial on the next checkout.
 *
 * WHY ANY HISTORICAL ROW COUNTS
 * -----------------------------
 * The mirror retains rows after cancellation (status flips to
 * `canceled`, the partial unique index lets new active rows land but
 * the old one stays). That's deliberate: it's the audit trail that
 * makes serial-trial guarding cheap and exact, with no extra column.
 *
 * Concretely, the guard fires for every shape that constitutes "has
 * already had a trial":
 *
 *   - active or trialing today        → `getActiveSubscription` would
 *                                       already refuse the checkout,
 *                                       but the trial guard is also a
 *                                       no-op because `trial_start` is
 *                                       set on the live row.
 *   - canceled mid-trial              → row persists, `trial_start`
 *                                       set → no new trial.
 *   - canceled after paid period      → same.
 *   - canceled before trial started   → `trial_start` is NULL → trial
 *                                       still allowed (this is the
 *                                       "started checkout, abandoned
 *                                       before trial fired" case;
 *                                       Stripe never created a
 *                                       trialing subscription).
 *
 * That last branch matters: a checkout session that the user *opened*
 * but never completed never produces a subscription row at all (the
 * webhook only fires on `customer.subscription.created`). Even if it
 * did, with no trial_start, we wouldn't penalize them.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * - Not an entitlement check. Use `entitlements.ts` for "what tier is
 *   this user on right now."
 * - Not a refusal check. The serial-trial guard does NOT block
 *   checkout — it just changes `trial_period_days` from 14 to 0. The
 *   user can still subscribe; they just don't get the free preview.
 * - Not a Stripe API call. The mirror is the source of truth here, by
 *   design — same reason every other read in this module uses it
 *   (sub-millisecond local query vs. 80-300ms round-trip).
 */
import { withAdmin } from '$lib/server/supabase-admin';

/** Number of trial days the policy grants to first-time subscribers. */
export const DEFAULT_TRIAL_DAYS = 14;

/**
 * Has this user ever had a trial-bearing subscription?
 *
 * Returns `true` iff there's any row in `stripe_subscriptions` for
 * `userId` with a non-null `trial_start`. Status doesn't matter — a
 * canceled trial still counts.
 *
 * Uses `head: true, count: 'exact'` so the query returns a count
 * without serializing rows; cheaper than `select('id').limit(1)` for
 * the boolean we actually want.
 */
export async function hasUserUsedTrial(userId: string): Promise<boolean> {
	const { count, error } = await withAdmin('billing.trial.has-used', 'system', async (admin) =>
		admin
			.from('stripe_subscriptions')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', userId)
			.not('trial_start', 'is', null)
	);
	if (error) {
		throw new Error(`[trial-eligibility] hasUserUsedTrial failed for ${userId}: ${error.message}`);
	}
	return (count ?? 0) > 0;
}

/**
 * Resolve the trial-day count for a user's NEXT checkout.
 *
 * Pure-shaped wrapper so tests can mock the eligibility predicate
 * directly without re-stubbing the DB call.
 *
 *   - first-time trialer        → DEFAULT_TRIAL_DAYS (14)
 *   - has previously trialed    → 0
 *
 * The number 14 lives in `DEFAULT_TRIAL_DAYS` (this file). Future
 * tier-specific overrides — e.g. "Business gets 30 days" — would land
 * here as a second argument; today every paid tier is the same.
 */
export async function trialDaysForNextCheckout(userId: string): Promise<number> {
	const used = await hasUserUsedTrial(userId);
	return used ? 0 : DEFAULT_TRIAL_DAYS;
}
