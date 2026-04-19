/**
 * Public, runtime-resolved environment variables.
 *
 * "Public" means the values can be safely shipped to a browser — they're
 * the things you'd happily put in a `<meta>` tag. Anything secret goes in
 * `$lib/server/env` instead.
 *
 * Why `$env/dynamic/public` and not `$env/static/public`?
 * -------------------------------------------------------
 * Vercel injects environment variables at runtime, and the same build
 * artifact serves preview, staging, and production deploys with
 * different values. Static env vars get **inlined into the JS bundle at
 * build time**, which would mean every preview deploy gets the same
 * baked-in URL. Dynamic env vars are read at runtime — the values can
 * differ per environment without rebuilding.
 *
 * Why Zod?
 * --------
 * `$env/dynamic/public` returns `Record<string, string | undefined>`. If
 * we used those values raw, every consumer would have to handle the
 * `undefined` case (and would silently use empty strings if they didn't,
 * which is the source of bugs like "Supabase client created with URL
 * 'undefined' — fails opaquely on the first request"). Zod parses the
 * raw env, throws a precise error if anything is missing or malformed,
 * and gives us a typed object the rest of the app can rely on.
 *
 * The validators are evaluated lazily — the first import of this module
 * triggers parse(). That happens during SSR boot via `hooks.server.ts`
 * (Lesson 2.3 wires that import) which means the app fails fast on
 * server start rather than on the first request that actually uses
 * Supabase.
 */
import * as z from 'zod';
import { env as rawEnv } from '$env/dynamic/public';

const publicEnvSchema = z.object({
	PUBLIC_SUPABASE_URL: z
		.url({ error: 'PUBLIC_SUPABASE_URL must be a valid URL (e.g. http://127.0.0.1:64321)' })
		.refine((url) => url.startsWith('http://') || url.startsWith('https://'), {
			error: 'PUBLIC_SUPABASE_URL must use http or https'
		}),
	PUBLIC_SUPABASE_ANON_KEY: z
		.string({ error: 'PUBLIC_SUPABASE_ANON_KEY is required' })
		.min(20, { error: 'PUBLIC_SUPABASE_ANON_KEY looks too short to be a real Supabase anon key' }),
	/**
	 * Sentry DSN (Module 10.2). Optional — empty string disables
	 * Sentry on both client and server, which is the right local-dev
	 * default (no noise from `pnpm run dev` errors hitting the
	 * production project). The DSN itself is not a secret; it's a
	 * write-only ingestion url. Set in Vercel's project settings for
	 * the deployed environments.
	 *
	 * Accept either an empty string (treated as "Sentry disabled") or
	 * a real `https://…@…sentry.io/…` URL — anything else is a typo
	 * and we want to fail loudly at boot rather than silently drop
	 * every error report.
	 */
	PUBLIC_SENTRY_DSN: z
		.string()
		.optional()
		.default('')
		.refine((v) => v === '' || /^https:\/\/[^@]+@[^/]+\/\d+$/.test(v), {
			error:
				'PUBLIC_SENTRY_DSN must be a valid Sentry DSN ' +
				'(`https://<key>@<host>/<project>`) or an empty string to disable.'
		})
});

const result = publicEnvSchema.safeParse(rawEnv);

if (!result.success) {
	const issues = result.error.issues
		.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
		.join('\n');
	throw new Error(
		`Invalid public environment variables. Set the following in .env (see .env.example):\n${issues}\n`
	);
}

/**
 * Validated, typed public environment.
 *
 * Import this everywhere instead of `$env/dynamic/public` — it's
 * type-safe, never undefined, and parsed once at boot.
 */
export const publicEnv = Object.freeze(result.data);
