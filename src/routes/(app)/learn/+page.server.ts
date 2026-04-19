import type { PageServerLoad } from './$types';
import { CURRICULUM } from '$config/curriculum.config';

export const load: PageServerLoad = async () => {
	return { modules: CURRICULUM };
};
