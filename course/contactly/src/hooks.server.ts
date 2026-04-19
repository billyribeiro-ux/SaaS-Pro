/**
 * Server hooks — runs once per request on the server.
 *
 * Responsibilities, in execution order:
 *
 *  0. (Module 10.2) Sentry server SDK initialisation at module load.
 *     Wraps the rest of the request lifecycle via `Sentry.sentryHandle()`
 *     so server-side errors get released-tagged events with breadcrumbs
 *     and the request id we share with our structured logger.
 *
 *  1. (Module 10.1) Per-request structured logger attached as
 *     `event.locals.logger`. Carries `req_id`, `route_id`, and (after
 *     the auth check) `user_id` automatically so every line is
 *     correlatable across log + Sentry surfaces.
 *
 *  2. Per-request Supabase server client on `event.locals.supabase`.
 *     Every server `load`, every form action, every `+server.ts`
 *     endpoint inherits the cookie-bound auth context of the
 *     requesting user.
 *
 *  3. `safeGetSession` helper on `event.locals`. The Supabase SDK's
 *     `getSession()` reads the cookie WITHOUT verifying the JWT
 *     signature — so a malicious client could craft a forged cookie
 *     and `getSession()` would happily return a "session" for it.
 *     `safeGetSession` runs `getSession()` to get the cookie payload,
 *     then `getUser()` to round-trip the JWT through Supabase Auth
 *     (which validates the signature). EVERY auth check goes through
 *     this helper, never `getSession()` directly.
 *
 *  4. (Module 10.2) `handleErrorWithSentry` exported as `handleError`
 *     so uncaught errors land in Sentry with the SvelteKit-shaped
 *     event context AND the same `req_id` / `route_id` tags as our
 *     structured logger.
 *
 *  5. `filterSerializedResponseHeaders` so SvelteKit doesn't strip
 *     auth-related response headers we set in the cookie's `setAll`
 *     callback (the v0.10 cache-busting `Cache-Control` / `Expires` /
 *     `Pragma` headers — see the `cookies.setAll` block below).
 *
 * Importing `publicEnv` and `serverEnv` here is what makes the env
 * validators from Lesson 2.1 actually fire — every server boot now
 * triggers the Zod parse, and a misconfigured env crashes the server
 * loudly instead of letting the first request explode opaquely.
 */
import { sequence } from '@sveltejs/kit/hooks';
import { createServerClient } from '@supabase/ssr';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { handleErrorWithSentry, init as sentryInit, sentryHandle, setTag } from '@sentry/sveltekit';
import type { Database } from '$lib/database.types';
import { publicEnv } from '$lib/env.public';
import { resolveEnvironment } from '$lib/release';
import { applySecurityHeaders } from '$lib/server/security-headers';
// `serverEnv` isn't read here yet (no server-side code uses
// SUPABASE_SERVICE_ROLE_KEY until Module 4's admin client). The import
// exists to force boot-time validation of server env vars too — if
// SUPABASE_SERVICE_ROLE_KEY is missing, we crash here, not three
// lessons from now.
import { serverEnv as _serverEnv } from '$lib/server/env';
import { logger as rootLogger, requestLogger } from '$lib/server/logger';
import { baseInitOptions } from '$lib/sentry-shared';
void _serverEnv;

// Sentry initialisation at module load — runs once per Node process,
// not per request. Empty DSN ⇒ `enabled: false`, so local dev with
// no DSN configured is a true no-op.
sentryInit({
	...baseInitOptions(publicEnv.PUBLIC_SENTRY_DSN ?? '')
});

// Cache the resolved environment at module load. It can't change
// across the life of a Node process — a deploy is a fresh process,
// not a runtime mutation — so reading it once removes the
// per-request `process.env` lookup from the security-headers path.
const ENVIRONMENT = resolveEnvironment();

const handleApp: Handle = async ({ event, resolve }) => {
	// Per-request structured logger. Stamped on `event.locals` so
	// every `load`, action, and `+server.ts` can do
	// `event.locals.logger.info(...)` and inherit `req_id` /
	// `route_id` without threading a logger argument through every
	// service call. Wired before the Supabase client so any future
	// breadcrumbs from the `setAll` cookie callback can use it too.
	event.locals.logger = requestLogger(event);

	// Cross-system correlation: Sentry sees the same `req_id` and
	// `route_id` we put on every structured log line, so jumping
	// from a Sentry event to the log query for that exact request
	// is grep-with-a-known-string, not a fishing expedition.
	const reqId = event.locals.logger.bindings().req_id;
	if (typeof reqId === 'string') setTag('req_id', reqId);
	if (event.route.id) setTag('route_id', event.route.id);

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

/**
 * Apply the production security header table (Module 11.4) to
 * every outgoing response. Lives in its own `Handle` so:
 *
 *   - The header logic can be swapped or feature-flagged without
 *     touching `handleApp` (which is busy with auth + Supabase).
 *   - Routes that need to override a specific header (for
 *     example, a future webhook receiver that wants to allow
 *     framing for an embedded UI) can do so by setting the
 *     header on the response themselves — `applySecurityHeaders`
 *     uses `if (!has)` writes, so explicit per-route values win.
 */
const securityHeadersHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	applySecurityHeaders(response, ENVIRONMENT);
	return response;
};

/**
 * `sentryHandle()` MUST come first in the sequence so it can
 * instrument the request span around our handler. SvelteKit's
 * docs are explicit about this; the SDK's instrumentation relies
 * on its hook entry being the outermost wrapper.
 *
 * `securityHeadersHandle` comes last so it sees the *final*
 * response object — a SvelteKit redirect, a Supabase cookie
 * refresh, a custom 503 — and can layer headers onto it without
 * being short-circuited by an earlier handler returning early.
 */
export const handle: Handle = sequence(sentryHandle(), handleApp, securityHeadersHandle);

/**
 * `handleError` is SvelteKit's centralised error-reporting hook,
 * called for every uncaught throw in `load`, `actions`, or
 * `+server.ts`. We wrap it with `handleErrorWithSentry` so:
 *
 *   - Every uncaught error reaches Sentry with the route + status
 *     code already attached (Sentry's SDK does the wiring).
 *   - We get the Sentry `event_id` back as the function's return
 *     value, which becomes `error.message` in `+error.svelte`.
 *
 * The inner handler also logs via the structured logger using the
 * same `req_id` Sentry tagged, so a single grep across both
 * surfaces lines up. We do NOT throw here; SvelteKit invokes the
 * hook precisely so it can render `+error.svelte` with whatever we
 * return.
 */
export const handleError: HandleServerError = handleErrorWithSentry(
	({ error, event, status, message }) => {
		const log = event.locals.logger ?? rootLogger;
		log.error(
			{
				err: error instanceof Error ? error.message : String(error),
				status,
				route_id: event.route.id ?? null
			},
			message ?? 'Uncaught server error'
		);
	}
);
