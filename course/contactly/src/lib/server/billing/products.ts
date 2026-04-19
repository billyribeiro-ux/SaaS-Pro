/**
 * Products service — mirror of Stripe `prod_…` and `price_…` into
 * `stripe_products` / `stripe_prices`.
 *
 * Two write paths feed the same upsert:
 *
 *   1. **Webhooks** (the ongoing source). The dispatch table in
 *      `stripe-events.ts` calls `upsertStripeProduct` /
 *      `upsertStripePrice` on every `product.*` / `price.*` event.
 *      This is how the catalog stays in sync after the initial seed.
 *
 *   2. **Backfill** (`syncStripeCatalog`). One-shot read from the
 *      Stripe API that paginates through all products + prices and
 *      upserts each. Used by:
 *         - Module 8.2 (`pnpm run stripe:seed`) after fixtures load,
 *           to guarantee the local DB matches Stripe before the
 *           pricing page is hydrated.
 *         - Disaster recovery (lost the local DB? Run the sync.)
 *         - Anyone who edited products/prices in the Dashboard while
 *           the dev server wasn't running and missed the webhook.
 *
 * One read path:
 *
 *   - `listActivePlans()` — the pricing page (Module 8.4) reads the
 *     full plan ladder from this in a single query. Returns rows
 *     sorted by `(tier_rank ASC, interval ASC)` so the UI can render
 *     them in display order without a follow-up sort.
 *
 * ORDERING & RACE CONDITIONS
 * --------------------------
 * Stripe does NOT guarantee that `product.created` arrives before
 * `price.created` for that product. If a price webhook lands first,
 * the local upsert would fail the FK on `stripe_prices.product_id`.
 * `upsertStripePrice` handles this by:
 *   1. Attempting the upsert.
 *   2. On a foreign-key violation (PG `23503`), fetching the parent
 *      product from the Stripe API, upserting it, then retrying.
 * One round-trip in the rare case is cheaper than blocking on
 * "wait for product webhook" and risking a stuck price.
 */
import type Stripe from 'stripe';
import { stripe } from '$lib/server/stripe';
import { withAdmin } from '$lib/server/supabase-admin';
import type { Database, Json } from '$lib/database.types';

type ProductInsert = Database['public']['Tables']['stripe_products']['Insert'];
type PriceInsert = Database['public']['Tables']['stripe_prices']['Insert'];

type StripeBillingInterval = Database['public']['Enums']['stripe_billing_interval'];

/**
 * Stripe `created` / `updated` are seconds-since-epoch; mirror tables
 * use `timestamptz`. Centralize the conversion so a stray `* 1000`
 * doesn't turn 2026 into the year 51902.
 */
function toIso(seconds: number | null | undefined): string | null {
	if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
	return new Date(seconds * 1000).toISOString();
}

/**
 * Translate a Stripe Product into the row shape `stripe_products`
 * expects. Pure function (no I/O) so unit tests don't need a mock.
 */
function productRowFor(product: Stripe.Product): ProductInsert {
	return {
		id: product.id,
		active: product.active,
		name: product.name,
		description: product.description ?? null,
		metadata: (product.metadata ?? {}) as unknown as Json,
		tax_code:
			typeof product.tax_code === 'string' ? product.tax_code : (product.tax_code?.id ?? null),
		stripe_created_at: toIso(product.created),
		stripe_updated_at: toIso(product.updated)
	};
}

/**
 * Translate a Stripe Price into a `stripe_prices` row. Validates the
 * recurrence-consistency invariant (`type='one_time'` ⇒ no recurrence;
 * `type='recurring'` ⇒ both interval fields populated) at the
 * application boundary, BEFORE the DB check fires, so the error
 * message points at the offending price id rather than a Postgres
 * constraint name.
 */
