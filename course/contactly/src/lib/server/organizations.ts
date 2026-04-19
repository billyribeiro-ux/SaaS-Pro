/**
 * Server-side organization helpers.
 *
 * Lives under `$lib/server/` so it cannot be imported by browser code
 * (uses the request-scoped `locals.supabase` and the service-role
 * client; both must stay server-side).
 *
 * The "current organization" model right now: each user has exactly
 * one personal organization (the one `handle_new_user` created at
 * signup), and we use that for every CRUD action. When teams land in
 * Module 13, the picker stores the active org id in a cookie and
 * `getCurrentOrganization` swaps to read from there with a fallback
 * to the personal org. The function signature is designed to absorb
 * that change without callers caring.
 */
import { error } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

export type Organization = Database['public']['Tables']['organizations']['Row'];

/**
 * Resolve the current user's active organization for this request.
 *
 * Strategy v1: pick their first membership ordered by `created_at`,
 * which by construction is the personal org (created in the same
 * trigger that created their profile). When the team-picker lands
 * in Module 13, this is the one place that needs to grow a
 * cookie-read branch.
 *
 * Throws a 500 if the user has zero memberships — that's a data
 * integrity bug (the trigger should have created at least one), and
 * we want it loud, not silently rendered as an empty contacts list.
 */
export async function getCurrentOrganization(
	supabase: SupabaseClient<Database>,
	user: User
): Promise<Organization> {
	// Two-step: read the membership row to get the org id, then read
	// the org. We could collapse it with `.select('organization_id,
	// organization:organizations(*)')` and a foreign-table embed, but
	// the two reads are each O(index lookup) and the explicit shape
	// keeps the policy story readable.
	const { data: membership, error: membershipError } = await supabase
		.from('organization_members')
		.select('organization_id')
		.eq('user_id', user.id)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (membershipError) {
		console.error('[getCurrentOrganization] membership query failed:', membershipError);
		error(500, 'Could not load your workspace.');
	}

	if (!membership) {
		// The handle_new_user trigger should have created the personal
		// org membership at signup. Missing here = an account that was
		// inserted into auth.users without the trigger running (rare;
		// happens in legacy data migrations or if the trigger was
		// disabled during a maintenance window). Loud failure beats
		// silent "no contacts".
		console.error('[getCurrentOrganization] user has no memberships:', user.id);
		error(500, 'Your account has no workspace. Contact support.');
	}

	const { data: org, error: orgError } = await supabase
		.from('organizations')
		.select('*')
		.eq('id', membership.organization_id)
		.single();

	if (orgError || !org) {
		console.error('[getCurrentOrganization] org query failed:', orgError);
		error(500, 'Could not load your workspace.');
	}

	return org;
}
