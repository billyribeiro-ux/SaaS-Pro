import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SvelteKit configuration.
 *
 * Module 11.1 swapped `@sveltejs/adapter-auto` (the "I'll figure
 * out where I'm running" placeholder) for `@sveltejs/adapter-vercel`
 * — explicit deployment target = explicit performance + cost
 * envelope. Vercel was the canonical pick because:
 *
 *   - Native SvelteKit support, including streamed responses, edge
 *     middleware, and the `+server.ts` runtime config object below.
 *   - First-class environment-aware deploys (preview / production)
 *     that pair cleanly with `VERCEL_ENV` already wired into our
 *     Sentry release tagging (`src/lib/sentry-shared.ts`).
 *   - Image, log, and ISR primitives we'll use in later modules
 *     without a second migration.
 *
 * RUNTIME CHOICE
 * --------------
 * Defaulting to the Node.js serverless runtime — NOT edge.
 *
 * Edge functions deploy to dozens of regions and start in
 * single-digit milliseconds, which sounds appealing until you
 * realize:
 *
 *   - The `pino` logger streams to stdout via Node's worker
 *     thread; edge runtimes don't expose worker_threads, so
 *     `pino.transport({ target: 'pino-pretty' })` blows up at
 *     module-load.
 *   - Stripe's official Node SDK uses `fetch` everywhere now (good)
 *     but our webhook handler verifies signatures via `crypto`
 *     subtle APIs that have edge/runtime behavior differences worth
 *     pinning down before we move them.
 *   - Supabase SSR works on edge but their Postgres connection
 *     pooler is happiest with a long-lived Node process behind it.
 *
 * Once Module 12 lands (recorded-cassette tests) and Module 13
 * benchmarks the cold-start hit, we revisit per-route runtime
 * overrides via `export const config` in `+server.ts` files. For
 * now: one runtime, one Node version, one set of mental models.
 *
 * REGION
 * ------
 * `regions: ['iad1']` (US-East / Washington DC) keeps the function
 * co-located with our Supabase project (default region for new
 * Supabase US accounts) and our Stripe webhook listener. Cross-
 * region round-trips for every webhook event = wasted latency.
 *
 * Override for a multi-region deployment by setting `regions: 'all'`
 * here — Vercel charges per-region active time, not per-region
 * deploy, so it's a billing decision rather than a config one.
 *
 * NODE.JS VERSION
 * ---------------
 * Pinned to `nodejs22.x` (current LTS at the time of writing,
 * matches our `package.json#engines.node >=20`). Vercel will
 * happily auto-upgrade to whatever's "current" if you omit this,
 * which means the deploy that worked yesterday can break today
 * because Vercel rolled the runtime forward. Pin it.
 */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x',
			regions: ['iad1'],
			memory: 1024,
			maxDuration: 30
		})
		// SvelteKit's default-on CSRF Origin check is left at its
		// default (`csrf.trustedOrigins: []`). Cross-origin form
		// posts to mutating verbs (POST/PUT/PATCH/DELETE) are
		// rejected at the framework boundary, which is exactly the
		// posture the admin replay tool, sign-out, and Stripe
		// checkout forms need. Adding entries to `trustedOrigins`
		// is the correct knob if/when an external partner needs to
		// post a form into us — never disable the check globally.
	}
};

export default config;
