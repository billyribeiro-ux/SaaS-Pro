/**
 * Account page — load + form actions (Lessons 3.5 + 3.6).
 *
 * Five named actions live here, each backed by its own Superforms
 * instance and Zod schema. The page renders all five forms; the user
 * picks one. Server actions never see the others' fields.
 *
 *   ?/update_profile   → public.profiles.update (full_name)
 *   ?/change_email     → auth.updateUser({ email }) → confirm link
 *   ?/change_password  → auth.updateUser({ password })
 *   ?/delete_account   → auth.admin.deleteUser (service-role)
 *
 * The forgot/reset password flow lives at /forgot-password and
 * /reset-password — those are reachable BEFORE sign-in too, so
 * they can't live here.
 *
 * Why one server file per route, not one per action?
 *   SvelteKit form actions naturally cluster on the route they post
 *   to. Splitting them across files would force us to re-implement
 *   the same auth + load context plumbing in each.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import {
	changeEmailSchema,
	changePasswordSchema,
	deleteAccountSchema,
	updateProfileSchema
} from '$lib/schemas/auth';
import { withAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { user } = await parent();

	const { data: profile, error: dbError } = await supabase
		.from('profiles')
		.select('id, email, full_name, avatar_url, created_at, updated_at')
		.eq('id', user.id)
		.single();

	if (dbError) {
		if (dbError.code === 'PGRST116') {
			throw error(404, 'Profile row not found. Sign out and back in to recreate.');
		}
		console.error('[account/load] profile query failed:', dbError);
		throw error(500, 'Could not load your profile right now.');
	}

	// Each Superforms instance is `id`-scoped so the page can mount
	// all four forms simultaneously without their `$form`/`$errors`
	// stores stomping each other. The `id` value also becomes the
	// form's data-sf-id attribute, which is what use:enhance reads
	// to know which response to bind back to which form.
	const [updateProfileForm, changeEmailForm, changePasswordForm, deleteAccountForm] =
		await Promise.all([
			superValidate({ fullName: profile.full_name ?? undefined }, zod4(updateProfileSchema), {
				id: 'update_profile'
			}),
			superValidate(zod4(changeEmailSchema), { id: 'change_email' }),
			superValidate(zod4(changePasswordSchema), { id: 'change_password' }),
			superValidate(zod4(deleteAccountSchema), { id: 'delete_account' })
		]);

	return {
		profile,
		updateProfileForm,
		changeEmailForm,
		changePasswordForm,
		deleteAccountForm
	};
};

export const actions: Actions = {
	update_profile: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(updateProfileSchema), { id: 'update_profile' });
		if (!form.valid) return fail(400, { updateProfileForm: form });

		const { error: dbError } = await supabase
			.from('profiles')
			.update({ full_name: form.data.fullName ?? null })
			.eq('id', user.id);

		if (dbError) {
			console.error('[account/update_profile] update failed:', dbError);
			return setError(form, '', 'Could not save your profile. Please try again.');
		}

		// Superforms convention: return the form (now with the saved
		// values) and a success message that the UI surfaces in the
		// flash region. We DON'T redirect — the page is the
		// destination already and a redirect would scroll the user to
		// the top, away from the section they just edited.
		return { updateProfileForm: { ...form, message: 'Profile saved.' } };
	},

	change_email: async ({ request, locals: { supabase, safeGetSession }, url }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(changeEmailSchema), { id: 'change_email' });
		if (!form.valid) return fail(400, { changeEmailForm: form });

		if (form.data.email === user.email) {
			return setError(form, 'email', "That's already your current email.");
		}

		// Supabase sends a confirmation link to the NEW address. The
		// account email doesn't actually flip until the user clicks
		// it. `emailRedirectTo` controls where the link lands — same
		// /auth/confirm endpoint as sign-up, with `next=/account` so
		// the user ends up looking at the confirmed change.
		const { error: authError } = await supabase.auth.updateUser(
			{ email: form.data.email },
			{ emailRedirectTo: `${url.origin}/auth/confirm?next=${encodeURIComponent('/account')}` }
		);

		if (authError) {
			if (/already (registered|been taken)/i.test(authError.message)) {
				return setError(form, 'email', 'That email is already in use.');
			}
			return setError(form, '', authError.message);
		}

		return {
			changeEmailForm: {
				...form,
				message: `Check ${form.data.email} for a confirmation link to finish the change.`
			}
		};
	},

	change_password: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(changePasswordSchema), {
			id: 'change_password'
		});
		if (!form.valid) return fail(400, { changePasswordForm: form });

		const { error: authError } = await supabase.auth.updateUser({
			password: form.data.password
		});

		if (authError) {
			return setError(form, '', authError.message);
		}

		// Clear the input fields so a back-button refresh doesn't
		// re-display the just-changed password in the DOM.
		form.data.password = '';
		form.data.confirmPassword = '';
		return {
			changePasswordForm: { ...form, message: 'Password updated.' }
		};
	},

	delete_account: async ({ request, locals: { supabase, safeGetSession }, cookies }) => {
		const { user } = await safeGetSession();
		if (!user) throw redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(deleteAccountSchema), {
			id: 'delete_account'
		});
		if (!form.valid) return fail(400, { deleteAccountForm: form });

		// Service-role hop. We've gated by:
		//   1. The (app) layout guard ran (signed-in only).
		//   2. We re-derived `user` from `safeGetSession()` not the
		//      form body — the request body never names a user id.
		//   3. The schema required the literal "DELETE" string.
		// Only AFTER all three are satisfied do we reach for the
		// privileged client. `withAdmin` wraps the call in audit log
		// lines (Lesson 4.4 pattern) so we always know who did this.
		const { error: deleteError } = await withAdmin('account.delete', user, (admin) =>
			admin.auth.admin.deleteUser(user.id)
		);

		if (deleteError) {
			console.error('[account/delete_account] admin delete failed:', deleteError);
			return setError(form, '', 'Could not delete your account. Please contact support.');
		}

		// Local sign-out to clear THIS browser's cookies. Other
		// devices' sessions die when their access tokens fail to
		// refresh against the now-deleted user.
		await supabase.auth.signOut({ scope: 'local' });

		// Belt-and-braces: scrub auth cookies even if signOut missed
		// any. The `sb-` prefix is Supabase's namespace; we check by
		// prefix so a future cookie name change doesn't silently leak.
		for (const { name } of cookies.getAll()) {
			if (name.startsWith('sb-')) cookies.delete(name, { path: '/' });
		}

		throw redirect(303, '/?deleted=1');
	}
};
