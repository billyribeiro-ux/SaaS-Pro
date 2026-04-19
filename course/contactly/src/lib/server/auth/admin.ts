/**
 * Platform-admin authorisation helper (Module 10.3).
 *
 * Two ways to get past this gate, in priority order:
 *
 *   1. **Bearer token.** When `OPS_API_TOKEN` is set in the env,
 *      requests carrying `Authorization: Bearer <token>` are
 *      compared with `timingSafeEqual` and on success short-circuit
 *      every other check. This is the path monitoring tools and
 *      synthetic checks take: stable, no cookie jar, no
 *      Supabase round-trip.
 *
 *   2. **Signed-in platform admin.** When (1) doesn't fire, we fall
 *      through to `safeGetSession()` and a `profiles.is_platform_admin`
 *      lookup. RLS lets a user read their own row, so this is a
 *      single index-bounded read with no service-role escalation.
 *
 * Anything else returns a deliberately undifferentiated `404 Not
 * Found` (rather than `401`/`403`) so the very existence of the
 * `/admin/*` surface is invisible to unauthorised callers. This is
 * intentional defense-in-depth — a 401 from `/admin/webhooks/health`
 * tells a scraper "there's something here, brute-force the auth";
 * a 404 says "nothing here, move on".
 *
 * The helper THROWS the SvelteKit `error()` wrapper directly, so
 * route code reads as:
 *
 *   const principal = await requireAdminOrToken(event);
 *   // …routes that need to differentiate the two principals can…
 *
 * No try/catch, no manual response shaping.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { serverEnv } from '$lib/server/env';

/**
 * Discriminated principal returned by `requireAdminOrToken`. Routes
 * that need to record "who did this admin action" can branch on
 * `kind`; the audit log entry shape differs between an automated
 * monitor (no user id) and a human admin (user id known).
 */
export type AdminPrincipal =
	| { kind: 'token'; reason: 'ops_api_token' }
	| { kind: 'user'; userId: string };

/**
 * Authorise an admin-only request. Resolves to the principal on
 * success; throws SvelteKit `error(404)` on any failure path.
 */
export async function requireAdminOrToken(event: RequestEvent): Promise<AdminPrincipal> {
	const tokenPrincipal = tryBearerToken(event);
	if (tokenPrincipal) return tokenPrincipal;

	const userPrincipal = await tryAdminUser(event);
	if (userPrincipal) return userPrincipal;

	// Hide the surface entirely from unauthorised callers. See module
	// header for the rationale.
	throw error(404, 'Not Found');
}

function tryBearerToken(event: RequestEvent): AdminPrincipal | null {
	const expected = serverEnv.OPS_API_TOKEN;
	if (!expected) return null;

	const header = event.request.headers.get('authorization') ?? '';
	if (!header.toLowerCase().startsWith('bearer ')) return null;

	// Substring after "Bearer " (7 chars). We tolerate extra
	// whitespace per RFC 7235 lenient parsing.
	const presented = header.slice(7).trim();
	if (presented.length === 0) return null;

	if (!constantTimeEqual(presented, expected)) return null;

	event.locals.logger.info({ admin_principal: 'token' }, 'admin auth via OPS_API_TOKEN');
	return { kind: 'token', reason: 'ops_api_token' };
}

async function tryAdminUser(event: RequestEvent): Promise<AdminPrincipal | null> {
	const { user } = await event.locals.safeGetSession();
	if (!user) return null;

	// `profiles_select_self` policy lets the signed-in user read
	// their own row. No service-role escalation needed.
	const { data, error: readError } = await event.locals.supabase
		.from('profiles')
		.select('is_platform_admin')
		.eq('id', user.id)
		.maybeSingle();

	if (readError) {
		// Failing closed: a DB error here MUST NOT be readable as
		// "you are an admin". Logged as warn (operationally
		// interesting; not Sentry-page-worthy unless persistent).
		event.locals.logger.warn(
			{ pg_code: readError.code, err: readError.message, user_id: user.id },
			'admin gate: failed to read profile.is_platform_admin'
		);
		return null;
	}

	if (!data?.is_platform_admin) return null;

	event.locals.logger.info(
		{ admin_principal: 'user', user_id: user.id },
		'admin auth via is_platform_admin'
	);
	return { kind: 'user', userId: user.id };
}

/**
 * `timingSafeEqual` requires equal-length buffers — feeding it
 * mismatched lengths throws synchronously, which is itself a
 * timing leak. We pad to the longer of the two with a deterministic
 * filler, then call `timingSafeEqual` and AND the length-equality
 * bit at the end. The result is constant-time for any pair of
 * inputs.
 */
function constantTimeEqual(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, 'utf8');
	const bBuf = Buffer.from(b, 'utf8');
	const max = Math.max(aBuf.length, bBuf.length);
	const padA = Buffer.alloc(max, 0);
	const padB = Buffer.alloc(max, 0);
	aBuf.copy(padA);
	bBuf.copy(padB);
	const equal = timingSafeEqual(padA, padB);
	return equal && aBuf.length === bBuf.length;
}
