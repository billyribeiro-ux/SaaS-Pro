/**
 * New-contact form — server load + action.
 *
 * SECURITY MODEL
 * --------------
 * Three things keep this safe:
 *
 *   1. Auth. The (app) layout guard from 3.3 already 303s anonymous
 *      visitors away. We can therefore *assume* `parent().user` is
 *      present below.
 *
 *   2. Org membership. We resolve `getCurrentOrganization` for the
 *      acting user; the user can never inject an `organization_id`
 *      from the form because we never read one — the action stamps
 *      the resolved id onto the row server-side.
 *
 *   3. RLS as defense-in-depth. Even if the two above ever regressed,
 *      the `contacts_insert_member` policy from 4.1 would refuse the
 *      insert (`with check (is_organization_member(organization_id))`).
 *      That's the belt to the suspenders above.
 */
import { fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { contactWriteSchema } from '$lib/schemas/contacts';
import { getCurrentOrganization } from '$lib/server/organizations';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const form = await superValidate(zod4(contactWriteSchema));
	return { form };
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		// Layout guard handles unauthed users at the navigation level,
		// but a direct POST (`fetch`/curl) bypasses navigation and
		// hits actions straight. Belt-and-suspenders 401-equivalent.
		if (!user) throw redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(contactWriteSchema));
		if (!form.valid) return fail(400, { form });

		const organization = await getCurrentOrganization(supabase, user);

		const { data: contact, error: insertError } = await supabase
			.from('contacts')
			.insert({
				organization_id: organization.id,
				created_by: user.id,
				full_name: form.data.full_name,
				email: form.data.email ?? null,
				phone: form.data.phone ?? null,
				company: form.data.company ?? null,
				job_title: form.data.job_title ?? null,
				notes: form.data.notes ?? null
			})
			.select('id')
			.single();

		if (insertError || !contact) {
			console.error('[contacts/new] insert failed:', insertError);
			// Surface a generic message to the user; the structured log
			// has the real cause for the operator.
			return message(
				form,
				{ type: 'error' as const, text: 'Could not save your contact. Please try again.' },
				{ status: 500 }
			);
		}

		// POST/Redirect/GET — refreshing the resulting page must NOT
		// re-submit the form. The list page is the canonical "after
		// create" destination; lesson 4.5 grows the contact-detail
		// page and we'll switch this to `/contacts/${contact.id}`
		// then.
		throw redirect(303, '/contacts?created=1');
	}
};
