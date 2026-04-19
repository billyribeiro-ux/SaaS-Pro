import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$server/stripe';
import { ALL_LOOKUP_KEYS } from '$config/pricing.config';

// Public endpoint for live pricing. We trade a tiny (≤60s) staleness window
// for dramatic load reduction on Stripe's API — checkout itself always fetches
// fresh prices server-side, so stale cache here can't cause a pricing error.
// `stale-while-revalidate` lets the CDN serve the stale response while it
// refreshes in the background, so p95 is cache-hit speed.
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
		{
			headers: {
				'cache-control': 'public, s-maxage=60, stale-while-revalidate=300'
			}
		}
	);
};
