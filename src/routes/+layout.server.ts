import type { LayoutServerLoad } from './$types';
import { isAdmin } from '$server/admin';

// Runs on every request. Exposes the verified user + session to every layout/page.
// `user` here has been validated via supabase.auth.getUser() in hooks.server.ts.
export const load: LayoutServerLoad = async ({ locals }) => {
	const admin = await isAdmin(locals.user);
	return {
		user: locals.user,
		session: locals.session,
		isAdmin: admin
	};
};
