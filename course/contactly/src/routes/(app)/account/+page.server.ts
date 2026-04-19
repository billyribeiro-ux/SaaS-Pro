/**
 * Account page server load.
 *
 * First lesson where Contactly actually queries application data
 * (rather than just auth). The pattern we establish here gets reused
 * everywhere a server load reads from Postgres:
 *
 *   1. Auth is OWNED by the (app) layout guard. By the time we run,
 *      `parent().user` is non-null. We pull it once and use its `id`
 *      for the lookup — never trust a `?id=` from the URL.
 *
 *   2. Use `locals.supabase`, not the service-role client. RLS is
 *      what makes this safe: the SELECT policy on `public.profiles`
 *      from Lesson 1.4 is `(auth.uid() = id)`, so even if a future
 *      bug sent a different `id`, Postgres would return zero rows
 *      instead of leaking another user's data. RLS is the *backstop*,
 *      not the only check — defense in depth.
 *
 *   3. `.single()` makes "exactly one row" the success contract.
 *      Anything else — zero rows, two rows — surfaces as `error`.
 *      Compared to `.maybeSingle()` (which returns `null` for zero
 *      rows), `.single()` makes "the row should exist" explicit. If
 *      the `handle_new_user` trigger ever fails to fire, we get a
 *      LOUD 404 here instead of a silently-empty form.
 *
 *   4. Errors are `error(...)`-thrown, not returned. That triggers
 *      the framework error boundary (eventually +error.svelte) and
 *      keeps the load function's return type narrow.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { user } = await parent();

	const { data: profile, error: dbError } = await supabase
		.from('profiles')
		.select('id, email, full_name, avatar_url, created_at, updated_at')
		.eq('id', user.id)
		.single();

	if (dbError) {
		// PGRST116 = "Searched item was not found" (PostgREST's row
		// count violation). The handle_new_user trigger SHOULD have
		// inserted this row at signup; if it didn't, that's a data
		// integrity bug worth surfacing rather than silently masking.
		if (dbError.code === 'PGRST116') {
			throw error(404, 'Profile row not found. Sign out and back in to recreate.');
		}
		// Generic 500 for anything else (RLS denial would manifest as
		// PGRST116 too — RLS-rejected rows are invisible, not
		// authorization errors).
		console.error('[account/load] profile query failed:', dbError);
		throw error(500, 'Could not load your profile right now.');
	}

	return { profile };
};
