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
			.select('module_slug, lesson_slug, completed, completed_at')
			.eq('user_id', user.id)
			// Upper bound prevents a pathological row count (e.g. seed scripts)
			// from blowing up the load. Curriculum is ~150 lessons — 1000 is huge headroom.
			.limit(1000)
	]);

	const rows = progressRes.data ?? [];
	const completedRows = rows.filter((r) => r.completed === true);
	const completedCount = completedRows.length;
	const totalLessons = CURRICULUM.reduce((sum, mod) => sum + mod.lessons.length, 0);

	// Find the next incomplete lesson in curriculum order — that's the "Resume" target.
	const completedSet = new Set(
		completedRows.map((r) => `${r.module_slug}/${r.lesson_slug}`)
	);
	let nextLesson: {
		moduleSlug: string;
		moduleTitle: string;
		lessonSlug: string;
		lessonTitle: string;
	} | null = null;
	outer: for (const mod of CURRICULUM) {
		for (const lesson of mod.lessons) {
			if (!completedSet.has(`${mod.slug}/${lesson.slug}`)) {
				nextLesson = {
					moduleSlug: mod.slug,
					moduleTitle: mod.title,
					lessonSlug: lesson.slug,
					lessonTitle: lesson.title
				};
				break outer;
			}
		}
	}

	// Recent activity — last 5 completed lessons by `completed_at` desc.
	const recent = completedRows
		.slice()
		.sort((a, b) => String(b.completed_at ?? '').localeCompare(String(a.completed_at ?? '')))
		.slice(0, 5)
		.map((r) => {
			const mod = CURRICULUM.find((m) => m.slug === r.module_slug);
			const lesson = mod?.lessons.find((l) => l.slug === r.lesson_slug);
			return {
				moduleSlug: r.module_slug,
				lessonSlug: r.lesson_slug,
				moduleTitle: mod?.title ?? r.module_slug,
				lessonTitle: lesson?.title ?? r.lesson_slug,
				updatedAt: r.completed_at
			};
		});

	return {
		tier,
		completedCount,
		totalLessons,
		nextLesson,
		recent,
		checkoutStatus: url.searchParams.get('checkout')
	};
};
