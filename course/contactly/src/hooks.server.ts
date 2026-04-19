/**
 * Server hooks — runs once per request on the server.
 *
 * Two responsibilities right now:
 *
 *  1. Create a per-request Supabase server client and attach it to
 *     `event.locals.supabase`. Every server `load`, every form action,
 *     every `+server.ts` endpoint can do `event.locals.supabase.from(...)`
 *     and inherit the cookie-bound auth context of the requesting user.
 *
 *  2. Attach a `safeGetSession` helper to `event.locals`. The Supabase
 *     SDK's `getSession()` reads the session from the cookie WITHOUT
 *     verifying the JWT signature — so a malicious client could craft
 *     a forged cookie and `getSession()` would happily return a
 *     "session" for it. `safeGetSession` runs `getSession()` to get the
 *     cookie payload, then `getUser()` to round-trip the JWT through
 *     Supabase Auth (which validates the signature). If validation
 *     fails, we return null on both. EVERY auth check in the rest of
 *     the codebase goes through this helper, never `getSession()`
 *     directly.
 *
 *  3. Guard `transformPageChunk` so SvelteKit doesn't strip
 *     auth-related response headers we set in the cookie's `setAll`
 *     callback (the v0.10 cache-busting `Cache-Control` / `Expires` /
 *     `Pragma` headers — see the `cookies.setAll` block below).
 *
 * Importing `publicEnv` and `serverEnv` here is what makes the env
 * validators from Lesson 2.1 actually fire — every server boot now
 * triggers the Zod parse, and a misconfigured env crashes the server
 * loudly instead of letting the first request explode opaquely.
 */
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';
import type { Database } from '$lib/database.types';
import { publicEnv } from '$lib/env.public';
// `serverEnv` isn't read here yet (no server-side code uses
// SUPABASE_SERVICE_ROLE_KEY until Module 4's admin client). The import
// exists to force boot-time validation of server env vars too — if
// SUPABASE_SERVICE_ROLE_KEY is missing, we crash here, not three
// lessons from now.
import { serverEnv as _serverEnv } from '$lib/server/env';
import { requestLogger } from '$lib/server/logger';
void _serverEnv;

export const handle: Handle = async ({ event, resolve }) => {
	// Per-request structured logger. Stamped on `event.locals` so
	// every `load`, action, and `+server.ts` can do
	// `event.locals.logger.info(...)` and inherit `req_id` /
	// `route_id` without threading a logger argument through every
	// service call. Wired before the Supabase client so any future
	// breadcrumbs from the `setAll` cookie callback can use it too.
	event.locals.logger = requestLogger(event);

	event.locals.supabase = createServerClient<Database>(
		publicEnv.PUBLIC_SUPABASE_URL,
		publicEnv.PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				/**
				 * @supabase/ssr v0.10 added the second `headers` argument:
				 * when the client refreshes the access token (or signs the
				 * user out), it asks us to set cache-control headers like
				 * `Cache-Control: no-store` so a CDN/edge can never cache
				 * the response with a stale auth cookie. We MUST forward
				 * those — skipping it is how you get the "I logged out
				 * but Vercel served me a cached page that still says I'm
				 * logged in" class of bug.
				 */
				setAll: (cookiesToSet, headers) => {
					for (const { name, value, options } of cookiesToSet) {
						// SvelteKit requires `path` on every cookie; an empty
						// string would replicate "no path" (default behavior),
						// `'/'` makes the cookie visible across the whole site
						// which is what auth cookies need.
						event.cookies.set(name, value, { ...options, path: '/' });
					}
					if (Object.keys(headers).length > 0) {
						event.setHeaders(headers);
					}
				}
			}
		}
	);

	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {
			return { session: null, user: null };
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) {
			// JWT signature validation failed (forged cookie, expired
			// signing key, GoTrue rotation, …) or the API didn't return a
			// user despite no error (rare GoTrue race). Treat both as
			// unauthenticated — failing closed is the only safe choice
			// when an auth check is ambiguous.
			return { session: null, user: null };
		}

		return { session, user };
	};

	return resolve(event, {
		// SvelteKit strips response headers it doesn't recognize during
		// streaming. We need the Supabase SSR cache headers (set by
		// `setAll` above) to survive — they all start with the standard
		// `cache-control` / `content-range` family that browsers/CDNs
		// already understand, but being explicit here is cheap insurance.
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
