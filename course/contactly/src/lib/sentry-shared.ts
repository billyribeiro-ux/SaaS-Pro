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
 * RELEASE / ENVIRONMENT RESOLUTION
 * --------------------------------
 * Module 11.3 collapsed the previous "two near-identical
 * implementations of resolveRelease" (one here, one in
 * `vite.config.ts` for the source-map upload plugin) into a
 * single `src/lib/release.ts` module. Both call sites now import
 * from the same primitive, so the build-time release tag and
 * the runtime SDK release tag are byte-for-byte identical by
 * construction. That guarantees Sentry's source-map join key
 * always matches.
 *
 * This module is now a thin adapter: it re-exports
 * `resolveRelease` / `resolveEnvironment` for backwards
 * compatibility (the unit tests import from here) and contributes
 * the SDK-shaped `baseInitOptions` factory the two `hooks.*.ts`
 * files spread into their `Sentry.init` calls.
 *
 * DSN AS THE ENABLE TOGGLE
 * ------------------------
 * The DSN is the *only* signal we use for "is Sentry on?". Empty
 * string → `enabled: false`, no Sentry HTTP traffic, zero overhead
 * at runtime. This keeps the local-dev story clean: the validators
 * accept an empty DSN, the SDK silently no-ops, and `pnpm run dev`
 * doesn't ship errors to the production project.
 */
import { resolveEnvironment, resolveRelease } from './release';

export { resolveEnvironment, resolveRelease };

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
