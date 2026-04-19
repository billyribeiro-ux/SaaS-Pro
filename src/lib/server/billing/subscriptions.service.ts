import type Stripe from 'stripe';
import { supabaseAdmin } from '$server/supabase';
import { findUserIdByStripeCustomerId } from './customers.service';
import type { SubscriptionStatus, TablesInsert, Json } from '$types/database.types';

const VALID_STATUSES: readonly SubscriptionStatus[] = [
	'trialing',
	'active',
	'canceled',
	'incomplete',
	'incomplete_expired',
	'past_due',
	'unpaid',
	'paused'
];

function toIsoOrNull(unix: number | null | undefined): string | null {
	if (unix === null || unix === undefined) return null;
	return new Date(unix * 1000).toISOString();
}

function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
	if ((VALID_STATUSES as readonly string[]).includes(status)) {
		return status as SubscriptionStatus;
	}
	// Unknown Stripe statuses get normalized to 'incomplete' rather than crashing
	// the webhook; operators can audit via `subscriptions.metadata.stripe_status`.
	return 'incomplete';
}

function serializeMetadata(
	metadata: Stripe.Metadata | null | undefined,
	extra: Record<string, string>
): Json {
	const base: Record<string, string> = {};
	if (metadata) {
		for (const [key, value] of Object.entries(metadata)) {
			if (typeof value === 'string') base[key] = value;
		}
	}
	return { ...base, ...extra } as unknown as Json;
}

export async function upsertSubscription(subscription: Stripe.Subscription): Promise<void> {
	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

	const userId = await findUserIdByStripeCustomerId(customerId);
	if (!userId) {
		throw new Error(`[subscriptions.service] no profile mapped to stripe customer ${customerId}`);
	}

	const firstItem = subscription.items.data[0];
	if (!firstItem) {
		throw new Error(
			`[subscriptions.service] subscription ${subscription.id} has no items — cannot determine period`
		);
	}
	const priceId = firstItem.price.id;
	const quantity = firstItem.quantity ?? null;

	// Stripe v22 / 2026-03-25.dahlia moved period bounds off Subscription and
	// onto each SubscriptionItem. We pin a single-item subscription model here.
	const row: TablesInsert<'subscriptions'> = {
		id: subscription.id,
		user_id: userId,
		status: mapStatus(subscription.status),
		price_id: priceId,
		quantity,
		cancel_at_period_end: subscription.cancel_at_period_end,
		cancel_at: toIsoOrNull(subscription.cancel_at),
		canceled_at: toIsoOrNull(subscription.canceled_at),
		current_period_start: new Date(firstItem.current_period_start * 1000).toISOString(),
		current_period_end: new Date(firstItem.current_period_end * 1000).toISOString(),
		created_at: new Date(subscription.created * 1000).toISOString(),
		ended_at: toIsoOrNull(subscription.ended_at),
		trial_start: toIsoOrNull(subscription.trial_start),
		trial_end: toIsoOrNull(subscription.trial_end),
		metadata: serializeMetadata(subscription.metadata, {
			stripe_status: subscription.status
		})
	};

	const { error } = await supabaseAdmin.from('subscriptions').upsert(row, { onConflict: 'id' });

	if (error) {
		throw new Error(
			`[subscriptions.service] upsert failed for ${subscription.id}: ${error.message}`
		);
	}
}

export async function markSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	const { error } = await supabaseAdmin
		.from('subscriptions')
		.update({
			status: 'canceled',
			ended_at: toIsoOrNull(subscription.ended_at) ?? new Date().toISOString(),
			canceled_at: toIsoOrNull(subscription.canceled_at) ?? new Date().toISOString()
		})
		.eq('id', subscription.id);

	if (error) {
		throw new Error(
			`[subscriptions.service] delete-mark failed for ${subscription.id}: ${error.message}`
		);
	}
}
