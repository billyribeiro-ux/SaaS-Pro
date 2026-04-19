/**
 * Dashboard server load.
 *
 * Auth guard lives in `(app)/+layout.server.ts` (Lesson 3.3). By the
 * time this load runs, `parent().user` is GUARANTEED non-null —
 * SvelteKit ran the layout load first and the redirect already
 * fired if there was no session.
 *
 * Lesson 3.5 swaps this for a real query against `public.profiles`.
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	return { user };
};
