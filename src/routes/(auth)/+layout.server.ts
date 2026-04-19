import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Already-authenticated users shouldn't see login/register forms.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		const next = url.searchParams.get('next');
		throw redirect(303, next && next.startsWith('/') ? next : '/dashboard');
	}
	return {};
};