function priceRowFor(price: Stripe.Price): PriceInsert {
	const productId =
		typeof price.product === 'string' ? price.product : (price.product as Stripe.Product).id;
	if (price.type === 'recurring' && !price.recurring) {
		throw new Error(
			`[products] price ${price.id} reports type='recurring' but recurring is null — Stripe payload is malformed.`
		);
	}
	return {
		id: price.id,
		product_id: productId,
		active: price.active,
		lookup_key: price.lookup_key ?? null,
		unit_amount: price.unit_amount ?? null,
		currency: price.currency,
		type: price.type,
		recurring_interval: (price.recurring?.interval as StripeBillingInterval | undefined) ?? null,
		recurring_interval_count: price.recurring?.interval_count ?? null,
		tax_behavior: price.tax_behavior ?? null,
		metadata: (price.metadata ?? {}) as unknown as Json,
		stripe_created_at: toIso(price.created)
	};
}

/**
 * Upsert one product. Idempotent — safe to call N times for the same
 * payload. The webhook handler does this on every `product.*` event;
 * the backfill does it for every product Stripe returns.
 */
export async function upsertStripeProduct(product: Stripe.Product): Promise<void> {
	const row = productRowFor(product);
	const { error } = await withAdmin('billing.products.upsert', 'system', async (admin) =>
		admin.from('stripe_products').upsert(row, { onConflict: 'id' })
	);
	if (error) {
		throw new Error(`[products] upsertStripeProduct failed for ${product.id}: ${error.message}`);
	}
}

/**
 * Upsert one price. Tolerates out-of-order delivery vs the parent
 * product webhook by fetching + upserting the product on a FK miss,
 * then retrying ONCE. A second FK miss (i.e. the product genuinely
 * doesn't exist in Stripe either) is fatal.
 */
export async function upsertStripePrice(price: Stripe.Price): Promise<void> {
	const row = priceRowFor(price);
	const { error } = await withAdmin('billing.prices.upsert', 'system', async (admin) =>
		admin.from('stripe_prices').upsert(row, { onConflict: 'id' })
	);
	if (!error) return;

	// Postgres foreign_key_violation. The product the price references
	// isn't in our mirror yet — fetch from Stripe and try again.
	if (error.code === '23503') {
		const productId = row.product_id;
		console.warn('[products] price upsert hit FK miss; backfilling parent product', {
			price_id: price.id,
			product_id: productId
		});
		const product = await stripe().products.retrieve(productId);
		await upsertStripeProduct(product);
		const { error: retryError } = await withAdmin(
			'billing.prices.upsert.retry',
			'system',
			async (admin) => admin.from('stripe_prices').upsert(row, { onConflict: 'id' })
		);
		if (retryError) {
			throw new Error(
				`[products] upsertStripePrice retry failed for ${price.id} after backfilling ${productId}: ${retryError.message}`
			);
		}
		return;
	}

	throw new Error(`[products] upsertStripePrice failed for ${price.id}: ${error.message}`);
}

/**
 * Mark a product inactive on `product.deleted`. We DO NOT issue a
 * physical delete because:
 *   1. `stripe_subscriptions.price_id` may still reference a price
 *      whose product was deleted — historical billing display would
 *      break.
 *   2. Stripe itself archives products rather than purging them.
 *
 * Keeping the row with `active=false` matches Stripe's data model
 * and lets `listActivePlans()` filter cleanly.
 */
export async function deleteStripeProduct(productId: string): Promise<void> {
	const { error } = await withAdmin('billing.products.archive', 'system', async (admin) =>
		admin
			.from('stripe_products')
			.update({ active: false, stripe_updated_at: new Date().toISOString() })
			.eq('id', productId)
	);
	if (error) {
		throw new Error(
			`[products] deleteStripeProduct failed to archive ${productId}: ${error.message}`
		);
	}
}

/**
 * Mark a price inactive on `price.deleted`. Same reasoning as
 * `deleteStripeProduct` — never physically delete a price that an
 * existing subscription points at.
 */
export async function deleteStripePrice(priceId: string): Promise<void> {
	const { error } = await withAdmin('billing.prices.archive', 'system', async (admin) =>
		admin.from('stripe_prices').update({ active: false }).eq('id', priceId)
	);
	if (error) {
		throw new Error(`[products] deleteStripePrice failed to archive ${priceId}: ${error.message}`);
	}
}

