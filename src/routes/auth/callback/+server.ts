import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Supabase email-confirmation / magic-link callback.
// Users land here with `?code=...`; we exchange it for a session cookie.
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const next = url.searchParams.get('next') ?? '/dashboard';

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) throw redirect(303, next);
	}

	throw redirect(303, '/login?error=callback_failed');
};
