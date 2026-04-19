/**
 * Email-link OTP exchange.
 *
 * This endpoint is the landing pad for every Supabase Auth email link:
 *
 *   - Sign-up confirmation     (?type=signup or ?type=email)
 *   - Magic link sign-in       (?type=magiclink or ?type=email)
 *   - Password reset           (?type=recovery)
 *   - Email-change confirm     (?type=email_change)
 *   - Org invitation accept    (?type=invite)
 *
 * Every link Supabase generates points here with `?token_hash=…&type=…`,
 * we exchange the token for a session via `verifyOtp`, and forward the
 * user to wherever they were going (`?next=/some/path`, validated as a
 * same-origin path before use to prevent open redirects).
 *
 * Type naming
 * -----------
 * Supabase deprecated the `signup` and `magiclink` type values in favor
 * of a single `email` type. The default email templates Supabase ships
 * still emit `?type=signup` / `?type=magiclink`, so we accept all the
 * current valid values for forward-compat. The set is enumerated in
 * `@supabase/supabase-js`'s `EmailOtpType` union; we import the type
 * for compile-time safety.
 *
 * Failure mode
 * ------------
 * On any failure (missing params, invalid token, expired token, network
 * error) we send the user to `/auth/error` rather than rendering an
 * error in place. That keeps the email-link experience predictable —
 * the user never lands on a half-functional page where they can't
 * tell what state they're in.
 */
import { redirect, type RequestHandler } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeRedirectPath } from '$lib/utils/safe-redirect';

/**
 * Whitelist of `type` values we accept. `EmailOtpType` from supabase-js
 * is the broadest possible set; this is our explicit subset so a typo
 * in an email link can't make us call `verifyOtp` with garbage.
 */
const ALLOWED_TYPES = new Set<EmailOtpType>([
	'email',
	'signup',
	'magiclink',
	'recovery',
	'email_change',
	'invite'
]);

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const rawType = url.searchParams.get('type') as EmailOtpType | null;
	const next = safeRedirectPath(url.searchParams.get('next'), '/');

	const errorRedirect = (reason: string) => {
		const error = new URL('/auth/error', url);
		error.searchParams.set('reason', reason);
		// Preserve `next` so the error page can offer a "try again" link.
		if (next !== '/') error.searchParams.set('next', next);
		return error;
	};

	if (!tokenHash || !rawType) {
		redirect(303, errorRedirect('missing_token'));
	}

	if (!ALLOWED_TYPES.has(rawType)) {
		redirect(303, errorRedirect('invalid_type'));
	}

	const { error } = await supabase.auth.verifyOtp({
		token_hash: tokenHash,
		type: rawType
	});

	if (error) {
		// Common cases: token expired (1h default), token already used,
		// token from a different Supabase project. We log the message
		// server-side but expose only a generic reason to the URL —
		// don't leak token internals to the client.
		console.error('[auth/confirm] verifyOtp failed:', error.message);
		redirect(303, errorRedirect('verify_failed'));
	}

	// Recovery flow lands on the password-update page (built in Lesson
	// 3.6). For all other types, send the user to `next` (validated
	// above as a same-origin path).
	if (rawType === 'recovery') {
		redirect(303, '/account/password');
	}

	redirect(303, next);
};
