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
 * Resend and Sentry secrets land in this schema in the modules
 * that introduce them (9, 17). Adding them now would mean either
 * making them optional (which gives up the fail-fast guarantee) or
 * making the tutorial's `pnpm run dev` fail until the student has
 * signed up for three SaaS products before lesson 2.1. Neither is OK.
 *
 * Stripe is added at Module 6 (this file's previous revision flagged
 * the addition point) — `STRIPE_SECRET_KEY` and
 * `STRIPE_WEBHOOK_SECRET` are now required, and the playwright
 * webServer ships well-known demo values (see
 * `playwright.config.ts`) so e2e + build still pass without a real
 * Stripe account.
 */
import * as z from 'zod';
import { env as rawEnv } from '$env/dynamic/private';

const serverEnvSchema = z
	.object({
		SUPABASE_SERVICE_ROLE_KEY: z
			.string({ error: 'SUPABASE_SERVICE_ROLE_KEY is required' })
			.min(20, {
				error:
					'SUPABASE_SERVICE_ROLE_KEY looks too short to be a real key. ' +
					'Run `pnpm run db:status` after `pnpm run db:start` to print the local value.'
			}),
		// Accept either a Restricted API Key (`rk_test_...` / `rk_live_...`)
		// — the strongly recommended choice; see ADR-007 + Lesson 6.1 — or
		// a full Secret Key. The format check is intentionally permissive
		// (length + prefix) rather than tight: Stripe's key formats have
		// drifted historically and we don't want a `pnpm run build` to
		// break the day they roll out a new prefix. The actual key is
		// validated when the SDK first contacts Stripe.
		STRIPE_SECRET_KEY: z
			.string({ error: 'STRIPE_SECRET_KEY is required (Module 6+)' })
			.min(20, { error: 'STRIPE_SECRET_KEY looks too short to be a real Stripe key.' })
			.refine((v) => /^(sk|rk)_(test|live)_/.test(v), {
				error:
					'STRIPE_SECRET_KEY should start with `sk_test_`, `sk_live_`, `rk_test_` or `rk_live_`. ' +
					'Prefer a Restricted API Key (`rk_test_...`) — see docs/stripe/07-stripe-node-client.md.'
			}),
		// Webhook signing secret. In dev the Stripe CLI prints a fresh
		// `whsec_...` every time you run `stripe listen`; in production
		// it's a stable, per-endpoint value from the Dashboard. Required
		// from Lesson 6.3 onwards because the webhook handler refuses to
		// accept any request without verified signature.
		STRIPE_WEBHOOK_SECRET: z
			.string({ error: 'STRIPE_WEBHOOK_SECRET is required (Module 6+)' })
			.min(20, { error: 'STRIPE_WEBHOOK_SECRET looks too short to be a real signing secret.' })
			.refine((v) => v.startsWith('whsec_'), {
				error:
					'STRIPE_WEBHOOK_SECRET should start with `whsec_`. ' +
					'Run `pnpm run stripe:listen` and copy the secret it prints on startup.'
			}),
		/**
		 * Operator-only API token (Module 10.3). When set, lets monitoring
		 * tools (UptimeRobot, Datadog Synthetics, …) hit `/api/admin/*`
		 * endpoints with `Authorization: Bearer <OPS_API_TOKEN>` instead
		 * of going through the human-auth + `is_platform_admin` cookie
		 * path.
		 *
		 * Optional. When empty (the local-dev default) the bearer-token
		 * branch in `requireAdminOrToken` is fully disabled — *any*
		 * incoming bearer token is rejected, no string comparison
		 * happens, no early-return surprise. The flag only opens for
		 * traffic when an operator deliberately provisions a token.
		 *
		 * The 32-char floor is the smallest length where a generic
		 * brute-force is prohibitively expensive over HTTPS;
		 * `crypto.randomBytes(32).toString('base64url')` is the
		 * recommended way to mint one.
		 */
		OPS_API_TOKEN: z
			.string()
			.optional()
			.default('')
			.refine((v) => v === '' || v.length >= 32, {
				error:
					'OPS_API_TOKEN must be at least 32 characters when set. ' +
					'Generate one with `node -e "console.log(crypto.randomBytes(32).toString(\\"base64url\\"))"`.'
			}),
		/**
		 * Sentry source-map upload triple (Module 11.2). All three are
		 * optional and exclusively read at *build* time by
		 * `@sentry/vite-plugin` — we model them in the server env schema
		 * so a misconfiguration (e.g. token without org) fails closed
		 * instead of silently uploading nothing.
		 *
		 *   - SENTRY_AUTH_TOKEN — Sentry organization or personal access
		 *     token with `project:write` + `release:admin` scopes.
		 *     Empty ⇒ source-map upload disabled.
		 *   - SENTRY_ORG / SENTRY_PROJECT — org and project slugs that
		 *     own the release. Required when the token is set; the
		 *     plugin refuses to start without them.
		 *
		 * The plugin reads these via `process.env` directly (Vite is
		 * only loaded at build), so this schema is the operator-facing
		 * documentation, not the consumer.
		 */
		SENTRY_AUTH_TOKEN: z.string().optional().default(''),
		SENTRY_ORG: z.string().optional().default(''),
		SENTRY_PROJECT: z.string().optional().default('')
	})
	.superRefine((cfg, ctx) => {
		const token = cfg.SENTRY_AUTH_TOKEN.trim();
		const org = cfg.SENTRY_ORG.trim();
		const project = cfg.SENTRY_PROJECT.trim();

		if (token && (!org || !project)) {
			ctx.addIssue({
				code: 'custom',
				path: ['SENTRY_AUTH_TOKEN'],
				message:
					'SENTRY_AUTH_TOKEN is set, but SENTRY_ORG and/or SENTRY_PROJECT are not. ' +
					'Source-map upload needs all three (token, org slug, project slug) — set ' +
					'them all or unset the token.'
			});
		}
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
