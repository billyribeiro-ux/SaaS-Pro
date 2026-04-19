/**
 * Forgot-password page.
 *
 * Always shows a "If we have your email, we sent a reset link"
 * confirmation, regardless of whether the email exists. Same
 * account-enumeration defense as the magic-link sign-in flow:
 * we never differentiate "user exists" from "user doesn't exist"
 * in the user-visible response.
 *
 * Lives inside (auth) so the layout's inverse-guard sends
 * already-signed-in users to /dashboard. (A signed-in user who
 * forgot their password should use the change-password section on
 * /account, not the recovery flow.)
 */
import { fail, redirect } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { forgotPasswordSchema } from '$lib/schemas/auth';

export const load: PageServerLoad = async () => {
	const form = await superValidate(zod4(forgotPasswordSchema));
	return { form };
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase }, url }) => {
		const form = await superValidate(request, zod4(forgotPasswordSchema));
		if (!form.valid) return fail(400, { form });

		// Recovery link lands on /auth/confirm with type=recovery.
		// /auth/confirm forwards to `next=/reset-password` once the
		// OTP verifies, which puts the user in a recovery session and
		// renders the new-password form.
		const { error } = await supabase.auth.resetPasswordForEmail(form.data.email, {
			redirectTo: `${url.origin}/auth/confirm?next=${encodeURIComponent('/reset-password')}`
		});

		// As with magic-link sign-in, we swallow non-validation errors
		// so the response is timing-identical for "valid email that
		// exists" and "valid email that doesn't".
		if (error) {
			console.warn('[forgot-password] resetPasswordForEmail (suppressed):', error.message);
		}

		throw redirect(
			303,
			`/forgot-password/check-email?email=${encodeURIComponent(form.data.email)}`
		);
	}
};
