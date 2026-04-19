/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig, loadEnv } from 'vite';
// Relative path on purpose: vite.config.ts runs *before* the
// SvelteKit plugin sets up the `$lib` alias. Module 11.3 made
// `release.ts` a leaf with no project imports specifically so
// this file can pull from it.
import { resolveRelease } from './src/lib/release';

/**
 * Vite config (Modules 1+, with Module 11.2 source-map upload).
 *
 * SOURCE-MAP UPLOAD STRATEGY
 * --------------------------
 * Sentry needs the original-source mapping for stack traces to
 * resolve back to TypeScript instead of minified `_d` / `_a`
 * blobs. We hand that off to `@sentry/vite-plugin`:
 *
 *   1. Vite generates `*.map` files alongside every emitted chunk
 *      (`build.sourcemap = 'hidden'` — see below).
 *   2. The plugin uploads them tagged with the same `release`
 *      string our Sentry SDK init uses (`resolveRelease()` from
 *      `src/lib/sentry-shared.ts`).
 *   3. The plugin then DELETES the `.map` files from the build
 *      output so production never serves them. Source maps are
 *      world-readable by definition; the only safe place for them
 *      is Sentry's symbolicator.
 *
 * `'hidden'` rather than `true` because:
 *   - `true` ⇒ each chunk gets a `//# sourceMappingURL=...` comment
 *     pointing browsers at the `.map`. Disabled, since we delete
 *     the files post-upload.
 *   - `'hidden'` ⇒ the maps are still written to disk for the
 *     plugin to pick up, but no browser-facing reference is
 *     emitted. Net result: original-source stack traces in Sentry,
 *     no leaked sources at the edge.
 *
 * GATING: ENV-DRIVEN, NOT FILE-DRIVEN
 * -----------------------------------
 * The plugin is added to the array unconditionally, but its
 * `disable: true` flag is the master switch. We flip it on
 * whenever `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`
 * are all set — the same triple that the env validator
 * (`src/lib/server/env.ts`) groups together. Unset triple ⇒
 * `disable: true` ⇒ no upload attempt, no extra build time, no
 * "did you forget your token?" wall of red text in local dev.
 *
 * That gating happens via `loadEnv` rather than `process.env`
 * directly. Vite doesn't merge `.env` files into `process.env`
 * for its own config evaluation — using `loadEnv` is the
 * documented escape hatch.
 *
 * RELEASE STRING SHARING
 * ----------------------
 * The plugin's `release.name` MUST match the runtime SDK's
 * release string. Module 11.3 made both call sites import from
 * `src/lib/release.ts`, so the build-time tag and the runtime
 * SDK tag are byte-for-byte identical by construction. The
 * `loadEnv`-provided dictionary is forwarded to `resolveRelease`
 * so the same fn works regardless of who's reading the env.
 */
export default defineConfig(({ mode }) => {
	// Merge mode-specific .env files (`.env`, `.env.local`,
	// `.env.production`, …). Last arg `''` = surface every
	// variable, not just `VITE_*`-prefixed ones — needed because
	// our Sentry vars don't carry the Vite client-prefix.
	const env = loadEnv(mode, process.cwd(), '');

	const sentryEnabled =
		Boolean(env.SENTRY_AUTH_TOKEN) && Boolean(env.SENTRY_ORG) && Boolean(env.SENTRY_PROJECT);

	// `sentryVitePlugin(...)` returns an *array* of vite plugins
	// (one for the rollup hook surface, one for vite-specific
	// integration). Spread it into the plugins array — wrapping
	// in a single Plugin would defeat the rollup-side machinery.
	const sentryPlugins = sentryVitePlugin({
		// Master switch. When false the plugin still wires its
		// hooks but skips network + IO (its own
		// `disable`-respecting code path).
		disable: !sentryEnabled,
		org: env.SENTRY_ORG,
		project: env.SENTRY_PROJECT,
		authToken: env.SENTRY_AUTH_TOKEN,
		release: {
			name: resolveRelease(env),
			// Don't auto-create or auto-finalize from the plugin.
			// We let the runtime SDK be the source of truth on
			// "this release went live"; the plugin's job is
			// strictly artifact upload. This also avoids a noisy
			// API call on every developer's first `pnpm run build`
			// after enabling the plugin.
			create: false,
			finalize: false
		},
		sourcemaps: {
			// Belt-and-braces: delete map files after upload so
			// the deployed bundle never carries them. The glob
			// matches every artifact path SvelteKit + Vercel emit.
			filesToDeleteAfterUpload: ['./.svelte-kit/output/**/*.map', './.vercel/output/**/*.map']
		},
		// Be loud-but-not-fatal on plugin failure during CI. A
		// 502 from Sentry's symbolicator should never tank a
		// production deploy — the deploy itself is unaffected
		// because the runtime SDK can lazy-symbolicate.
		errorHandler: (err) => {
			console.warn('[sentry-vite-plugin] upload skipped:', err.message);
		},
		telemetry: false
	});

	return {
		plugins: [
			tailwindcss(),
			sveltekit(),
			// MUST come after sveltekit() — the plugin needs the
			// already-compiled output to walk for source maps.
			...sentryPlugins
		],
		build: {
			sourcemap: 'hidden',
			rollupOptions: {
				// Rolldown (Vite 8+) ships a `pluginTimings` check that
				// fires `[PLUGIN_TIMINGS]` whenever a single plugin accounts
				// for >100x the link-stage time. SvelteKit's internal
				// `vite-plugin-sveltekit-guard` hooks every module resolution
				// to enforce `$env`/`$lib`/`$app` import boundaries — by
				// design it dominates a small project's plugin time, so the
				// warning fires on every build with no actionable fix on our
				// end (it's the framework, not our code).
				//
				// We disable ONLY this check; every other Rolldown safety net
				// (circular deps, unresolved imports, eval, missing globals,
				// etc.) stays on. If we ever add a custom plugin that
				// genuinely is slow, drop this override locally to
				// investigate.
				//
				// See https://rolldown.rs/options/checks#plugintimings.
				checks: {
					pluginTimings: false
				}
			}
		},
		server: {
			port: 5173,
			strictPort: false
		},
		test: {
			include: ['src/**/*.{test,spec}.ts'],
			exclude: ['tests/**', 'node_modules/**', 'build/**', '.svelte-kit/**'],
			environment: 'node'
		}
	};
});
