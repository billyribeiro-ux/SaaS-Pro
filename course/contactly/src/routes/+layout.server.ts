/**
 * Root server load — runs on every server render.
 *
 * Two jobs:
 *
 *  1. Resolve the current session via `safeGetSession` (the JWT-validating
 *     wrapper from `hooks.server.ts`) and expose `session` + `user` to
 *     every page. Children's load functions can read either from
 *     `event.locals.safeGetSession()` themselves or from `parent()` data.
 *
 *  2. Pass `cookies.getAll()` to the universal `+layout.ts` load (Lesson
 *     2.4). The universal load will create a Supabase **server** client
 *     during the SSR pass, and that server client needs to see the same
 *     auth cookies the request arrived with. Without forwarding them,
 *     the SSR-rendered HTML would show the user as logged out for one
 *     paint frame before the browser client's hydration corrects it —
 *     a flash of unauthenticated content (FOUC's auth cousin).
 *
 * Importantly, this load runs the auth check on every request even for
 * the homepage. Cost is one in-memory `getSession()` call (free, no
 * network) plus one `getUser()` round-trip to Supabase Auth IF a
 * session cookie is present. For unauthenticated visitors there's no
 * `getUser()` call at all.
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, cookies }) => {
	const { session, user } = await safeGetSession();

	return {
		session,
		user,
		cookies: cookies.getAll()
	};
};
