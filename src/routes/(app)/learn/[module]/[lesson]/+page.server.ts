import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adjacentLessons, findLesson, findModule } from '$config/curriculum.config';
import {
	getLessonContent,
	markLessonCompleted
} from '$server/lessons/content.service';
import { renderMarkdown } from '$server/lessons/markdown';
import { canAccessLesson } from '$utils/access';
import { supabaseAdmin } from '$server/supabase';

export const load: PageServerLoad = async ({ params, locals }) => {
	const module = findModule(params.module);
	const lessonMeta = module ? findLesson(params.module, params.lesson) : null;
	if (!module || !lessonMeta) throw error(404, 'Lesson not found');

	const allowed = await canAccessLesson(locals.user, lessonMeta);
	if (!allowed) {
		return {
			gated: true as const,
			module,
			lessonMeta,
			navLinks: adjacentLessons(params.module, params.lesson),
			completed: false,
			lesson: null,
			renderedHtml: ''
		};
	}

	const lesson = await getLessonContent(params.module, params.lesson);
	if (!lesson) {
		return {
			gated: false as const,
			module,
			lessonMeta,
			navLinks: adjacentLessons(params.module, params.lesson),
			completed: false,
			lesson: null,
			renderedHtml: ''
		};
	}

	const navLinks = adjacentLessons(params.module, params.lesson);

	let completed = false;
	if (locals.user) {
		const { data } = await supabaseAdmin
			.from('lesson_progress')
			.select('completed')
			.eq('user_id', locals.user.id)
			.eq('module_slug', params.module)
			.eq('lesson_slug', params.lesson)
			.maybeSingle();
		completed = Boolean(data?.completed);
	}

	return {
		gated: false as const,
		module,
		lessonMeta,
		navLinks,
		completed,
		lesson,
		renderedHtml: renderMarkdown(lesson.content)
	};
};

export const actions: Actions = {
	complete: async ({ params, locals, request }) => {
		const user = locals.user;
		if (!user) throw redirect(303, '/login');

		const lessonMeta = findLesson(params.module!, params.lesson!);
		if (!lessonMeta) return fail(404, { error: 'Lesson not found' });

		const allowed = await canAccessLesson(user, lessonMeta);
		if (!allowed) return fail(403, { error: 'Subscription required.' });

		const form = await request.formData();
		const uncomplete = form.get('action') === 'uncomplete';

		if (uncomplete) {
			const { error: dbError } = await supabaseAdmin
				.from('lesson_progress')
				.update({ completed: false, completed_at: null })
				.eq('user_id', user.id)
				.eq('module_slug', params.module!)
				.eq('lesson_slug', params.lesson!);
			if (dbError) return fail(500, { error: dbError.message });
		} else {
			await markLessonCompleted(user.id, params.module!, params.lesson!);
		}

		return { success: true };
	}
};
