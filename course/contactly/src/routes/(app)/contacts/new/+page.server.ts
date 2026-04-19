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
 *
 * BILLING GATE (Lesson 8.5)
 * -------------------------
 * Starter tier caps a workspace at `CONTACT_CAP.starter` contacts.
 * The gate runs in the action **immediately before the insert**, not
 * in the load: a stale browser tab can sit on a "you have room"
 * load result for hours, so the load decides what to *show* and
 * the action decides what to *allow*.
 *
 * We surface refusals as `fail(402, ...)` (HTTP 402 Payment Required
 * is the appropriate signal for "your billing tier disallows this").
 * The form swallows it via SvelteKit's superforms `message`, so the
 * UX path is "submit → inline upgrade banner" instead of an error
 * toast or a hard redirect.
 *
 * Unknown-state failures (count query erroring) are mapped to
 * `fail(503, ...)` with a generic message; we DO NOT fall back to
 * "allowed" — that would let a database hiccup grant unpaid
 * resources, which is the entire failure mode this gate exists to
 * prevent.
 */
import { fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { contactWriteSchema } from '$lib/schemas/contacts';
import { getCurrentOrganization } from '$lib/server/organizations';
import { checkContactCap } from '$lib/server/billing/contact-cap';
import { loadEntitlements } from '$lib/server/billing/entitlements';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { user, entitlements } = await parent();
	const form = await superValidate(zod4(contactWriteSchema));

	// Pre-flight cap check so we can disable the form (and show the
	// upgrade prompt) before the user has typed anything. Only
	// relevant for Starter — paid tiers are unlimited and the
	// cheapest count query is no count query.
	const capStatus =
		entitlements.tier === 'starter'
			? await checkContactCap({
					supabase,
					organizationId: (await getCurrentOrganization(supabase, user)).id,
					tier: 'starter'
				})
			: null;

	return { form, capStatus };
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		// Layout guard handles unauthed users at the navigation level,
		// but a direct POST (`fetch`/curl) bypasses navigation and
		// hits actions straight. Belt-and-suspenders 401-equivalent.
		if (!user) redirect(303, '/sign-in');

		const form = await superValidate(request, zod4(contactWriteSchema));
		if (!form.valid) return fail(400, { form });

		const organization = await getCurrentOrganization(supabase, user);

		// === Billing gate ===
		// We re-resolve the tier server-side via `loadEntitlements`
		// rather than trusting `parent().entitlements` — an action
		// cannot read parent loads, and even if it could, the gate
		// must be authoritative against the live DB, not a value
		// that could have been computed minutes ago in a different
		// tab. The cap module owns "what is allowed"; we own "what
		// to do about a refusal."
		const entitlements = await loadEntitlements(user.id);
		const decision = await checkContactCap({
			supabase,
			organizationId: organization.id,
			tier: entitlements.tier
		});

		if (!decision.allowed) {
			if (decision.reason === 'cap_reached') {
				return message(
					form,
					{
						type: 'error' as const,
						code: 'cap_reached' as const,
						text: `Your Starter plan is capped at ${decision.limit} contacts. Upgrade to Pro to add more.`,
						limit: decision.limit,
						used: decision.used
					},
					{ status: 402 }
				);
			}
			return message(
				form,
				{
					type: 'error' as const,
					code: 'cap_unknown' as const,
					text: 'Could not verify your plan limits right now. Please try again.'
				},
				{ status: 503 }
			);
		}

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
		redirect(303, '/contacts?created=1');
	}
};
