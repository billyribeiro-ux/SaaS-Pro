import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Demo env values for the Playwright web server.
 *
 * `vite preview` does NOT load `.env` files (see Vite docs — only
 * `vite dev` and `vite build` do), so we pass the variables our env
 * validators (`src/lib/env.public.ts`, `src/lib/server/env.ts`) require
 * via the `webServer.env` option below. These are the same well-known,
 * publicly-shipped values the Supabase CLI prints when you run
 * `supabase start` with the default JWT secret — safe to commit because
 * anyone with Docker can derive them locally. They do NOT match
 * production, which is the point: e2e tests should never see real
 * secrets, and a developer who runs `pnpm run test:e2e` shouldn't have
 * to copy `.env.example` to `.env` first.
 *
 * If a real env var with the same name exists in the spawning shell
 * (e.g. set by CI, or by a developer who DID copy `.env.example`), it
 * wins via the `?? DEMO_*` fallback. That preserves the ability to
 * override per-environment without editing this file.
 */
const DEMO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:64321';
const DEMO_PUBLIC_SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const DEMO_SUPABASE_SERVICE_ROLE_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
// Syntactically-valid placeholders so the env validator passes during
// `pnpm run test:e2e` / `pnpm run build`. They are NOT real Stripe
// credentials and any actual API call with them returns 401. Tests
// that need Stripe must mock the SDK (Module 11.3) or override these
// envs with real test-mode values from `stripe login`'s account.
const DEMO_STRIPE_SECRET_KEY = 'sk_test_demo_e2e_placeholder_not_a_real_key_DO_NOT_USE';
const DEMO_STRIPE_WEBHOOK_SECRET = 'whsec_demo_e2e_placeholder_not_a_real_signing_secret_xx';

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.{spec,e2e}.ts',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	// One preview server feeds every worker. Beyond 2 parallel
	// workers we've seen sporadic timeouts on form-submit waits as
	// the SSR pipeline gets contended. Capping locally to 2 keeps the
	// suite fast (~5s) without the flake; CI uses 1 for full
	// determinism.
	workers: process.env.CI ? 1 : 2,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm run build && pnpm run preview --port ${PORT}`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL ?? DEMO_PUBLIC_SUPABASE_URL,
			PUBLIC_SUPABASE_ANON_KEY:
				process.env.PUBLIC_SUPABASE_ANON_KEY ?? DEMO_PUBLIC_SUPABASE_ANON_KEY,
			SUPABASE_SERVICE_ROLE_KEY:
				process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEMO_SUPABASE_SERVICE_ROLE_KEY,
			STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? DEMO_STRIPE_SECRET_KEY,
			STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? DEMO_STRIPE_WEBHOOK_SECRET
		}
	}
});
