/**
 * Server-only, runtime-resolved environment variables.
 *
 * Lives under `$lib/server/` so SvelteKit's server-only-module guard
 * makes it impossible to accidentally import these values into client
 * code. If a `.svelte` page or universal `+page.ts` ever imports from
 * here, the build fails with a clear error pointing at the import
 * chain — that guarantee is worth more than any amount of "remember
 * not to leak secrets" code review.
 *
 * Why `$env/dynamic/private` and not `$env/static/private`?
 * --------------------------------------------------------
 * Same reason as the public side (see `src/lib/env.public.ts`):
 * Vercel's same-build-many-environments model wants runtime resolution.
 * Static private vars *would* be slightly more efficient (build-time
 * dead-code elimination), but the operational cost of rebuilds for
 * env changes outweighs that micro-optimization for our use case.
 *
 * What's NOT in here yet
 * ----------------------
 * Stripe, Resend, and Sentry secrets land in this schema in the modules
 * that introduce them (5/6, 9, 17). Adding them now would mean either
 * making them optional (which gives up the fail-fast guarantee) or
 * making the tutorial's `pnpm run dev` fail until the student has
 * signed up for three SaaS products before lesson 2.1. Neither is OK.
 */
import * as z from 'zod';
import { env as rawEnv } from '$env/dynamic/private';

const serverEnvSchema = z.object({
	SUPABASE_SERVICE_ROLE_KEY: z.string({ error: 'SUPABASE_SERVICE_ROLE_KEY is required' }).min(20, {
		error:
			'SUPABASE_SERVICE_ROLE_KEY looks too short to be a real key. ' +
			'Run `pnpm run db:status` after `pnpm run db:start` to print the local value.'
	})
});

const result = serverEnvSchema.safeParse(rawEnv);

if (!result.success) {
	const issues = result.error.issues
		.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
		.join('\n');
	throw new Error(
		`Invalid server environment variables. Set the following in .env (see .env.example):\n${issues}\n`
	);
}

/**
 * Validated, typed server environment.
 *
 * Import this everywhere instead of `$env/dynamic/private` — it's
 * type-safe, never undefined, and parsed once at boot.
 */
export const serverEnv = Object.freeze(result.data);
