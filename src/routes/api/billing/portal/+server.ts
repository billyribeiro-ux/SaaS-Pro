import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import { PUBLIC_APP_URL } from '$env/static/public';

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

	const appUrl = PUBLIC_APP_URL || url.origin;
	const session = await stripe.billingPortal.sessions.create({
		customer: customer.stripe_customer_id,
		return_url: `${appUrl}/account`
	});

	return json({ url: session.url });
};
