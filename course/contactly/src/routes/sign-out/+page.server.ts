/**
 * Sign-out endpoint.
 *
 * POST-only by design. A GET-driven sign-out (`<a href="/sign-out">`)
 * is a classic CSRF foot-gun: any third-party page can embed an
 * `<img src="https://contactly.app/sign-out">` and log every visitor
 * out as they browse the web. Forms POSTed cross-origin are subject
 * to the same-site cookie protection on Supabase's auth cookie, so
 * a POST form action is safe.
 *
 * `load()` rejects raw GETs (curl, browser address-bar) with a 405
 * so the failure mode is loud, not silent. The method ALLOWS a POST
 * even when the user is not signed in — calling signOut on a phantom
 * session is a no-op, and refusing it would break the case where the
 * user clicks "Sign out" in two tabs simultaneously.
 *
 * Why a separate route, not a form action on (app)/+layout?
 *   Layouts can't host form actions in SvelteKit. We could put it on
 *   /dashboard, but that couples sign-out to a specific page. A
 *   dedicated /sign-out endpoint is reachable from every shell
 *   (header button, account page, mobile menu) without hard-coding
 *   the action target each time.
 */
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	throw error(405, 'POST to /sign-out to log out.');
};

export const actions: Actions = {
	default: async ({ locals: { supabase, safeGetSession } }) => {
		const { session } = await safeGetSession();

		if (session) {
			// `signOut({ scope: 'local' })` clears the session cookie
			// for this browser ONLY. Other devices/browsers stay
			// authenticated until their own access tokens expire and
			// fail to refresh. The other options:
			//   - 'global'  → revoke ALL sessions for this user (use
			//                 in account-deletion + "sign me out
			//                 everywhere" features, NOT for the
			//                 normal logout button — kicks users off
			//                 every other device they own)
			//   - 'others'  → revoke everything EXCEPT this session
			//                 (used in password change confirm screens)
			await supabase.auth.signOut({ scope: 'local' });
		}

		// `redirect(303)` is the POST/Redirect/GET pattern again.
		// Sending the user to the marketing root means the next
		// (auth) layout-load won't immediately bounce them back to
		// /dashboard — they're signed out now, no inverse-guard
		// trigger.
		throw redirect(303, '/');
	}
};
