import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';
import { getSubscriptionTier } from '$utils/access';
import { CURRICULUM } from '$config/curriculum.config';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;

	const [tier, progressRes] = await Promise.all([
		getSubscriptionTier(user.id),
		supabaseAdmin
			.from('lesson_progress')
			.select('module_slug, lesson_slug, completed')
			.eq('user_id', user.id)
			.eq('completed', true)
	]);

	const completedCount = progressRes.data?.length ?? 0;
	const totalLessons = CURRICULUM.reduce((sum, mod) => sum + mod.lessons.length, 0);

	return {
		tier,
		completedCount,
		totalLessons,
		checkoutStatus: url.searchParams.get('checkout')
	};
};
