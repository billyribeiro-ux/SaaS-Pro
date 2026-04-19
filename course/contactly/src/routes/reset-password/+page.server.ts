/**
 * Reset-password landing.
 *
 * The user arrives here AFTER /auth/confirm has run a successful
 * `verifyOtp({ type: 'recovery' })`, which establishes a session.
 * From the auth system's perspective they're "signed in" — but
 * functionally they're in a recovery state and the only action
 * available is "set a new password".
 *
 * Why outside both (auth) and (app) groups?
 *   - (auth)/+layout.server.ts bounces signed-in visitors to
 *     /dashboard, which would short-circuit recovery the moment
 *     verifyOtp succeeded.
 *   - (app)/+layout.server.ts requires a session, which would
 *     work, but landing recovery in the app shell creates the
 *     wrong mental model (they haven't really logged in; they're
 *     resetting a password).
 *   - Top-level: no group, no layout-level guard. We do the
 *     auth check inline and bounce to /sign-in if there's no
 *     session at all.
 */
import { fail, redirect } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { resetPasswordSchema } from '$lib/schemas/auth';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		// No recovery session → arrived via stale link or directly.
		// Send to forgot-password so they can request a fresh one.
		throw redirect(303, '/forgot-password');
	}

	const form = await superValidate(zod4(resetPasswordSchema));
	return { form };
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/forgot-password');

		const form = await superValidate(request, zod4(resetPasswordSchema));
		if (!form.valid) return fail(400, { form });

		const { error } = await supabase.auth.updateUser({ password: form.data.password });
		if (error) {
			return setError(form, '', error.message);
		}

		// Recovery is done. The user now has a normal session — push
		// them into the app. We purposely don't bounce to /sign-in
		// because the session is already valid; making them sign in
		// again would feel like the reset didn't take.
		throw redirect(303, '/dashboard?password_reset=1');
	}
};
