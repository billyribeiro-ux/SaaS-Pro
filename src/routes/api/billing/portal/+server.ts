import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import { SITE } from '$config/site.config';

export const POST: RequestHandler = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');

	const { data: customer } = await supabaseAdmin
		.from('customers')
		.select('stripe_customer_id')
		.eq('id', user.id)
		.maybeSingle();

	if (!customer?.stripe_customer_id) {
		throw error(400, 'No Stripe customer on file.');
	}

	const appUrl = SITE.url || url.origin;
	const session = await stripe.billingPortal.sessions.create({
		customer: customer.stripe_customer_id,
		return_url: `${appUrl}/account`
	});

	return json({ url: session.url });
};
