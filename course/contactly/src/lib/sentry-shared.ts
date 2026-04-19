/**
 * Shared Sentry config — single source of truth for the bits the
 * client and server both want.
 *
 * SCOPE
 * -----
 * The two `Sentry.init({...})` calls (one in `src/hooks.client.ts`,
 * one in `src/hooks.server.ts`) consume this. Anything that's the
 * same on both runtimes lives here; runtime-specific options
 * (integrations, transports) stay at the call site.
 *
 * RELEASE TAGGING
 * ---------------
 * Sentry's "release" string is the join key between an error event
 * and "which deploy was this?". We surface the Vercel-provided git
 * SHA (`VERCEL_GIT_COMMIT_SHA`, available at build *and* runtime)
 * with a fallback chain for local dev and self-hosted scenarios.
 * The first env var that's set wins; the literal `'dev'` is the
 * last-resort marker so a local error doesn't pollute the
 * production release's stats.
 *
 * DSN AS THE ENABLE TOGGLE
 * ------------------------
 * The DSN is the *only* signal we use for "is Sentry on?". Empty
 * string → `enabled: false`, no Sentry HTTP traffic, zero overhead
 * at runtime. This keeps the local-dev story clean: the validators
 * accept an empty DSN, the SDK silently no-ops, and `pnpm run dev`
 * doesn't ship errors to the production project.
 */

/**
 * Resolve the release identifier we tag every event with.
 *
 * Order of precedence:
 *   1. `PUBLIC_SENTRY_RELEASE`  — explicit override (CI/CD pinning,
 *                                 reproducible releases).
 *   2. `VERCEL_GIT_COMMIT_SHA`  — Vercel-injected. Truncated to 12
 *                                 chars for ergonomic display in
 *                                 the Sentry UI; full SHA is also
 *                                 attached as a tag for replay.
 *   3. `'dev'`                  — local fallback.
 */
export function resolveRelease(): string {
	const explicit = readEnv('PUBLIC_SENTRY_RELEASE');
	if (explicit) return explicit;
	const sha = readEnv('VERCEL_GIT_COMMIT_SHA');
	if (sha) return `contactly@${sha.slice(0, 12)}`;
	return 'contactly@dev';
}

/**
 * Resolve the Sentry environment name (used to scope dashboards
 * + alerts in the Sentry UI). Mirrors `NODE_ENV` on most platforms;
 * Vercel adds the `VERCEL_ENV` discriminator (`preview` /
 * `production`) which we surface verbatim so previews are visible
 * but never fire prod alerts.
 */
export function resolveEnvironment(): string {
	const vercel = readEnv('VERCEL_ENV');
	if (vercel) return vercel;
	const node = readEnv('NODE_ENV');
	// `readEnv` collapses missing/empty to '', so a truthy check is
	// the right gate here; Node has the slightly surprising habit of
	// coercing `delete process.env.X` to `''` rather than `undefined`,
	// which would otherwise leak through as a Sentry environment of
	// the empty string.
	return node || 'development';
}

/**
 * The base config object both runtimes spread into their own
 * `Sentry.init({...})`. Kept type-loose (`Record<string, unknown>`)
 * so this module doesn't import from `@sentry/sveltekit` directly —
 * Sentry's type imports are surprisingly heavy, and forcing the
 * SSR bundle to evaluate them on every request just to read these
 * five fields is overkill.
 */
export function baseInitOptions(dsn: string): Record<string, unknown> {
	return {
		dsn,
		enabled: dsn.length > 0,
		release: resolveRelease(),
		environment: resolveEnvironment(),
		// Trace 10% of transactions in production; everything in dev
		// (and zero in test, by virtue of the DSN being empty). 10%
		// is the canonical "enough to spot regressions, cheap enough
		// not to bankrupt the Sentry quota" rate.
		tracesSampleRate: resolveEnvironment() === 'production' ? 0.1 : 1.0,
		// Don't send Personally Identifiable Information by default.
		// We attach `user_id` ourselves where it's relevant (server
		// hooks, after the auth check), so the implicit IP-address
		// capture from the SDK is the only thing this disables.
		sendDefaultPii: false
	};
}

/**
 * Read an env var without crashing in environments where some are
 * undefined (e.g. `process.env` doesn't exist in the browser
 * runtime). Returns an empty string when the var is missing or
 * empty so callers can pattern-match on falsy.
 */
function readEnv(name: string): string {
	if (typeof process === 'undefined' || !process.env) return '';
	const value = process.env[name];
	return typeof value === 'string' ? value.trim() : '';
}
