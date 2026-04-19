import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Only same-origin relative paths pass — rejects `//evil.com`, `/\evil.com`,
// and anything with a scheme. Protects against open-redirect via `?next=`.
function safeNext(next: string | null): string {
	if (!next) return '/dashboard';
	if (!next.startsWith('/')) return '/dashboard';
	if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
	return next;
}

// Already-authenticated users shouldn't see login/register forms.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		throw redirect(303, safeNext(url.searchParams.get('next')));
	}
	return {};
};
