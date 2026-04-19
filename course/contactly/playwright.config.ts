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

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.{spec,e2e}.ts',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
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
				process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEMO_SUPABASE_SERVICE_ROLE_KEY
		}
	}
});
