import { supabaseAdmin } from '$server/supabase';
import { getActiveEntitlementTier } from '$server/admin';
import { tierForLookupKey, type PricingTier } from '$config/pricing.config';
import type { LessonMeta } from '$types/lesson.types';
import type { SubscriptionStatus } from '$types/database.types';

const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active'];

// Active access = active Stripe subscription OR an unrevoked, unexpired
// admin-granted entitlement. This lets staff/comped users use the product
// without polluting the Stripe data model with fake customers.
export async function hasActiveSubscription(userId: string): Promise<boolean> {
	const [{ data, error }, entitlementTier] = await Promise.all([
		supabaseAdmin
			.from('subscriptions')
			.select('status')
			.eq('user_id', userId)
			.in('status', [...ENTITLED_STATUSES])
			.limit(1),
		getActiveEntitlementTier(userId)
	]);

	if (error) {
		throw new Error(`[access] subscription lookup failed: ${error.message}`);
	}
	return (data?.length ?? 0) > 0 || entitlementTier !== null;
}

export async function getSubscriptionTier(userId: string): Promise<PricingTier | null> {
	const [subRes, entitlementTier] = await Promise.all([
		supabaseAdmin
			.from('subscriptions')
			.select('price_id, status, prices(lookup_key)')
			.eq('user_id', userId)
			.in('status', [...ENTITLED_STATUSES])
			.order('current_period_end', { ascending: false })
			.limit(1)
			.maybeSingle(),
		getActiveEntitlementTier(userId)
	]);

	if (subRes.error) {
		throw new Error(`[access] tier lookup failed: ${subRes.error.message}`);
	}

	const subTier = (() => {
		if (!subRes.data) return null;
		const priceRel = subRes.data.prices as { lookup_key: string | null } | null;
		return tierForLookupKey(priceRel?.lookup_key ?? null);
	})();

	// Subscription wins if both are present — it's the paid signal of record.
	return subTier ?? entitlementTier;
}

export async function canAccessLesson(
	userId: string | null,
	lesson: Pick<LessonMeta, 'preview'>
): Promise<boolean> {
	if (lesson.preview) return true;
	if (!userId) return false;
	return hasActiveSubscription(userId);
}
