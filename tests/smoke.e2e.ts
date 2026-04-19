import { expect, test } from '@playwright/test';

/*
 * Smoke suite — the bare minimum Playwright pass that proves the production
 * bundle SSR-renders the public surface without crashing. We deliberately do
 * NOT exercise auth, Supabase, or live Stripe here: CI runs against
 * placeholder env vars (no real backend), so anything that hits the network
 * for real data must stay out of this file. Add deeper flows in dedicated
 * `*.e2e.ts` files behind their own `test.describe` once we have a hermetic
 * test database wired up.
 */

test.describe('public surface @smoke', () => {
	test('home page renders the hero and primary CTA', async ({ page }) => {
		await page.goto('/');

		// The hero <h1> is the single most stable anchor on the page — if this
		// breaks, the whole landing experience is broken, which is exactly
		// the failure mode we want CI to scream about.
		await expect(page.locator('h1').first()).toBeVisible();

		// Either of the primary CTAs ("Get started" in nav, hero CTA, etc.)
		// should resolve to /register or /pricing. We assert one such link
		// exists rather than pinning to specific copy that marketing may tweak.
		const ctas = page.locator('a[href="/register"], a[href="/pricing"]');
		await expect(ctas.first()).toBeVisible();
	});

	test('pricing page renders without throwing', async ({ page }) => {
		const response = await page.goto('/pricing');
		expect(response?.status(), 'pricing must return 2xx in CI').toBeLessThan(400);

		// The pricing load() function falls back to an empty catalog when Stripe
		// isn't reachable (which is the case in CI). The page must still SSR.
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('login page renders the form', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
	});

	test('register page renders the form', async ({ page }) => {
		await page.goto('/register');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
	});

	test('protected route redirects unauthenticated users to /login', async ({ page }) => {
		// /contacts is gated by the (app) layout — anonymous hits should
		// land on /login (or /login?next=...). Asserting the URL prefix avoids
		// brittle full-string matches against query params we may change.
		const response = await page.goto('/contacts');
		expect(response?.status(), 'gated route must not 5xx').toBeLessThan(500);
		await expect(page).toHaveURL(/\/login/);
	});
});
