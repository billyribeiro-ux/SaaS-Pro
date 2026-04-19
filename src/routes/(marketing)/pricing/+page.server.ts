import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import { getOrCreateStripeCustomer } from '$server/billing/customers.service';
import {
	ALL_LOOKUP_KEYS,
	PRICING_LOOKUP_KEYS,
	PRICING_TIERS,
	tierForLookupKey,
	type PricingTier
} from '$config/pricing.config';
import { getSubscriptionTier } from '$utils/access';
import type { PriceWithProduct, ResolvedPricing } from '$types/billing.types';
import type { PriceInterval, PriceType } from '$types/database.types';
import { PUBLIC_APP_URL } from '$env/static/public';

const checkoutSchema = z.object({
	lookupKey: z.enum([
		PRICING_LOOKUP_KEYS.monthly,
		PRICING_LOOKUP_KEYS.yearly,
		PRICING_LOOKUP_KEYS.lifetime
	])
});

function byLookupKey(prices: PriceWithProduct[]): ResolvedPricing {
	const map: ResolvedPricing = { monthly: null, yearly: null, lifetime: null };
	for (const price of prices) {
		const tier = tierForLookupKey(price.lookup_key);
		if (tier) map[tier] = price;
	}
	return map;
}

async function loadLivePrices(): Promise<PriceWithProduct[]> {
	try {
		const result = await stripe.prices.list({
			lookup_keys: [...ALL_LOOKUP_KEYS],
			expand: ['data.product'],
			active: true
		});

		return result.data.map((price) => {
			const rawProduct = typeof price.product === 'string' ? null : price.product;
			const product = rawProduct && !('deleted' in rawProduct && rawProduct.deleted) ? rawProduct : null;
			return {
				id: price.id,
				product_id: product?.id ?? null,
				active: price.active,
				currency: price.currency,
				type: price.type as PriceType,
				unit_amount: price.unit_amount,
				interval: (price.recurring?.interval ?? null) as PriceInterval | null,
				interval_count: price.recurring?.interval_count ?? null,
				lookup_key: price.lookup_key,
				metadata: null,
				created_at: new Date(price.created * 1000).toISOString(),
				updated_at: new Date(price.created * 1000).toISOString(),
				product: product
					? {
							id: product.id,
							name: product.name,
							description: product.description,
							active: product.active,
							metadata: null,
							created_at: new Date(product.created * 1000).toISOString(),
							updated_at: new Date(product.created * 1000).toISOString()
						}
					: null
			};
		});
	} catch (error) {
		console.error('[pricing] Stripe list failed, falling back to DB:', error);
		const { data } = await supabaseAdmin
			.from('prices')
			.select('*, product:products(*)')
			.in('lookup_key', [...ALL_LOOKUP_KEYS]);
		return (data ?? []) as unknown as PriceWithProduct[];
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	const [prices, currentTier] = await Promise.all([
		loadLivePrices(),
		locals.user ? getSubscriptionTier(locals.user.id) : Promise.resolve<PricingTier | null>(null)
	]);

	return {
		tiers: PRICING_TIERS,
		pricing: byLookupKey(prices),
		currentTier
	};
};

export const actions: Actions = {
	checkout: async ({ request, locals, url }) => {
		const user = locals.user;
		if (!user) {
			const form = await request.formData();
			const lookupKey = form.get('lookupKey');
			throw redirect(303, `/login?next=${encodeURIComponent('/pricing')}&lookup_key=${lookupKey ?? ''}`);
		}

		const form = await request.formData();
		const parsed = checkoutSchema.safeParse({ lookupKey: form.get('lookupKey') });
		if (!parsed.success) {
			return fail(400, { error: 'Invalid pricing tier selected.' });
		}

		const prices = await stripe.prices.list({
			lookup_keys: [parsed.data.lookupKey],
			expand: ['data.product'],
			active: true,
			limit: 1
		});
		const price = prices.data[0];
		if (!price) {
			return fail(500, { error: 'Price not found in Stripe. Check your dashboard setup.' });
		}

		const customerId = await getOrCreateStripeCustomer({
			userId: user.id,
			email: user.email ?? '',
			fullName: user.user_metadata?.full_name ?? null
		});

		const mode: 'subscription' | 'payment' = price.type === 'recurring' ? 'subscription' : 'payment';
		const appUrl = PUBLIC_APP_URL || url.origin;

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

		if (!session.url) {
			return fail(500, { error: 'Stripe did not return a checkout URL.' });
		}
		throw redirect(303, session.url);
	}
};
