import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Same-origin-only guard. `next` is user-controlled, so never let it
// redirect off-site after the OAuth handshake completes.
function safeNext(next: string | null): string {
	if (!next) return '/dashboard';
	if (!next.startsWith('/')) return '/dashboard';
	if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
	return next;
}

// Kicks off Google OAuth. The login/register pages submit a plain
// <form method="POST" action="/auth/google">, so we ask Supabase for the
// provider URL and 303-redirect the browser to Google. After Google calls
// Supabase back, Supabase redirects to our `/auth/callback` route, which
// exchanges the code for a session and lands the user at `next`.
export const POST: RequestHandler = async ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	const redirectTo = `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`;

	const { data, error } = await locals.supabase.auth.signInWithOAuth({
		provider: 'google',
		options: { redirectTo, skipBrowserRedirect: true }
	});

	if (error || !data?.url) {
		throw redirect(303, '/login?error=oauth_failed');
	}

	throw redirect(303, data.url);
};
