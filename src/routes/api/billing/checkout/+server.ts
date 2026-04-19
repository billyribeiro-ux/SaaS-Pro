import { error, json, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { RequestHandler } from './$types';
import { stripe } from '$server/stripe';
import { getOrCreateStripeCustomer } from '$server/billing/customers.service';
import {
	ALL_LOOKUP_KEYS,
	PRICING_LOOKUP_KEYS
} from '$config/pricing.config';
import { PUBLIC_APP_URL } from '$env/static/public';

const bodySchema = z.object({
	lookupKey: z.enum([
		PRICING_LOOKUP_KEYS.monthly,
		PRICING_LOOKUP_KEYS.yearly,
		PRICING_LOOKUP_KEYS.lifetime
	])
});

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');

	const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) {
		throw error(400, `Invalid body. lookupKey must be one of: ${ALL_LOOKUP_KEYS.join(', ')}`);
	}

	const prices = await stripe.prices.list({
		lookup_keys: [parsed.data.lookupKey],
		expand: ['data.product'],
		active: true,
		limit: 1
	});
	const price = prices.data[0];
	if (!price) throw error(500, 'Price not found in Stripe.');

	const customerId = await getOrCreateStripeCustomer({
		userId: user.id,
		email: user.email ?? '',
		fullName: user.user_metadata?.full_name ?? null
	});

	const appUrl = PUBLIC_APP_URL || url.origin;
	const mode: 'subscription' | 'payment' = price.type === 'recurring' ? 'subscription' : 'payment';

	const session = await stripe.checkout.sessions.create({
		mode,
		customer: customerId,
		line_items: [{ price: price.id, quantity: 1 }],
		success_url: `${appUrl}/dashboard?checkout=success`,
		cancel_url: `${appUrl}/pricing?checkout=cancelled`,
		allow_promotion_codes: true,
		...(mode === 'subscription'
			? { subscription_data: { metadata: { supabase_user_id: user.id } } }
			: { payment_intent_data: { metadata: { supabase_user_id: user.id } } })
	});

	if (!session.url) throw error(500, 'Stripe did not return a checkout URL.');
	return json({ url: session.url });
};
