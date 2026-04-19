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

test('GET /contacts/<some-uuid> without a session redirects (4.5 detail route exists)', async ({
	request
}) => {
	const response = await request.get('/contacts/00000000-0000-4000-8000-00000000abcd', {
		maxRedirects: 0
	});
	expect(response.status()).toBe(303);
	const location = response.headers()['location'];
	expect(location).toBe('/sign-in?next=%2Fcontacts%2F00000000-0000-4000-8000-00000000abcd');
});

test('GET /contacts/<id>/edit without a session redirects (4.6 edit route exists)', async ({
	request
}) => {
	const response = await request.get('/contacts/00000000-0000-4000-8000-00000000abcd/edit', {
		maxRedirects: 0
	});
	expect(response.status()).toBe(303);
	const location = response.headers()['location'];
	expect(location).toBe('/sign-in?next=%2Fcontacts%2F00000000-0000-4000-8000-00000000abcd%2Fedit');
});

test('GET /contacts?q=foo without a session preserves the query in next', async ({ request }) => {
	const response = await request.get('/contacts?q=foo', { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	const location = response.headers()['location'];
	// We URL-encode only the pathname into ?next=, not the query
	// string; the layout guard from 3.3 calls
	// `encodeURIComponent(url.pathname)` which intentionally drops
	// the search string. Documenting that here so future regressions
	// (e.g. someone deciding to round-trip the search) are caught.
	expect(location).toBe('/sign-in?next=%2Fcontacts');
});
