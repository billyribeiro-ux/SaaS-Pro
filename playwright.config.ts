import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = !!process.env.CI;

/*
 * Playwright config — single source of truth for both local dev and CI.
 *
 * - We boot a *production* preview server (`pnpm build && pnpm preview`) so
 *   tests exercise the same SSR pipeline that ships to Vercel. CI uses
 *   placeholder env vars (see .github/workflows/deploy.yml), so anything
 *   beyond marketing/auth pages must be skipped or stubbed.
 * - On CI we forbid `.only`, retry once, and run a single worker so failures
 *   are reproducible and a flaky test can't hide behind concurrency.
 */
export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.{ts,js}',
	timeout: 30_000,
	fullyParallel: !isCI,
	workers: isCI ? 1 : undefined,
	retries: isCI ? 1 : 0,
	forbidOnly: isCI,
	reporter: isCI ? [['list'], ['github']] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: PORT,
		reuseExistingServer: !isCI,
		timeout: 120_000
	}
});
