import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Same-origin-only guard. `next` arrives from the email link's query string,
// so treat it as untrusted — never let it redirect off-site.
function safeNext(next: string | null): string {
	if (!next) return '/dashboard';
	if (!next.startsWith('/')) return '/dashboard';
	if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
	return next;
}

// Supabase email-confirmation / magic-link callback.
// Users land here with `?code=...`; we exchange it for a session cookie.
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const next = safeNext(url.searchParams.get('next'));

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) throw redirect(303, next);
	}

	throw redirect(303, '/login?error=callback_failed');
};
