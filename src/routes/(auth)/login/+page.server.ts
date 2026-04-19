import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8).max(200)
});

export const load: PageServerLoad = async ({ url }) => {
	return {
		next: url.searchParams.get('next') ?? '/dashboard',
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

		const next = url.searchParams.get('next');
		throw redirect(303, next && next.startsWith('/') ? next : '/dashboard');
	}
};
