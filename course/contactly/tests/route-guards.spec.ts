import { expect, test } from '@playwright/test';

/**
 * Lesson 3.3 — Route guard smoke tests.
 *
 * Covers ONLY the unauthenticated branches because that's what we can
 * exercise without standing up a real Supabase session in CI:
 *
 *   1. Visiting any route inside (app) while signed-out gets bounced
 *      to /sign-in with `?next=` set to the original path.
 *   2. The `?next=` value survives the round-trip URL-encoded.
 *
 * The INVERSE branch (already-signed-in visitor → /dashboard) is
 * verified by hand right now. A reusable `signedInPage` fixture lands
 * in Lesson 12.x (E2E hardening) and we'll add coverage there.
 */

test('signed-out visitor to /dashboard is sent to /sign-in?next=/dashboard', async ({ page }) => {
	const response = await page.goto('/dashboard');

	// We don't assert on response.status() — Playwright follows the
	// 303 transparently. The user-visible URL after the redirect
	// chain is what matters.
	await expect(page).toHaveURL('/sign-in?next=%2Fdashboard');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');

	// The response (post-follow) is the sign-in page render. 200 OK
	// confirms we landed on a real page, not a chained redirect loop.
	expect(response?.status()).toBe(200);
});

test('signed-in (auth) routes redirect-when-signed-in is omitted', async () => {
	// Inverse-guard coverage — visiting /sign-in with an existing
	// session must redirect to /dashboard — requires a real signed-in
	// session fixture, which lands in Lesson 12.x. Tracked there;
	// kept here as documentation for the next reader.
});
