import { expect, test } from '@playwright/test';

/**
 * Lesson 3.2 — User Login smoke tests.
 *
 * Same constraint as the sign-up suite: we exercise the FORM PLUMBING
 * without hitting Supabase. Anything that would require a real session
 * cookie (verifying a successful sign-in lands on /dashboard) is left
 * to the manual smoke + the integration suite that ships with the
 * Module 3 wrap-up.
 *
 * What we DO verify here:
 *   - The /sign-in page renders both the password and magic-link
 *     sub-forms, with the password tab selected by default.
 *   - The tab buttons swap which form is mounted.
 *   - Email typed in one mode persists across the toggle (the
 *     `sharedEmail` $state hookup).
 *   - Client-side schema validation runs on each form independently.
 *   - The magic-link check-email landing exists at
 *     /sign-in/check-email and echoes the email from the query string.
 */

test('marketing nav exposes a Sign-in link when signed out', async ({ page }) => {
	await page.goto('/');
	// Scope to the primary nav — the marketing landing also has a
	// secondary "Sign in" CTA in the body, so the unscoped role-link
	// query is intentionally ambiguous (Playwright strict-mode catches it).
	await page
		.getByRole('navigation', { name: /primary/i })
		.getByRole('link', { name: /^sign in$/i })
		.click();
	await expect(page).toHaveURL('/sign-in');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');
});

test('sign-in page defaults to the password tab', async ({ page }) => {
	await page.goto('/sign-in');
	await expect(page.getByTestId('tab-password')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('tab-magic')).toHaveAttribute('aria-selected', 'false');
	await expect(page.getByTestId('sign-in-password-form')).toBeVisible();
});

test('toggling to magic-link tab unmounts password form', async ({ page }) => {
	await page.goto('/sign-in');
	await page.getByTestId('tab-magic').click();
	await expect(page.getByTestId('tab-magic')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('sign-in-magic-form')).toBeVisible();
	await expect(page.getByTestId('sign-in-password-form')).toHaveCount(0);
});

test('email persists when switching tabs', async ({ page }) => {
	await page.goto('/sign-in');
	await page
		.getByTestId('sign-in-password-form')
		.locator('input[name="email"]')
		.fill('alice@example.com');
	await page.getByTestId('tab-magic').click();
	await expect(page.getByTestId('sign-in-magic-form').locator('input[name="email"]')).toHaveValue(
		'alice@example.com'
	);
});

test('password form requires both email and password client-side', async ({ page }) => {
	await page.goto('/sign-in');

	// `noValidate` on the form? No — we rely on Superforms' Zod check
	// running before the browser-native required check. Browsers will
	// also block submission of a `required` empty input, but we're
	// asserting the Zod-driven message, so we type a placeholder
	// email and an empty password to drive the schema branch.
	await page
		.getByTestId('sign-in-password-form')
		.locator('input[name="email"]')
		.fill('alice@example.com');
	// Override the browser's `required` blocker so we can verify the
	// Superforms-level message, not the browser tooltip.
	await page
		.getByTestId('sign-in-password-form')
		.locator('input[name="password"]')
		.evaluate((el: HTMLInputElement) => el.removeAttribute('required'));
	await page
		.getByTestId('sign-in-password-form')
		.getByRole('button', { name: /sign in/i })
		.click();

	await expect(page.getByText('Password is required')).toBeVisible();
});

test('magic-link form rejects malformed email client-side', async ({ page }) => {
	await page.goto('/sign-in');
	await page.getByTestId('tab-magic').click();

	await page.getByTestId('sign-in-magic-form').locator('input[name="email"]').fill('not-an-email');
	// Bypass the browser-native `type=email` block so the Superforms
	// schema message (not the browser tooltip) is what surfaces.
	await page
		.getByTestId('sign-in-magic-form')
		.locator('input[name="email"]')
		.evaluate((el: HTMLInputElement) => (el.type = 'text'));
	await page
		.getByTestId('sign-in-magic-form')
		.getByRole('button', { name: /email me a sign-in link/i })
		.click();

	await expect(page.getByText(/valid email address/i)).toBeVisible();
});

test('magic-link check-email landing echoes email from query', async ({ page }) => {
	await page.goto('/sign-in/check-email?email=carol%40example.com');
	await expect(page.getByTestId('magic-check-email-body')).toContainText('carol@example.com');
});
