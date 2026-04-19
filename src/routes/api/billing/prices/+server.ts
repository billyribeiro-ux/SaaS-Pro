import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$server/stripe';
import { ALL_LOOKUP_KEYS } from '$config/pricing.config';

// Public endpoint for live pricing. Response is NOT cached — prices can change
// in Stripe independently of deploys, and stale cached prices break checkout.
export const GET: RequestHandler = async () => {
	const prices = await stripe.prices.list({
		lookup_keys: [...ALL_LOOKUP_KEYS],
		expand: ['data.product'],
		active: true
	});

	return json(
		{
			prices: prices.data.map((price) => {
				const rawProduct = typeof price.product === 'string' ? null : price.product;
				const product =
					rawProduct && !('deleted' in rawProduct && rawProduct.deleted) ? rawProduct : null;
				return {
					id: price.id,
					lookupKey: price.lookup_key,
					currency: price.currency,
					unitAmount: price.unit_amount,
					type: price.type,
					interval: price.recurring?.interval ?? null,
					product: product ? { id: product.id, name: product.name } : null
				};
			})
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
