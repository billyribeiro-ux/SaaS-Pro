import type { LayoutServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';

// Collects per-module progress for the sidebar.
// Shape: { [moduleSlug]: { [lessonSlug]: completed } }
export const load: LayoutServerLoad = async ({ locals }) => {
	// Sibling layouts run in parallel with (app)/+layout.server.ts. When that
	// layout's redirect to /login is still in flight, this loader can fire with
	// `locals.user === null`. Return an empty payload instead of dereferencing.
	const user = locals.user;
	if (!user) return { progress: {} };

	const { data, error } = await supabaseAdmin
		.from('lesson_progress')
		.select('module_slug, lesson_slug, completed')
		.eq('user_id', user.id)
		// Bounded read: curriculum is ~150 lessons — 1000 row cap is ample and
		// prevents a pathological row count from inflating the layout payload.
		.limit(1000);

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
