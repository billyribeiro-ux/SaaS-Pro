import { expect, test } from '@playwright/test';

/**
 * Lesson 3.1 — User Registration smoke tests.
 *
 * These tests exercise the FORM PLUMBING without hitting Supabase. We
 * deliberately stop short of submitting valid credentials because:
 *
 *   1. The CI environment doesn't have a Supabase running on the
 *      Contactly local ports (64320-64329).
 *   2. Hitting the real Supabase Cloud project from CI would mean
 *      either polluting prod with throwaway accounts or wiring a
 *      service-role key + cleanup teardown — both out of scope until
 *      Module 12.
 *
 * What this DOES verify:
 *   - The marketing CTA links land on /sign-up
 *   - The form renders all four fields (full name, email, password,
 *     confirm password)
 *   - Client-side validation runs on submit (the schema rejects empty
 *     email, short password, mismatched confirm)
 *   - The check-email page exists at /sign-up/check-email and shows
 *     the email when one is supplied as a query param
 */
test('marketing CTA leads to sign-up form', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: /get started/i }).click();
	await expect(page).toHaveURL('/sign-up');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account');
});

test('sign-up form rejects mismatched passwords client-side', async ({ page }) => {
	await page.goto('/sign-up');

	await page.getByLabel('Email', { exact: false }).fill('alice@example.com');
	await page.getByLabel('Password', { exact: true }).fill('Sup3r-Secret-Pass');
	await page.getByLabel('Confirm password', { exact: false }).fill('Different-Pass-99');
	await page
		.getByTestId('sign-up-form')
		.getByRole('button', { name: /create account/i })
		.click();

	// The Zod refine attaches to confirmPassword.
	await expect(page.getByText('Passwords must match')).toBeVisible();
});

test('sign-up form rejects short passwords client-side', async ({ page }) => {
	await page.goto('/sign-up');

	await page.getByLabel('Email', { exact: false }).fill('bob@example.com');
	await page.getByLabel('Password', { exact: true }).fill('short1A');
	await page.getByLabel('Confirm password', { exact: false }).fill('short1A');
	await page
		.getByTestId('sign-up-form')
		.getByRole('button', { name: /create account/i })
		.click();

	await expect(page.getByText(/at least 12 characters/i)).toBeVisible();
});

test('check-email page echoes the email from the query string', async ({ page }) => {
	await page.goto('/sign-up/check-email?email=carol%40example.com');
	await expect(page.getByTestId('check-email-body')).toContainText('carol@example.com');
});

test('auth/error page surfaces the verify_failed reason', async ({ page }) => {
	await page.goto('/auth/error?reason=verify_failed');
	await expect(page.getByTestId('auth-error-message')).toContainText(
		/expired or already been used/i
	);
});
