import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '$server/supabase';
import { getActiveEntitlementTier, isAdmin } from '$server/admin';
import { tierForLookupKey, type PricingTier } from '$config/pricing.config';
import type { LessonMeta } from '$types/lesson.types';
import type { SubscriptionStatus } from '$types/database.types';

/*
 * Access layer.
 *
 * Three independent paths grant a user access to gated product surfaces:
 *
 *   1. Staff role — `profiles.role = 'admin'`. Reconciled on every request
 *      against the `ADMIN_EMAILS` allowlist by `hooks.server.ts`. Staff never
 *      pay and never hit upgrade prompts; treating them as the highest tier
 *      keeps tier-aware UI (pricing CTAs, "Manage subscription" buttons,
 *      feature gates) consistent for our own dogfooding.
 *
 *   2. Stripe subscription — a row in `public.subscriptions` whose `status`
 *      is `trialing` or `active`. The Stripe webhook is the source of truth
 *      for this state.
 *
 *   3. Admin-granted entitlement — a row in `public.entitlements` that is
 *      not revoked and not expired. Used for comps, scholarships, employees,
 *      anyone who should have access without going through Stripe.
 *
 * Every helper in this module funnels through the same three checks in the
 * same order. Adding a fourth grant path means changing one place. Removing
 * one means the same. That single point of mutation is the entire reason
 * this module exists — every route, every action, every UI gate calls into
 * here, and "is this user entitled to X" cannot drift between callers.
 */

const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active'];

/**
 * Tier reported for staff users. Mapping admins to the highest available
 * tier means tier-comparison logic anywhere in the app ("if user.tier >=
 * 'yearly' then …") works without special-casing admin everywhere. If a
 * higher tier ever ships ("team", "enterprise"), update this constant — no
 * other file needs to change.
 */
const STAFF_TIER: PricingTier = 'lifetime';

/**
 * Has the user got an active path to the product?
 *
 * Returns `true` if any of the three grant paths apply. Returns `false`
 * for `null` users without running any queries against unknown identities.
 */
export async function hasActiveSubscription(user: User | null): Promise<boolean> {
	if (!user) return false;
	if (await isAdmin(user)) return true;

	const [subRes, entitlementTier] = await Promise.all([
		supabaseAdmin
			.from('subscriptions')
			.select('status')
			.eq('user_id', user.id)
			.in('status', [...ENTITLED_STATUSES])
			.limit(1),
		getActiveEntitlementTier(user.id)
	]);

	if (subRes.error) {
		throw new Error(`[access] subscription lookup failed: ${subRes.error.message}`);
	}
	return (subRes.data?.length ?? 0) > 0 || entitlementTier !== null;
}

/**
 * Resolves the effective tier for the user. Staff resolve to {@link STAFF_TIER}.
 * If both a Stripe subscription and an entitlement are present, the subscription
 * wins — it's the paid signal of record, and downgrades from sub→entitlement
 * should be explicit operator moves, not silent fallbacks.
 */
export async function getSubscriptionTier(user: User | null): Promise<PricingTier | null> {
	if (!user) return null;
	if (await isAdmin(user)) return STAFF_TIER;

	const [subRes, entitlementTier] = await Promise.all([
		supabaseAdmin
			.from('subscriptions')
			.select('price_id, status, prices(lookup_key)')
			.eq('user_id', user.id)
			.in('status', [...ENTITLED_STATUSES])
			.order('current_period_end', { ascending: false })
			.limit(1)
			.maybeSingle(),
		getActiveEntitlementTier(user.id)
	]);

	if (subRes.error) {
		throw new Error(`[access] tier lookup failed: ${subRes.error.message}`);
	}

	const subTier: PricingTier | null = (() => {
		if (!subRes.data) return null;
		const priceRel = subRes.data.prices as { lookup_key: string | null } | null;
		return tierForLookupKey(priceRel?.lookup_key ?? null);
	})();

	return subTier ?? entitlementTier;
}

/**
 * Lesson-level access. Preview lessons are free for everyone (anonymous or
 * authenticated). Non-preview lessons require any of the three grant paths.
 *
 * Accepts the full `User` object rather than a raw id so the function can
 * call `isAdmin(user)` without a redundant `User` lookup. `isAdmin` is
 * memoized per-`User` instance for the lifetime of one request, so calling
 * this from the load function and again from the form action is a single
 * DB round-trip.
 */
export async function canAccessLesson(
	user: User | null,
	lesson: Pick<LessonMeta, 'preview'>
): Promise<boolean> {
	if (lesson.preview) return true;
	if (!user) return false;
	return hasActiveSubscription(user);
}
