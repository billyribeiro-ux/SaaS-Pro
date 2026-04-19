/**
 * "Check your email" landing for magic-link sign-in.
 *
 * Identical pattern to /sign-up/check-email — read the email out of
 * the query string for display. We never echo arbitrary user content
 * onto the page without HTML-escaping; SvelteKit's `{value}` mustache
 * is already auto-escaping so a malicious `?email=<script>...` is
 * inert.
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	return { email: url.searchParams.get('email') ?? '' };
};
