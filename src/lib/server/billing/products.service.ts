import type Stripe from 'stripe';
import { supabaseAdmin } from '$server/supabase';
import type { TablesInsert, Json } from '$types/database.types';

function serializeMetadata(metadata: Stripe.Metadata | null | undefined): Json | null {
	if (!metadata) return null;
	return metadata as unknown as Json;
}

export async function upsertProduct(product: Stripe.Product): Promise<void> {
	const row: TablesInsert<'products'> = {
		id: product.id,
		name: product.name,
		description: product.description,
		active: product.active,
		metadata: serializeMetadata(product.metadata)
	};

	const { error } = await supabaseAdmin.from('products').upsert(row, { onConflict: 'id' });
	if (error) {
		throw new Error(`[products.service] upsert failed for ${product.id}: ${error.message}`);
	}
}

export async function upsertPrice(price: Stripe.Price): Promise<void> {
	const productId = typeof price.product === 'string' ? price.product : price.product.id;
	const row: TablesInsert<'prices'> = {
		id: price.id,
		product_id: productId,
		active: price.active,
		currency: price.currency,
		type: price.type,
		unit_amount: price.unit_amount,
		interval: price.recurring?.interval ?? null,
		interval_count: price.recurring?.interval_count ?? null,
		lookup_key: price.lookup_key,
		metadata: serializeMetadata(price.metadata)
	};

	const { error } = await supabaseAdmin.from('prices').upsert(row, { onConflict: 'id' });
	if (error) {
		throw new Error(`[products.service] price upsert failed for ${price.id}: ${error.message}`);
	}
}
