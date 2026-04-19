import { error, fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions } from './$types';

const createContactSchema = z.object({
	first_name: z.string().trim().min(1, 'First name is required.').max(100),
	last_name: z.string().trim().min(1, 'Last name is required.').max(100),
	email: z.string().trim().email('Invalid email address.').optional().or(z.literal('')),
	phone: z.string().trim().max(50).optional().or(z.literal('')),
	company: z.string().trim().max(200).optional().or(z.literal(''))
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Unauthorized');

		const formData = await request.formData();
		const raw = {
			first_name: formData.get('first_name'),
			last_name: formData.get('last_name'),
			email: formData.get('email') || '',
			phone: formData.get('phone') || '',
			company: formData.get('company') || ''
		};

		const parsed = createContactSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Invalid contact form.',
				data: raw
			});
		}

		const payload = parsed.data;
		const { error: insertError } = await locals.supabase.from('contacts').insert({
			user_id: user.id,
			first_name: payload.first_name,
			last_name: payload.last_name,
			email: payload.email || null,
			phone: payload.phone || null,
			company: payload.company || null
		});

		if (insertError) {
			console.error('[contacts] create failed:', insertError);
			return fail(500, {
				error: 'Failed to create contact. Please try again.',
				data: raw
			});
		}

		throw redirect(303, '/contacts');
	}
};
