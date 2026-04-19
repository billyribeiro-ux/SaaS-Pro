/**
 * Contacts list — server load.
 *
 * Server-side search + pagination. Doing both in the load function
 * (rather than client-side filtering) is the only honest answer once
 * a workspace might have 10k+ contacts: shipping every row to the
 * browser to filter client-side breaks the second a user pastes
 * their CRM export.
 *
 * URL is the source of truth for view state:
 *   ?q=<search>   — case-insensitive name/company/email match
 *   ?page=<n>     — 1-indexed; clamped server-side
 *
 * That keeps "share this filtered list" working, makes back/forward
 * behave correctly, and means we never have to write a useEffect
 * to keep state and URL in sync.
 */
import type { PageServerLoad } from './$types';
import { getCurrentOrganization } from '$lib/server/organizations';

const PAGE_SIZE = 25;

/**
 * Postgres pattern-match safety: the user's `q` lands inside an
 * `ilike` pattern, where `%` and `_` are wildcards. If the user
 * searches for "100%", we don't want that to match every row in the
 * table. Escape both of them, plus the backslash itself.
 *
 * Note: we use `\` as the escape char, which is Postgres's default
 * for `like` / `ilike`.
 */
function escapeIlikePattern(input: string): string {
	return input.replace(/[\\%_]/g, '\\$&');
}

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
	const { user } = await parent();
	const organization = await getCurrentOrganization(supabase, user);

	const rawQuery = url.searchParams.get('q')?.trim() ?? '';
	const query = rawQuery.slice(0, 100); // hard cap — no need to query for a 5KB string
	const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

	const from = (page - 1) * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;

	let request = supabase
		.from('contacts')
		.select('id, full_name, email, phone, company, job_title, created_at', { count: 'exact' })
		.eq('organization_id', organization.id)
		.order('created_at', { ascending: false })
		.range(from, to);

	if (query.length > 0) {
		const pattern = `%${escapeIlikePattern(query)}%`;
		// PostgREST `or()` with comma-separated filter expressions.
		// We match against the three text columns a user is most
		// likely to recall by — name, company, email.
		request = request.or(
			`full_name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`
		);
	}

	const { data: contacts, count, error: dbError } = await request;

	if (dbError) {
		console.error('[contacts list] query failed:', dbError);
		// Soft-fail: empty list, no count, no exception. The page
		// still renders with a "couldn't load" banner. We don't 500
		// because a flaky DB call shouldn't block the user from
		// clicking "New contact" or signing out.
		return {
			organization,
			contacts: [],
			contactCount: null as number | null,
			query,
			page,
			pageSize: PAGE_SIZE,
			totalPages: 1,
			loadError: true
		};
	}

	const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

	return {
		organization,
		contacts: contacts ?? [],
		contactCount: count ?? 0,
		query,
		page,
		pageSize: PAGE_SIZE,
		totalPages,
		loadError: false
	};
};
