/**
 * Single source of truth for the build's release identifier.
 *
 * The release string is the join key Sentry uses to glue an
 * uploaded source map (Module 11.2) to a runtime-tagged event
 * (Module 10.2). If the two ever drift, Sentry shows minified
 * frames even though the maps are uploaded — the silent failure
 * mode this module exists to prevent.
 *
 * Used by:
 *   - `src/lib/sentry-shared.ts`     → SDK init at runtime
 *   - `vite.config.ts`               → @sentry/vite-plugin upload
 *   - `src/routes/api/version`       → operational sanity check
 *
 * SHAPE: `'contactly@<12-char-sha-or-marker>'`
 *
 *   `contactly@abc123def456`  ← Vercel production / preview
 *   `contactly@manual-pin`    ← explicit PUBLIC_SENTRY_RELEASE
 *   `contactly@dev`           ← local dev fallback
 *
 * The 12-char SHA truncation matches `git log --abbrev=12` and is
 * long enough to be unique across the project's lifetime while
 * staying readable in the Sentry UI.
 *
 * NO $LIB IMPORTS / NO TYPE-ONLY DEPENDENCIES
 * --------------------------------------------
 * Vite's config file (`vite.config.ts`) cannot resolve the `$lib`
 * alias (the alias is set up by the SvelteKit plugin, which runs
 * *after* the config is read). We import this module by relative
 * path from `vite.config.ts`, so it cannot reach for any other
 * project module. Stays a leaf — small, pure, easy to test.
 */

const RELEASE_PREFIX = 'contactly';
const SHA_DISPLAY_CHARS = 12;
const DEV_MARKER = 'dev';

/**
 * Resolve the release identifier, in precedence order:
 *
 *   1. `PUBLIC_SENTRY_RELEASE` — explicit override. Used for CI
 *      pipelines that want a semver-shaped tag (`contactly@1.4.0`)
 *      independent of git, or for reproducible-deploy
 *      experiments.
 *   2. `VERCEL_GIT_COMMIT_SHA` — auto-injected by Vercel at both
 *      build and runtime. Truncated to 12 chars for ergonomics.
 *   3. `'contactly@dev'` — local dev marker. Sentry rolls all of
 *      these into a single "release" so dev errors don't pollute
 *      production stats.
 *
 * The optional `env` argument is for situations where you have
 * already loaded a vars dict (e.g. Vite's `loadEnv`); the default
 * reads `process.env` lazily so callers in browser bundles don't
 * crash when `process` isn't defined.
 */
export function resolveRelease(env?: Record<string, string | undefined>): string {
	const read = (name: string): string => {
		if (env) return (env[name] ?? '').trim();
		if (typeof process === 'undefined' || !process.env) return '';
		const v = process.env[name];
		return typeof v === 'string' ? v.trim() : '';
	};

	const explicit = read('PUBLIC_SENTRY_RELEASE');
	if (explicit) return explicit;

	const sha = read('VERCEL_GIT_COMMIT_SHA');
	if (sha) return `${RELEASE_PREFIX}@${sha.slice(0, SHA_DISPLAY_CHARS)}`;

	return `${RELEASE_PREFIX}@${DEV_MARKER}`;
}

/**
 * Resolve the deploy environment, in precedence order:
 *
 *   1. `VERCEL_ENV` — `'production'` / `'preview'` / `'development'`,
 *      auto-injected by Vercel.
 *   2. `NODE_ENV` — fallback for non-Vercel runtimes.
 *   3. `'development'` — local dev fallback.
 *
 * Surfaced separately from the release because Sentry uses them
 * for different things: release groups stats over time, environment
 * scopes alerts and dashboards.
 */
export function resolveEnvironment(env?: Record<string, string | undefined>): string {
	const read = (name: string): string => {
		if (env) return (env[name] ?? '').trim();
		if (typeof process === 'undefined' || !process.env) return '';
		const v = process.env[name];
		return typeof v === 'string' ? v.trim() : '';
	};

	const vercel = read('VERCEL_ENV');
	if (vercel) return vercel;

	// Node coerces `delete process.env.X` to `''` rather than
	// `undefined`, so a truthy check is the right gate here.
	const node = read('NODE_ENV');
	return node || 'development';
}

/**
 * The full git SHA (untruncated) when available. Useful for
 * commit-link generation in operational dashboards or
 * version-info endpoints; otherwise prefer `resolveRelease`.
 */
export function resolveCommitSha(env?: Record<string, string | undefined>): string | null {
	const read = (name: string): string => {
		if (env) return (env[name] ?? '').trim();
		if (typeof process === 'undefined' || !process.env) return '';
		const v = process.env[name];
		return typeof v === 'string' ? v.trim() : '';
	};
	return read('VERCEL_GIT_COMMIT_SHA') || null;
}

/**
 * The branch the deploy was built from (Vercel-injected).
 * Useful for showing "preview from feature/billing-portal" in
 * an admin chrome.
 */
export function resolveCommitBranch(env?: Record<string, string | undefined>): string | null {
	const read = (name: string): string => {
		if (env) return (env[name] ?? '').trim();
		if (typeof process === 'undefined' || !process.env) return '';
		const v = process.env[name];
		return typeof v === 'string' ? v.trim() : '';
	};
	return read('VERCEL_GIT_COMMIT_REF') || null;
}