/**
 * One-shot backfill from Stripe → mirror tables. Used by the seed
 * script (Module 8.2) and as a recovery tool.
 *
 * Pagination: `auto_paging` walks the entire list, no manual cursor
 * loop. Even at thousands of products this completes in under a
 * minute and writes are batched per-row (Supabase doesn't support
 * a multi-row upsert across two tables in one transaction).
 *
 * Order: products first (so prices' FK targets are present), then
 * prices. The result reports counts for the caller to log.
 */
export async function syncStripeCatalog(): Promise<{
	products: number;
	prices: number;
}> {
	// `stripe.<resource>.list({ limit: 100 })` returns an auto-paginating
	// iterator (the Stripe Node SDK implements `Symbol.asyncIterator`),
	// so `for await` walks every page transparently — we don't manage
	// the cursor ourselves.
	let productCount = 0;
	for await (const product of stripe().products.list({ limit: 100 })) {
		await upsertStripeProduct(product);
		productCount += 1;
	}

	let priceCount = 0;
	for await (const price of stripe().prices.list({ limit: 100 })) {
		await upsertStripePrice(price);
		priceCount += 1;
	}

	console.info('[products] syncStripeCatalog complete', {
		products: productCount,
		prices: priceCount
	});
	return { products: productCount, prices: priceCount };
}

/**
 * One row of the pricing-page query: an active price joined with its
 * (active) product. The pricing page (Module 8.4) renders this list
 * directly; the order is `(tier_rank, interval)` so the four-card
 * Pro/Business × monthly/yearly grid lays out without re-sorting.
 */
export type ActivePlanRow = {
	price_id: string;
	lookup_key: string | null;
	unit_amount: number | null;
	currency: string;
	recurring_interval: StripeBillingInterval | null;
	product_id: string;
	product_name: string;
	product_description: string | null;
	product_metadata: Json;
};

/**
 * Read every active recurring price + its (active) product in
 * display order. Public reader — uses the service-role client only
 * so that the lib stays usable from a `+page.server.ts` `load()`
 * even before the visitor authenticates. (RLS would let the public
 * read anyway, but keeping a single client surface here is simpler
 * than threading the request's Supabase client through every helper.)
 */
export async function listActivePlans(): Promise<ActivePlanRow[]> {
	const { data, error } = await withAdmin('billing.products.list-active', 'system', async (admin) =>
		admin
			.from('stripe_prices')
			.select(
				'id, lookup_key, unit_amount, currency, recurring_interval, product:stripe_products!inner(id, name, description, metadata, active)'
			)
			.eq('active', true)
			.eq('type', 'recurring')
	);
	if (error) {
		throw new Error(`[products] listActivePlans failed: ${error.message}`);
	}
	if (!data) return [];

	const rows: ActivePlanRow[] = [];
	for (const row of data) {
		const product = row.product as unknown as {
			id: string;
			name: string;
			description: string | null;
			metadata: Json;
			active: boolean;
		} | null;
		if (!product || !product.active) continue;
		rows.push({
			price_id: row.id,
			lookup_key: row.lookup_key,
			unit_amount: row.unit_amount,
			currency: row.currency,
			recurring_interval: row.recurring_interval,
			product_id: product.id,
			product_name: product.name,
			product_description: product.description,
			product_metadata: product.metadata
		});
	}

	rows.sort((a, b) => {
		const rankA = readMetadataNumber(a.product_metadata, 'tier_rank') ?? Number.MAX_SAFE_INTEGER;
		const rankB = readMetadataNumber(b.product_metadata, 'tier_rank') ?? Number.MAX_SAFE_INTEGER;
		if (rankA !== rankB) return rankA - rankB;
		// Monthly before yearly — matches conventional pricing-card layout.
		const orderOf = (i: StripeBillingInterval | null) => (i === 'month' ? 0 : i === 'year' ? 1 : 2);
		return orderOf(a.recurring_interval) - orderOf(b.recurring_interval);
	});

	return rows;
}

/**
 * Tolerant numeric coercion for `metadata->>'tier_rank'`. Stripe
 * stores all metadata values as strings; missing/invalid → null so
 * the sort falls back to "unranked, last".
 */
function readMetadataNumber(metadata: Json, key: string): number | null {
	if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
	const raw = (metadata as { [k: string]: Json | undefined })[key];
	if (typeof raw !== 'string' && typeof raw !== 'number') return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isFinite(n) ? n : null;
}
