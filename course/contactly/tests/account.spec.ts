import { expect, test } from '@playwright/test';

/**
 * Lesson 3.5 — Account page guard tests.
 *
 * The account page renders user-specific data, so the only thing
 * we can usefully assert without a real session is that the
 * (app)-layout guard from Lesson 3.3 covers the new route. Rendering
 * + database round-trip get full coverage in the manual smoke and
 * the Module 12.x integration suite (which will spin up a real
 * Supabase + a signed-in fixture).
 */

test('signed-out visitor to /account is bounced through ?next=', async ({ page }) => {
	await page.goto('/account');
	await expect(page).toHaveURL('/sign-in?next=%2Faccount');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');
});
