/**
 * (app) layout — auth guard + entitlement snapshot.
 *
 * EVERY route inside the (app) group inherits this load. Two jobs:
 *
 *   1. Verify a session (redirecting to /sign-in if there isn't one).
 *   2. Resolve the user's `EntitlementSnapshot` once per request and
 *      hand it down to every page via `LayoutData`. Pages that
 *      already used `parent()` to read the user pick up `entitlements`
 *      for free; the badge in `AppNav`, `/account`'s "Plan" section
 *      (Lesson 8.4), and the contact-cap gate (Lesson 8.5) all read
 *      from this single source.
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
 * Why pre-resolve entitlements here, not in each page?
 *   The badge in `AppNav` is rendered on every authenticated screen,
 *   so the snapshot is needed everywhere; doing the work in the
 *   layout collapses N page-level calls into one. Pages that need
 *   richer data (e.g. `/account` showing the period_end) read the
 *   same snapshot — no second query.
 *
 * Failure mode: `loadEntitlements` falls back to a Starter snapshot
 * on any DB error (it inherits the fail-closed behavior of
 * `tierForUser`). Practically that means a transient Supabase outage
 * makes paid features behave as if the user is on Starter — exactly
 * the right default for billing logic. We catch and log here too so
 * one Stripe-mirror hiccup doesn't 500 the whole app shell.
 *
 * `event.url.pathname` is the destination AFTER the redirect chain
 * resolves — exactly what we want as `next=`. We do NOT include the
 * query string: it might contain credentials, magic-link tokens, or
 * tracking params we don't want bouncing through the URL bar.
 */
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { loadEntitlements, snapshotFor } from '$lib/server/billing/entitlements';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { session, user } = await safeGetSession();

	if (!user) {
		redirect(303, `/sign-in?next=${encodeURIComponent(url.pathname)}`);
	}

	let entitlements;
	try {
		entitlements = await loadEntitlements(user.id);
	} catch (err) {
		console.error('[app/layout] loadEntitlements failed; falling back to Starter snapshot', {
			user_id: user.id,
			err
		});
		entitlements = snapshotFor({ tier: 'starter', subscription: null });
	}

	// Expose to the (app) shell so the header can render `user.email`
	// without re-running the auth check itself, plus the entitlements
	// snapshot so every child sees a consistent tier within one request.
	return { session, user, entitlements };
};
