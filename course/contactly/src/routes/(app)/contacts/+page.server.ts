/**
 * Contacts list — server load.
 *
 * Lesson 4.3 stub: returns just the count so we can confirm the
 * write path from `/contacts/new` actually persisted. Lesson 4.5
 * ("Reading Contacts") replaces this with the paginated, searchable
 * list of full rows.
 */
import type { PageServerLoad } from './$types';
import { getCurrentOrganization } from '$lib/server/organizations';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { user } = await parent();
	const organization = await getCurrentOrganization(supabase, user);

	const { count, error: countError } = await supabase
		.from('contacts')
		.select('id', { count: 'exact', head: true })
		.eq('organization_id', organization.id);

	if (countError) {
		console.error('[contacts list] count failed:', countError);
		// Don't 500 the page over a count — degrade to "unknown" so
		// the user can still click through to create their first
		// contact.
		return { organization, contactCount: null as number | null };
	}

	return { organization, contactCount: count ?? 0 };
};
