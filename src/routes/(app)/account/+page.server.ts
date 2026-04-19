import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import { getSubscriptionTier } from '$utils/access';
import { SITE } from '$config/site.config';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const [tier, subRes, customerRes] = await Promise.all([
		getSubscriptionTier(user),
		supabaseAdmin
			.from('subscriptions')
			.select('id, status, current_period_end, cancel_at_period_end, trial_end')
			.eq('user_id', user.id)
			.order('current_period_end', { ascending: false })
			.limit(1)
			.maybeSingle(),
		supabaseAdmin.from('customers').select('stripe_customer_id').eq('id', user.id).maybeSingle()
	]);

	return {
		tier,
		subscription: subRes.data,
		hasStripeCustomer: Boolean(customerRes.data?.stripe_customer_id)
	};
};

export const actions: Actions = {
	signout: async ({ locals }) => {
		await locals.supabase.auth.signOut();
		throw redirect(303, '/');
	},

	portal: async ({ locals, url }) => {
		const user = locals.user;
		if (!user) throw redirect(303, '/login');

		const { data: customer } = await supabaseAdmin
			.from('customers')
			.select('stripe_customer_id')
			.eq('id', user.id)
			.maybeSingle();

		if (!customer?.stripe_customer_id) {
			return fail(400, { error: 'No Stripe customer on file. Subscribe first.' });
		}

		const appUrl = SITE.url || url.origin;
		const session = await stripe.billingPortal.sessions.create({
			customer: customer.stripe_customer_id,
			return_url: `${appUrl}/account`
		});

		throw redirect(303, session.url);
	}
};
