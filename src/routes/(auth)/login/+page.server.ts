import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8).max(200)
});

// Rejects protocol-relative (`//evil.com`) and backslash-tricks (`/\evil.com`)
// as well as anything with a scheme. Keep in sync with (auth)/+layout.server.ts.
function safeNext(next: string | null): string {
	if (!next) return '/dashboard';
	if (!next.startsWith('/')) return '/dashboard';
	if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
	return next;
}

export const load: PageServerLoad = async ({ url }) => {
	return {
		next: safeNext(url.searchParams.get('next')),
		errorHint: url.searchParams.get('error')
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const parsed = loginSchema.safeParse({
			email: form.get('email'),
			password: form.get('password')
		});

		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				error: 'Enter a valid email and a password of at least 8 characters.'
			});
		}

		const { error } = await locals.supabase.auth.signInWithPassword(parsed.data);
		if (error) {
			return fail(401, { email: parsed.data.email, error: error.message });
		}

		throw redirect(303, safeNext(url.searchParams.get('next')));
	}
};
