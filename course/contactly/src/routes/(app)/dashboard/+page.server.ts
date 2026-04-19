/**
 * Dashboard server load.
 *
 * Right now this just exposes the authenticated user to the page so
 * we have something to render after sign-in. Lesson 3.3 introduces a
 * shared (app) layout guard that redirects unauthenticated visitors
 * to /sign-in?next=…, and Lesson 3.5 swaps this for a real query
 * against `public.profiles`.
 *
 * Why duplicate the auth check here when the layout will guard it?
 *   Defense in depth + clarity. Page loads run after layout loads, so
 *   if a future bug breaks the layout guard, the page still refuses
 *   to leak data. SvelteKit also doesn't *guarantee* layout-load
 *   ordering across nested groups in every configuration.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (!user) {
		throw redirect(303, `/sign-in?next=${encodeURIComponent(url.pathname)}`);
	}
	return { user };
};
