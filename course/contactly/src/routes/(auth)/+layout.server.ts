/**
 * (auth) layout — inverse guard.
 *
 * If the visitor already has a verified session, they have no business
 * on /sign-in or /sign-up. Bounce them to `next` (if a `?next=` was
 * supplied — common when an unauth visitor was sent here from a
 * protected route) or to /dashboard.
 *
 * Why the "inverse" guard?
 *   1. Stops a logged-in user from accidentally re-authenticating
 *      against a different account in the same browser session.
 *   2. Removes a whole class of "I clicked Sign in and it just sat
 *      there" bug reports — without this redirect, posting the
 *      sign-in form when already-signed-in is a no-op (Supabase
 *      returns the existing session) and the page just re-renders
 *      with no obvious feedback.
 *   3. Cleaner browser-history shape: once authenticated, the auth
 *      group becomes unreachable until the user explicitly signs
 *      out.
 *
 * EXCEPTIONS that intentionally LIVE OUTSIDE the (auth) group:
 *   - /auth/confirm — must work for both signed-in and signed-out
 *     visitors (e.g. a magic-link click in a tab where another tab
 *     is already signed in; the verifyOtp call replaces the session).
 *   - /auth/error  — generic error landing, must be reachable in any
 *     auth state.
 *   These live under `src/routes/auth/...` (no group prefix) so they
 *   inherit only the root layout, not this guard.
 */
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { safeRedirectPath } from '$lib/utils/safe-redirect';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();

	if (user) {
		redirect(303, safeRedirectPath(url.searchParams.get('next'), '/dashboard'));
	}

	return {};
};
