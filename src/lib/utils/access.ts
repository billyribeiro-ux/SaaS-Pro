import { supabaseAdmin } from '$server/supabase';
import { tierForLookupKey, type PricingTier } from '$config/pricing.config';
import type { LessonMeta } from '$types/lesson.types';
import type { SubscriptionStatus } from '$types/database.types';

const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active'];

export async function hasActiveSubscription(userId: string): Promise<boolean> {
	const { data, error } = await supabaseAdmin
		.from('subscriptions')
		.select('status')
		.eq('user_id', userId)
		.in('status', [...ENTITLED_STATUSES])
		.limit(1);

	if (error) {
		throw new Error(`[access] subscription lookup failed: ${error.message}`);
	}
	return (data?.length ?? 0) > 0;
}

export async function getSubscriptionTier(userId: string): Promise<PricingTier | null> {
	const { data, error } = await supabaseAdmin
		.from('subscriptions')
		.select('price_id, status, prices(lookup_key)')
		.eq('user_id', userId)
		.in('status', [...ENTITLED_STATUSES])
		.order('current_period_end', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		throw new Error(`[access] tier lookup failed: ${error.message}`);
	}
	if (!data) return null;

	const priceRel = data.prices as { lookup_key: string | null } | null;
	return tierForLookupKey(priceRel?.lookup_key ?? null);
}

export async function canAccessLesson(
	userId: string | null,
	lesson: Pick<LessonMeta, 'preview'>
): Promise<boolean> {
	if (lesson.preview) return true;
	if (!userId) return false;
	return hasActiveSubscription(userId);
}
