/**
 * (app) layout — auth guard.
 *
 * EVERY route inside the (app) group inherits this load. If there's no
 * verified session, we redirect to /sign-in and pass `next=` so the
 * sign-in flow knows where to send the user when they succeed.
 *
 * Why guard at the LAYOUT, not in each page?
 *   - Single source of truth: one place to fix if the rules change.
 *   - Default-deny: a future contributor adding `(app)/billing/+page.svelte`
 *     gets the guard for free. Forgetting `await safeGetSession()` in
 *     a page is a security regression that's silent in code review.
 *   - The layout load runs BEFORE child page loads, so a redirect here
 *     short-circuits before any page-level data fetch even fires.
 *
 * Why `safeGetSession` and not just `parent().user`?
 *   The root layout-server-load DOES expose `user` already, but
 *   reading from `parent()` here would create a load dependency chain
 *   we don't actually need. `safeGetSession()` is cheap (one in-memory
 *   read + one validated `getUser()` round-trip; the response is
 *   memoized for the duration of the request via Supabase's internal
 *   cache). Calling it directly keeps each layer self-contained.
 *
 * `event.url.pathname` is the destination AFTER the redirect chain
 * resolves — exactly what we want as `next=`. We do NOT include the
 * query string: it might contain credentials, magic-link tokens, or
 * tracking params we don't want bouncing through the URL bar.
 */
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { session, user } = await safeGetSession();

	if (!user) {
		redirect(303, `/sign-in?next=${encodeURIComponent(url.pathname)}`);
	}

	// Expose to the (app) shell so the header can render `user.email`
	// without re-running the auth check itself.
	return { session, user };
};
