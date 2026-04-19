import { expect, test } from '@playwright/test';

/**
 * Lesson 4.3 — contacts route boundary checks.
 *
 * These tests deliberately don't sign in (we don't have a
 * programmatic auth helper yet — that lands in module 11). They
 * verify the layout guard from 3.3 covers the new contacts routes
 * and that the create-form route exists.
 */

test('GET /contacts without a session redirects to /sign-in?next=/contacts', async ({
	request
}) => {
	const response = await request.get('/contacts', { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	const location = response.headers()['location'];
	expect(location).toBe('/sign-in?next=%2Fcontacts');
});

test('GET /contacts/new without a session redirects to /sign-in?next=/contacts/new', async ({
	request
}) => {
	const response = await request.get('/contacts/new', { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	const location = response.headers()['location'];
	expect(location).toBe('/sign-in?next=%2Fcontacts%2Fnew');
});
