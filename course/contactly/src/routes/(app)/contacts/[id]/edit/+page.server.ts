/**
 * Edit-contact page — load + form action.
 *
 * Re-uses the `contactWriteSchema` from 4.3 (one schema, both
 * verbs). The load function pre-populates the Superforms instance
 * from the existing row so the user sees their actual values, not
 * empty fields.
 *
 * RLS reminder: we never pass `organization_id` to the queries below.
 * The contacts_select_member / contacts_update_member policies from
 * 4.1 do the access check. A request to edit another tenant's
 * contact 404s on load (the SELECT returns no rows) — the UPDATE
 * never even runs.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { contactWriteSchema } from '$lib/schemas/contacts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: contact, error: dbError } = await supabase
		.from('contacts')
		.select('id, full_name, email, phone, company, job_title, notes')
		.eq('id', params.id)
		.single();

	if (dbError) {
		if (dbError.code === 'PGRST116') throw error(404, 'Contact not found');
		console.error('[contact edit load] query failed:', dbError);
		throw error(500, 'Could not load this contact.');
	}

	// Hydrate the form with the existing values. Anything that's NULL
	// in the DB becomes `undefined` here so the optional-trim
	// preprocessor in the schema treats it the same as a blank field.
	const form = await superValidate(
		{
			full_name: contact.full_name,
			email: contact.email ?? undefined,
			phone: contact.phone ?? undefined,
			company: contact.company ?? undefined,
			job_title: contact.job_title ?? undefined,
			notes: contact.notes ?? undefined
		},
		zod4(contactWriteSchema)
	);

	return { contact, form };
};

export const actions: Actions = {
	default: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(contactWriteSchema));
		if (!form.valid) return fail(400, { form });

		const { error: updateError } = await supabase
			.from('contacts')
			.update({
				full_name: form.data.full_name,
				email: form.data.email ?? null,
				phone: form.data.phone ?? null,
				company: form.data.company ?? null,
				job_title: form.data.job_title ?? null,
				notes: form.data.notes ?? null
			})
			.eq('id', params.id);

		if (updateError) {
			console.error('[contact edit] update failed:', updateError);
			return message(
				form,
				{ type: 'error' as const, text: 'Could not save your changes. Please try again.' },
				{ status: 500 }
			);
		}

		// Successful update lands the user back on the detail view —
		// the canonical "thing I just edited" page. POST/Redirect/GET
		// so refresh doesn't resubmit the form.
		throw redirect(303, `/contacts/${params.id}?saved=1`);
	}
};
