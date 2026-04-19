import { error, fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';

const updateContactSchema = z.object({
	first_name: z.string().trim().min(1, 'First name is required.').max(100),
	last_name: z.string().trim().min(1, 'Last name is required.').max(100),
	email: z.string().trim().email('Invalid email address.').optional().or(z.literal('')),
	phone: z.string().trim().max(50).optional().or(z.literal('')),
	company: z.string().trim().max(200).optional().or(z.literal(''))
});

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { data, error: queryError } = await locals.supabase
		.from('contacts')
		.select('id, first_name, last_name, email, phone, company, created_at, updated_at')
		.eq('id', params.id)
		.eq('user_id', user.id)
		.single();

	if (queryError || !data) error(404, 'Contact not found');
	return { contact: data };
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
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

		const parsed = updateContactSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid contact form.' });
		}

		const payload = parsed.data;
		const { error: updateError } = await locals.supabase
			.from('contacts')
			.update({
				first_name: payload.first_name,
				last_name: payload.last_name,
				email: payload.email || null,
				phone: payload.phone || null,
				company: payload.company || null
			})
			.eq('id', params.id)
			.eq('user_id', user.id);

		if (updateError) {
			console.error('[contacts] update failed:', updateError);
			return fail(500, { error: 'Failed to update contact. Please try again.' });
		}

		throw redirect(303, '/contacts');
	}
};
