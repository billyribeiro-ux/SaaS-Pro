import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { hasActiveSubscription } from '$utils/access';

// Auth guard — all (app) routes require a verified user.
// Unauthenticated visitors are bounced to /login with `next` preserved.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		const next = encodeURIComponent(url.pathname + url.search);
		throw redirect(303, `/login?next=${next}`);
	}

	const subscribed = await hasActiveSubscription(locals.user);
	return {
		user: locals.user,
		hasSubscription: subscribed
	};
};
