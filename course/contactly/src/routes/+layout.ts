/**
 * Root universal load — runs on the server during SSR AND in the browser
 * after hydration.
 *
 * The whole point of this file is to expose ONE Supabase client to the
 * `+layout.svelte` (and to all child loads via `parent()`) that does the
 * right thing in either environment:
 *
 *  - In the browser, it's a `createBrowserClient` — talks to Supabase
 *    over HTTPS, holds the session in IndexedDB / cookies, dispatches
 *    `onAuthStateChange` events.
 *
 *  - During SSR, it's a `createServerClient` configured with the cookies
 *    `+layout.server.ts` snapshotted off the request. SSR-side calls
 *    therefore see exactly the same auth context the request arrived
 *    with — no FOUC where the SSR'd HTML shows the user as logged out
 *    for one frame before the browser client corrects it.
 *
 * `depends('supabase:auth')` registers this load as a dependency of the
 * `'supabase:auth'` invalidation key. When the browser client fires an
 * `onAuthStateChange` event (Lesson 2.4 wires that in `+layout.svelte`),
 * we call `invalidate('supabase:auth')` and SvelteKit re-runs THIS load
 * — picking up the new session, re-creating the client with fresh
 * cookies, and re-running every child load that read from this one.
 *
 * Why is it OK to call `getSession()` here without `getUser()` to
 * validate?  In the browser, `getSession` reads from local storage
 * which only the user's own browser can have written to — there's no
 * untrusted JWT to forge. On the server, `data.session` was already
 * vetted by `safeGetSession` in `+layout.server.ts`, so the cookies we
 * passed through to this server client produce a session that's
 * already known good. The validation cost stays one round-trip, not
 * two.
 */
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import type { LayoutLoad } from './$types';
import type { Database } from '$lib/database.types';
import { publicEnv } from '$lib/env.public';

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient<Database>(
				publicEnv.PUBLIC_SUPABASE_URL,
				publicEnv.PUBLIC_SUPABASE_ANON_KEY,
				{
					// Pass SvelteKit's `fetch` so requests made during the
					// initial client navigation are re-played server-side
					// (cookies preserved, no double round-trip).
					global: { fetch }
				}
			)
		: createServerClient<Database>(
				publicEnv.PUBLIC_SUPABASE_URL,
				publicEnv.PUBLIC_SUPABASE_ANON_KEY,
				{
					global: { fetch },
					cookies: {
						// `data.cookies` came from `+layout.server.ts`'s
						// `cookies.getAll()`. Read-only on this side — we
						// never need to set cookies during a universal load
						// because the server hook already owns that.
						getAll: () => data.cookies
					}
				}
			);

	const {
		data: { session }
	} = await supabase.auth.getSession();

	return {
		supabase,
		session,
		user: data.user
	};
};
