/**
 * Privileged Supabase client (service-role).
 *
 * USE THIS WITH SURGICAL PRECISION. The service-role key BYPASSES RLS
 * and can read, modify, and delete every row in every table belonging
 * to every user. There is no second line of defense — Postgres trusts
 * whatever this client says.
 *
 * RULES OF THE ROAD
 * -----------------
 *  1. NEVER import this from anything that might end up in the
 *     browser bundle. The `$lib/server/` prefix gives us a hard
 *     SvelteKit-level guard: any client/universal module that
 *     imports from `server/...` triggers a build error. That's the
 *     primary defense; not a mere convention.
 *
 *  2. Use it ONLY when:
 *     - You need to act on behalf of the user but the action requires
 *       a privilege RLS withholds from a regular session (today: user
 *       deletion via `auth.admin.deleteUser`). RLS doesn't cover
 *       `auth.users` at all — only the auth-admin API surface.
 *     - You need to perform a system action that has no "user"
 *       (cron jobs, webhook ingestion). We don't have any of these
 *       yet; Module 5 (Stripe webhooks) introduces the second.
 *
 *  3. ALWAYS gate the request by re-deriving the acting user from
 *     `safeGetSession()` or the calling endpoint's auth check before
 *     using this client. Never trust an `id` from the URL or form
 *     body. If the action is "delete the current user", you read
 *     the current user's id from the validated session, not from
 *     `request.body.id`.
 *
 *  4. NEVER export this from a `+page.server.ts` `load()` return value
 *     (that would serialize it to the browser via SvelteKit's data
 *     pipeline). The lint won't catch this; only code review will.
 *
 * `persistSession: false` + `autoRefreshToken: false`
 * ---------------------------------------------------
 * The service-role key never expires, so refresh logic is a footgun
 * (the SDK would store the key in localStorage on the client — we
 * never run there, but belt-and-braces). `persistSession: false`
 * means each call is stateless — no in-memory accumulation of session
 * data that could leak across requests in a long-running serverless
 * worker.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import { publicEnv } from '$lib/env.public';
import { serverEnv } from '$lib/server/env';

let cached: ReturnType<typeof createClient<Database>> | undefined;

/**
 * Return the singleton service-role client.
 *
 * Lazy-instantiated so the module load is cheap (no network or env
 * read at import time beyond what `serverEnv` already does at boot).
 * Memoized so we don't recreate the underlying fetch agent on every
 * request — that's measurable in a hot path.
 */
export function supabaseAdmin() {
	if (!cached) {
		cached = createClient<Database>(
			publicEnv.PUBLIC_SUPABASE_URL,
			serverEnv.SUPABASE_SERVICE_ROLE_KEY,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false,
					// Don't try to read OAuth callback params on the URL —
					// this client never runs in a browser context where
					// that would even make sense.
					detectSessionInUrl: false
				}
			}
		);
	}
	return cached;
}

/**
 * Audit-wrapped service-role operation.
 *
 * The thing that distinguishes a safe service-role usage from a
 * dangerous one is whether you can answer "who did this and why"
 * after the fact. `withAdmin` makes that the path of least
 * resistance: every call site declares the operation name and the
 * acting user (or `'system'`), the wrapper logs entry/exit/failure
 * with structured context, and the underlying admin client is only
 * passed *into* the callback (so you can't accidentally leak it out
 * of the audited boundary).
 *
 * In Module 12 we'll replace these `console.*` calls with `pino`
 * structured logs and a `audit_log` table insert. The signature
 * stays the same.
 */
export async function withAdmin<T>(
	operation: string,
	actingUser: { id: string; email?: string | null } | 'system',
	fn: (admin: ReturnType<typeof supabaseAdmin>) => Promise<T>
): Promise<T> {
	const actor =
		actingUser === 'system'
			? { actor_kind: 'system' as const }
			: { actor_kind: 'user' as const, actor_id: actingUser.id, actor_email: actingUser.email };

	const startedAt = Date.now();
	console.info('[admin]', { event: 'start', operation, ...actor });

	try {
		const result = await fn(supabaseAdmin());
		console.info('[admin]', {
			event: 'ok',
			operation,
			...actor,
			duration_ms: Date.now() - startedAt
		});
		return result;
	} catch (err) {
		console.error('[admin]', {
			event: 'fail',
			operation,
			...actor,
			duration_ms: Date.now() - startedAt,
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}
