import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { PUBLIC_APP_URL } from '$env/static/public';

const registerSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8).max(200),
	fullName: z.string().min(1).max(120)
});

export const load: PageServerLoad = async ({ url }) => {
	return {
		lookupKey: url.searchParams.get('lookup_key')
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const parsed = registerSchema.safeParse({
			email: form.get('email'),
			password: form.get('password'),
			fullName: form.get('fullName')
		});

		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				fullName: String(form.get('fullName') ?? ''),
				error: 'Check your details. Password must be at least 8 characters.'
			});
		}

		const appUrl = PUBLIC_APP_URL || url.origin;
		const { error } = await locals.supabase.auth.signUp({
			email: parsed.data.email,
			password: parsed.data.password,
			options: {
				data: { full_name: parsed.data.fullName },
				emailRedirectTo: `${appUrl}/auth/callback`
			}
		});

		if (error) {
			return fail(400, {
				email: parsed.data.email,
				fullName: parsed.data.fullName,
				error: error.message
			});
		}

		throw redirect(303, '/dashboard');
	}
};
