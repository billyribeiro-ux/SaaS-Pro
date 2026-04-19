/**
 * Sign-up form action.
 *
 * Flow (per ADR-005, password sign-up requires email verification):
 *
 *   1. User POSTs the form (email, password, confirmPassword, fullName)
 *   2. Superforms re-validates with the same Zod schema the client used
 *   3. If invalid → return 400 with the typed errors
 *   4. Call `supabase.auth.signUp(...)` with `options.emailRedirectTo`
 *      pointing at our `/auth/confirm` handler. `options.data` carries
 *      the optional `full_name` into `auth.users.raw_user_meta_data`,
 *      which the `handle_new_user` trigger from Lesson 1.4 reads when
 *      it inserts into `public.profiles`.
 *   5. On `User already registered` → setError on the email field; we
 *      do NOT silently succeed (which would leak whether the email is
 *      taken on a re-signup) BUT we also don't reveal the difference
 *      between "wrong password attempt" and "user exists" — Supabase's
 *      sign-up returns a generic 400 for "already registered" but the
 *      session/data shape gives us enough to distinguish.
 *   6. On any other error → setError on the form root.
 *   7. On success → redirect to `/sign-up/check-email?email=<email>`
 *      so the user knows the next step. We don't return `message()`
 *      because we want the URL to change (back-button-safe, refresh-safe).
 *
 * Why `redirect(303, …)` after success?
 *   POST → 303 → GET is the canonical "post/redirect/get" pattern that
 *   stops a refresh from re-submitting the form.
 */
import { fail, redirect } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms';
// Zod 4 has a separate adapter from Zod 3 — Zod 4 dropped the legacy
// `_parse` / `_getType` internal API the v3 adapter relies on.
// Re-exported from the package's `adapters` module as `zod4`.
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { signUpSchema } from '$lib/schemas/auth';
import { safeRedirectPath } from '$lib/utils/safe-redirect';

export const load: PageServerLoad = async () => {
	const form = await superValidate(zod4(signUpSchema));
	return { form };
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase }, url }) => {
		const form = await superValidate(request, zod4(signUpSchema));

		if (!form.valid) {
			return fail(400, { form });
		}

		const next = safeRedirectPath(url.searchParams.get('next'), '/dashboard');

		const { data, error } = await supabase.auth.signUp({
			email: form.data.email,
			password: form.data.password,
			options: {
				// Where the email's "confirm your account" link sends them.
				// `/auth/confirm` then runs `verifyOtp` and forwards to `next`.
				emailRedirectTo: `${url.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
				// Lands in auth.users.raw_user_meta_data; the handle_new_user
				// trigger reads `raw_user_meta_data ->> 'full_name'` and
				// writes it to public.profiles.full_name.
				data: form.data.fullName ? { full_name: form.data.fullName } : undefined
			}
		});

		if (error) {
			// Supabase returns "User already registered" for a re-signup.
			// Surface as an email-field error rather than a form-root error
			// so the user can immediately see where to fix it.
			if (/already registered/i.test(error.message)) {
				return setError(form, 'email', 'An account with this email already exists.');
			}
			return setError(form, '', error.message);
		}

		// Defensive: with `enable_confirmations = true` (our config), the
		// `data.user` should be present but `data.session` should be null
		// (no session until email is verified). If for any reason the
		// server returns no user at all, treat as failure.
		if (!data.user) {
			return setError(form, '', 'Sign-up failed: no user returned. Please try again.');
		}

		// POST/Redirect/GET. The check-email page reads the email from
		// the query string so it can show "We sent a link to <email>".
		redirect(303, `/sign-up/check-email?email=${encodeURIComponent(form.data.email)}`);
	}
};
