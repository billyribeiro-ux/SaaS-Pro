import { expect, test } from '@playwright/test';

/**
 * Lesson 3.6 — Account actions + recovery flow smoke tests.
 *
 * Same constraint: no real signed-in session in CI. We verify the
 * surfaces that DON'T require an authenticated request.
 *
 *   - /forgot-password renders + validates client-side
 *   - /forgot-password/check-email echoes the email
 *   - /reset-password without a session bounces to /forgot-password
 *
 * Authenticated round-trips (the four account-page actions) are
 * covered by the manual smoke + the Module 12.x suite.
 */

test('forgot-password page renders the email form', async ({ page }) => {
	await page.goto('/forgot-password');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Forgot your password?');
	await expect(page.getByTestId('forgot-password-form')).toBeVisible();
});

test('forgot-password rejects malformed email client-side', async ({ page }) => {
	await page.goto('/forgot-password');

	await page.locator('input[name="email"]').fill('not-an-email');
	await page.locator('input[name="email"]').evaluate((el: HTMLInputElement) => (el.type = 'text'));
	await page.getByTestId('forgot-password-form').getByRole('button').click();

	await expect(page.getByText(/valid email address/i)).toBeVisible();
});

test('forgot-password check-email echoes the email from the query string', async ({ page }) => {
	await page.goto('/forgot-password/check-email?email=dave%40example.com');
	await expect(page.getByTestId('forgot-check-email-body')).toContainText('dave@example.com');
});

test('reset-password without a session bounces to /forgot-password', async ({ page }) => {
	await page.goto('/reset-password');
	await expect(page).toHaveURL('/forgot-password');
});

test('signed-out visitor to /account redirects through ?next=', async ({ page }) => {
	await page.goto('/account');
	await expect(page).toHaveURL('/sign-in?next=%2Faccount');
});
