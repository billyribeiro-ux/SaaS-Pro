import { expect, test } from '@playwright/test';

/**
 * Lesson 3.4 — Sign-out + nav smoke tests.
 *
 * Same constraint as the rest of the Module 3 suite — no real
 * authenticated session in CI, so we exercise what we CAN exercise
 * without one:
 *
 *   1. GET /sign-out is REJECTED with HTTP 405. Proves the CSRF
 *      defense is wired (no bare `<a href="/sign-out">` ever logs
 *      anyone out, no matter how the link is delivered).
 *   2. The marketing nav switches its CTAs based on auth state.
 *      In the unauthenticated state we render Sign in + Sign up,
 *      not Dashboard.
 *
 * Authenticated round-trip ("click sign-out → land on / → see Sign
 * in CTA again") needs the Module 12.x signed-in fixture.
 */

test('GET /sign-out is rejected with 405', async ({ request }) => {
	const response = await request.get('/sign-out', { maxRedirects: 0 });
	expect(response.status()).toBe(405);
});

test('marketing nav shows sign-in CTAs when signed-out', async ({ page }) => {
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: /primary/i });

	await expect(nav.getByRole('link', { name: /^sign in$/i })).toBeVisible();
	await expect(nav.getByRole('link', { name: /^sign up$/i })).toBeVisible();
	await expect(nav.getByRole('link', { name: /^dashboard$/i })).toHaveCount(0);
	await expect(nav.getByTestId('nav-user-email')).toHaveCount(0);
});
