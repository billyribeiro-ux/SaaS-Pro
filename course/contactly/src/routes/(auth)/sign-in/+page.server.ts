/**
 * Sign-in form actions.
 *
 * Per ADR-005 we offer BOTH password and magic-link sign-in on the same
 * page (one fewer route to maintain, one decision for the user). The
 * page renders two independent forms — one per mode — and posts to two
 * named actions:
 *
 *   POST /sign-in?/password   → email + password → signInWithPassword
 *   POST /sign-in?/magic      → email           → signInWithOtp
 *
 * Why two forms / two schemas instead of one schema + a discriminator?
 *   The two modes need genuinely different validation (magic mode has
 *   no `password` field at all). A discriminated union would force us
 *   to render a hidden `password` field in magic mode and remember to
 *   ignore it server-side — easier to just keep them separate.
 *
 * Account-enumeration defense
 *   Both actions deliberately produce a generic error/success that
 *   doesn't reveal whether an email belongs to an existing account.
 *   - `password`: any failure → "Invalid email or password" on the
 *     form root. We never distinguish "no such user" from "bad
 *     password".
 *   - `magic`: ALWAYS redirect to /sign-in/check-email regardless of
 *     whether Supabase actually sent a mail. With
 *     `shouldCreateUser: false`, Supabase will reject unknown emails;
 *     we swallow the error so the response is timing/visually
 *     identical to the success case.
 *
 * Already-signed-in handling
 *   `load()` reads `locals.safeGetSession()`. If the user already has
 *   a valid session, we redirect them out of the auth area to `next`
 *   (or `/dashboard`). This makes back-button-after-login a no-op
 *   instead of "looks like I'm signed out".
 */
import { fail, redirect } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { signInWithMagicLinkSchema, signInWithPasswordSchema } from '$lib/schemas/auth';
import { safeRedirectPath } from '$lib/utils/safe-redirect';

/**
 * Already-signed-in visitors are bounced by `(auth)/+layout.server.ts`
 * (Lesson 3.3) — no need to re-check here.
 */
export const load: PageServerLoad = async () => {
	const [passwordForm, magicForm] = await Promise.all([
		superValidate(zod4(signInWithPasswordSchema), { id: 'password' }),
		superValidate(zod4(signInWithMagicLinkSchema), { id: 'magic' })
	]);

	return { passwordForm, magicForm };
};

export const actions: Actions = {
	password: async ({ request, locals: { supabase }, url }) => {
		const form = await superValidate(request, zod4(signInWithPasswordSchema), { id: 'password' });

		if (!form.valid) {
			return fail(400, { form });
		}

		const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');

		const { error } = await supabase.auth.signInWithPassword({
			email: form.data.email,
			password: form.data.password
		});

		if (error) {
			// Generic message on purpose. Don't leak whether the email exists.
			// Clear the password field so a typo isn't preserved across the
			// retry (the email is fine to keep — convenience > paranoia).
			form.data.password = '';
			return setError(form, '', 'Invalid email or password.');
		}

		throw redirect(303, next);
	},

	magic: async ({ request, locals: { supabase }, url }) => {
		const form = await superValidate(request, zod4(signInWithMagicLinkSchema), { id: 'magic' });

		if (!form.valid) {
			return fail(400, { form });
		}

		const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');

		// `shouldCreateUser: false` — magic-link is for sign-IN. New
		// accounts must go through /sign-up so we capture optional
		// metadata (full_name) and run the password strength check.
		// Without this flag, /sign-in becomes a back-door account
		// creator that bypasses signUpSchema entirely.
		const { error } = await supabase.auth.signInWithOtp({
			email: form.data.email,
			options: {
				shouldCreateUser: false,
				emailRedirectTo: `${url.origin}/auth/confirm?next=${encodeURIComponent(next)}`
			}
		});

		// Deliberately swallow non-validation errors (e.g. "Signups not
		// allowed for otp" when the email is unknown). We always redirect
		// to /sign-in/check-email so the response shape is identical
		// for "valid email that exists" and "valid email that doesn't" —
		// no account enumeration.
		if (error) {
			console.warn('[sign-in/magic] signInWithOtp error (suppressed):', error.message);
		}

		throw redirect(303, `/sign-in/check-email?email=${encodeURIComponent(form.data.email)}`);
	}
};
