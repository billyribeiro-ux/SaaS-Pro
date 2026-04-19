import { expect, test } from '@playwright/test';

test('home page greets the visitor and lists course milestones', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Contactly.');
	await expect(page.getByRole('heading', { level: 2 })).toHaveText('What lands when');
	await expect(page.locator('main ol li')).toHaveCount(5);
});
