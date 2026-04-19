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
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

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
		if (dbError.code === 'PGRST116') throw error(404, 'Contact not found');
		console.error('[contact load] query failed:', dbError);
		throw error(500, 'Could not load this contact.');
	}

	return { contact };
};
