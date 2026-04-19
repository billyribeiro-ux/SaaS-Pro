import type { LayoutServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';

// Collects per-module progress for the sidebar.
// Shape: { [moduleSlug]: { [lessonSlug]: completed } }
export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const { data, error } = await supabaseAdmin
		.from('lesson_progress')
		.select('module_slug, lesson_slug, completed')
		.eq('user_id', user.id);

	if (error) {
		throw new Error(`[learn layout] progress load failed: ${error.message}`);
	}

	const progress: Record<string, Record<string, boolean>> = {};
	for (const row of data ?? []) {
		const bucket = (progress[row.module_slug] ??= {});
		bucket[row.lesson_slug] = row.completed;
	}

	return { progress };
};
