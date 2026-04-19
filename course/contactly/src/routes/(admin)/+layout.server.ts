/**
 * (admin) layout — gates everything under /admin/* to platform
 * admins (Module 10.3).
 *
 * The route group's only purpose is the gate. We do NOT reuse
 * `requireAdminOrToken` here — the bearer-token branch is for
 * monitoring tools hitting JSON endpoints, not humans loading a
 * dashboard, and a human-driven admin page should fail with the
 * same "404 Not Found" pattern when the visitor isn't a platform
 * admin (so the existence of /admin/* is invisible to outsiders).
 *
 * Note we deliberately do NOT redirect to /sign-in if there's no
 * session — that would also leak the surface ("oh, /admin exists
 * and bounces me to sign-in"). A 404 keeps the door closed.
 */
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession, supabase } }) => {
	const { user } = await safeGetSession();
	if (!user) throw error(404, 'Not Found');

	const { data, error: readError } = await supabase
		.from('profiles')
		.select('is_platform_admin')
		.eq('id', user.id)
		.maybeSingle();

	// Same fail-closed posture as the JSON helper: a DB error here
	// MUST NOT be readable as "you are an admin".
	if (readError || !data?.is_platform_admin) throw error(404, 'Not Found');

	return { user };
};
