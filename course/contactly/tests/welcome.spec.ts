import { expect, test } from '@playwright/test';

test('home page greets the visitor and lists course milestones', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Contactly.');
	await expect(page.locator('main ol li')).toHaveCount(5);
});

test('auth wiring renders the unauthenticated state for a fresh visitor', async ({ page }) => {
	await page.goto('/');

	// Implicitly verifies the entire Module 2 stack: env validation
	// fired at boot, hooks.server.ts created the supabase client and
	// safeGetSession returned { session: null, user: null }, the root
	// +layout.server.ts surfaced that to the page, and the universal
	// +layout.ts hydrated without throwing. If any of those broke, the
	// page would 500 instead of getting here.
	await expect(page.getByTestId('auth-status')).toHaveText('Not signed in');
});
