import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findModule } from '$config/curriculum.config';

export const load: PageServerLoad = async ({ params }) => {
	const module = findModule(params.module);
	if (!module) throw error(404, 'Module not found');
	return { module };
};
