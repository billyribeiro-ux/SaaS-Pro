import { fail } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions } from './$types';
import { PUBLIC_APP_URL } from '$env/static/public';

const schema = z.object({ email: z.string().email() });

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const parsed = schema.safeParse({ email: form.get('email') });

		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				error: 'Enter a valid email.'
			});
		}

		const appUrl = PUBLIC_APP_URL || url.origin;
		const { error } = await locals.supabase.auth.resetPasswordForEmail(parsed.data.email, {
			redirectTo: `${appUrl}/auth/callback?next=/account`
		});

		if (error) {
			return fail(400, { email: parsed.data.email, error: error.message });
		}

		return { email: parsed.data.email, sent: true };
	}
};
