import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { data, error: queryError } = await locals.supabase
		.from('contacts')
		.select('id, first_name, last_name, email, phone, company, created_at, updated_at')
		.order('last_name', { ascending: true })
		.order('first_name', { ascending: true });

	if (queryError) {
		console.error('[contacts] load failed:', queryError);
		error(500, 'Failed to load contacts');
	}

	return {
		contacts: data ?? []
	};
};

export const actions: Actions = {
	deleteContact: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Unauthorized');

		const formData = await request.formData();
		const id = formData.get('id');
		if (!id || typeof id !== 'string') {
			return fail(400, { error: 'Contact ID is required.' });
		}

		const { error: deleteError } = await locals.supabase
			.from('contacts')
			.delete()
			.eq('id', id)
			.eq('user_id', user.id);

		if (deleteError) {
			console.error('[contacts] delete failed:', deleteError);
			return fail(500, { error: 'Failed to delete contact. Please try again.' });
		}

		return { success: true };
	}
};
