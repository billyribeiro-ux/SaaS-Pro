/**
 * Single contact — server load.
 *
 * Lesson 4.5 ships the read-only detail view; lessons 4.6 and 4.7
 * graft the edit and delete actions onto this same file.
 *
 * Two RLS observations make this load function safe with no extra
 * checks:
 *
 *   1. We don't pass `organization_id` to the query. We don't have to:
 *      `contacts_select_member` from the migration only returns rows
 *      whose org the caller is a member of.
 *
 *   2. A contact id from another org becomes a 404, not a 403,
 *      because RLS just hides the row — `single()` errors with
 *      PGRST116 ("the result contains 0 rows"). 404 is also the
 *      correct external response: telling an attacker "yes this id
 *      exists, but not for you" leaks the existence of other tenants'
 *      data. Always 404.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: contact, error: dbError } = await supabase
		.from('contacts')
		.select(
			'id, organization_id, full_name, email, phone, company, job_title, notes, created_at, updated_at, created_by'
		)
		.eq('id', params.id)
		.single();

	if (dbError) {
		// PGRST116 = "no rows returned". Either the id doesn't exist
		// or RLS hid it. Either way the public-facing answer is 404.
		if (dbError.code === 'PGRST116') error(404, 'Contact not found');
		console.error('[contact load] query failed:', dbError);
		error(500, 'Could not load this contact.');
	}

	return { contact };
};

export const actions: Actions = {
	/**
	 * Delete this contact.
	 *
	 * No service-role hop needed: the `contacts_delete_member` RLS
	 * policy from 4.1 lets a member delete rows in their own org and
	 * silently denies anything else. The action runs under the
	 * caller's session, exactly as INSERT/UPDATE do.
	 *
	 * We sanity-check the affected-row count anyway. RLS-blocked
	 * deletes return success with 0 rows affected (no error,
	 * literally nothing happened) — distinguishing that from "row
	 * gone before we got there" matters for the user-facing message
	 * AND for not pretending we deleted something we couldn't touch.
	 */
	delete: async ({ params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) redirect(303, '/sign-in');

		const { error: deleteError, count } = await supabase
			.from('contacts')
			.delete({ count: 'exact' })
			.eq('id', params.id);

		if (deleteError) {
			console.error('[contact delete] failed:', deleteError);
			return fail(500, { deleteError: 'Could not delete this contact. Please try again.' });
		}

		if (count === 0) {
			// Either RLS blocked us (we don't belong to this row's org)
			// or the row vanished between page load and form submit.
			// Both surface the same way to the user — 404. We don't
			// distinguish, because a "you can't touch this" message
			// would leak that the row exists.
			error(404, 'Contact not found');
		}

		redirect(303, '/contacts?deleted=1');
	}
};
