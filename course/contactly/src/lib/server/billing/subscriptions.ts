/**
 * Subscriptions service — the entitlement nucleus of Contactly.
 *
 * This module turns the Stripe `customer.subscription.*` event stream
 * into rows in `stripe_subscriptions`, and exposes two read-side
 * helpers that every authenticated page hits:
 *
 *   - `getActiveSubscription(userId)` — the user's currently-billing
 *     subscription row, or `null` for a free-tier user.
 *
 *   - `tierForUser(userId)` — `'starter' | 'pro' | 'business'`. Used
 *     anywhere in the app that gates behavior on plan (contact-list
 *     cap, export button, future seat counters).
 *
 * Per ADR-002 every subscription row is scoped to a USER (not an
 * organization). The `stripe_subscriptions_one_active_per_user`
 * partial unique index from Lesson 7.1 is the database-level
 * guarantee that a user can have at most one trialing/active/past_due
 * subscription at a time — the checkout endpoint (Module 9.1) refuses
 * to create a second, but defense in depth: even an out-of-band
 * Dashboard create would land here and trip the constraint.
 *
 * API VERSION 2026-03-25.dahlia
 * -----------------------------
 * In this API version the `current_period_start` / `current_period_end`
 * fields LIVE ON SUBSCRIPTION ITEMS, not on the subscription itself.
 * Contactly subscriptions are always single-item (one price per
 * subscription), so we read `subscription.items.data[0]` and treat
 * its period as the subscription's period. If a subscription ever
 * has zero items (Stripe schema permits this transient state) we
 * leave the period columns null and log a warning.
 */
import type Stripe from 'stripe';
import { withAdmin } from '$lib/server/supabase-admin';
import type { Database } from '$lib/database.types';
import { upsertStripePrice } from '$lib/server/billing/products';
import { stripe } from '$lib/server/stripe';
import { isLookupKey, parseLookupKey, type LookupKey, type Tier } from '$lib/billing/lookup-keys';

type SubscriptionInsert = Database['public']['Tables']['stripe_subscriptions']['Insert'];
type SubscriptionRow = Database['public']['Tables']['stripe_subscriptions']['Row'];
type SubscriptionStatus = Database['public']['Enums']['stripe_subscription_status'];

/**
 * Stripe `Subscription.status` is wider than what our enum allows
 * because their union may grow before our DB does. Validate at the
 * mirror boundary so an unknown status logs and skips rather than
 * propagating a 500. Listed explicitly for readability.
 */
const KNOWN_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused'
]);

function asKnownStatus(status: string): SubscriptionStatus | null {
	return (KNOWN_STATUSES as ReadonlySet<string>).has(status)
		? (status as SubscriptionStatus)
		: null;
}

/** Seconds-since-epoch → ISO-8601, or null. Same helper as in products.ts. */
function toIso(seconds: number | null | undefined): string | null {
	if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
	return new Date(seconds * 1000).toISOString();
}

/**
 * Pluck the period fields from the (single) subscription item. In
 * API version 2026-03-25.dahlia these fields are always on the item,
 * never on the subscription itself.
 */
function readItemPeriod(subscription: Stripe.Subscription): {
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
} {
	const item = subscription.items?.data?.[0];
	if (!item) {
		console.warn('[subscriptions] subscription has zero items; period fields will be null', {
			subscription_id: subscription.id
		});
		return { currentPeriodStart: null, currentPeriodEnd: null };
	}
	const period = item as unknown as {
		current_period_start?: number | null;
		current_period_end?: number | null;
	};
	return {
		currentPeriodStart: toIso(period.current_period_start),
		currentPeriodEnd: toIso(period.current_period_end)
	};
}

/**
 * Pluck the active price from the (single) subscription item.
 * Throws if absent — the FK on `stripe_subscriptions.price_id` is
 * NOT NULL, so we'd fail at the DB anyway.
 */
function readItemPrice(subscription: Stripe.Subscription): Stripe.Price {
	const price = subscription.items?.data?.[0]?.price;
	if (!price) {
		throw new Error(
			`[subscriptions] subscription ${subscription.id} has no price on its first item; cannot mirror.`
		);
	}
	return price;
}

/**
 * Map a Stripe `Subscription` to its `stripe_subscriptions` row.
 * Pure function (no I/O) — separated for testability.
 *
 * @returns the row, or `null` if the user/price/status invariants
 *          can't be satisfied (caller logs + skips).
 */
async function rowFor(subscription: Stripe.Subscription): Promise<SubscriptionInsert | null> {
	const status = asKnownStatus(subscription.status);
	if (!status) {
		console.warn('[subscriptions] unknown status; skipping mirror', {
			subscription_id: subscription.id,
			status: subscription.status
		});
		return null;
	}

	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

	const userId = await userIdForCustomer(customerId);
	if (!userId) {
		console.warn(
			'[subscriptions] no stripe_customers row for subscription customer; skipping mirror',
			{ subscription_id: subscription.id, customer_id: customerId }
		);
		return null;
	}

	const price = readItemPrice(subscription);
	const period = readItemPeriod(subscription);

	return {
		id: subscription.id,
		user_id: userId,
		stripe_customer_id: customerId,
		status,
		price_id: price.id,
		cancel_at_period_end: subscription.cancel_at_period_end ?? false,
		current_period_start: period.currentPeriodStart,
		current_period_end: period.currentPeriodEnd,
		trial_start: toIso(subscription.trial_start),
		trial_end: toIso(subscription.trial_end),
		canceled_at: toIso(subscription.canceled_at),
		cancel_at: toIso(subscription.cancel_at),
		tier_snapshot:
			(price.metadata && typeof price.metadata.tier === 'string' && price.metadata.tier) || null,
		stripe_created_at: toIso(subscription.created)
	};
}

/**
 * Resolve a `cus_…` to its owning Contactly user via the cache from
 * Module 7.3. Returns `null` if no mapping exists (e.g. the customer
 * was created out-of-band in the Dashboard with no metadata.user_id).
 */
async function userIdForCustomer(stripeCustomerId: string): Promise<string | null> {
	const { data, error } = await withAdmin('billing.subs.user-lookup', 'system', async (admin) =>
		admin
			.from('stripe_customers')
			.select('user_id')
			.eq('stripe_customer_id', stripeCustomerId)
			.maybeSingle()
	);
	if (error) {
		throw new Error(
			`[subscriptions] userIdForCustomer failed for ${stripeCustomerId}: ${error.message}`
		);
	}
	return data?.user_id ?? null;
}

/**
 * Insert-or-update a subscription row. Tolerates the FK-on-price
 * race the same way `upsertStripePrice` does for its parent product:
 * if the price isn't in our mirror yet (the `customer.subscription.*`
 * webhook beat the `price.created` webhook), backfill via the
 * products service then retry exactly once.
 */
export async function upsertSubscription(subscription: Stripe.Subscription): Promise<void> {
	const row = await rowFor(subscription);
	if (!row) return;

	const { error } = await withAdmin('billing.subs.upsert', 'system', async (admin) =>
		admin.from('stripe_subscriptions').upsert(row, { onConflict: 'id' })
	);
	if (!error) return;

	// foreign_key_violation on price_id — backfill the price + retry.
	if (error.code === '23503') {
		console.warn('[subscriptions] subscription upsert hit FK miss; backfilling parent price', {
			subscription_id: subscription.id,
			price_id: row.price_id
		});
		const price = await stripe().prices.retrieve(row.price_id);
		await upsertStripePrice(price);
		const { error: retryError } = await withAdmin(
			'billing.subs.upsert.retry',
			'system',
			async (admin) => admin.from('stripe_subscriptions').upsert(row, { onConflict: 'id' })
		);
		if (retryError) {
			throw new Error(
				`[subscriptions] retry upsert failed for ${subscription.id} after backfilling ${row.price_id}: ${retryError.message}`
			);
		}
		return;
	}

	// `23505` (unique_violation) on the partial unique index means the
	// user already has a different active subscription — Stripe
	// shouldn't let this happen because the checkout endpoint refuses
	// double-subscribes, but if it does we'd rather know loudly than
	// silently bill the user twice.
	if (error.code === '23505') {
		throw new Error(
			`[subscriptions] DUPLICATE active subscription for user; refusing to mirror. ` +
				`subscription=${subscription.id} customer=${row.stripe_customer_id} pg=${error.message}`
		);
	}

	throw new Error(
		`[subscriptions] upsertSubscription failed for ${subscription.id}: ${error.message}`
	);
}

/**
 * Webhook handler for `customer.subscription.deleted`.
 *
 * Stripe sends a payload with `status='canceled'`, but they also
 * GC'd the underlying object. We mirror the cancellation
 * (`upsertSubscription` writes `status='canceled'`, which slides the
 * row out of the partial unique index since it's not in
 * trialing/active/past_due) and that's the end of the story.
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	await upsertSubscription(subscription);
}

/**
 * Webhook handler for `customer.subscription.trial_will_end`.
 *
 * Fires three days before `trial_end`. Module 9.4 will hook this up
 * to a Resend transactional email — for now we just `console.info`
 * so a `pnpm run stripe:trigger` rehearsal shows it routed through
 * the dispatcher correctly. No DB write: the trial-end timestamp is
 * already present in our mirror from the subscription's prior
 * `created`/`updated` events.
 */
export async function handleSubscriptionTrialWillEnd(
	subscription: Stripe.Subscription
): Promise<void> {
	console.info('[subscriptions] trial_will_end (notification not yet wired)', {
		subscription_id: subscription.id,
		trial_end: subscription.trial_end
	});
}

/**
 * Read the user's currently-billing subscription, or `null` for a
 * free-tier user.
 *
 * "Currently billing" = status in (trialing, active, past_due). The
 * partial unique index from Lesson 7.1 means there's at most one such
 * row per user, so `.maybeSingle()` is safe.
 */
export async function getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
	const { data, error } = await withAdmin('billing.subs.read-active', 'system', async (admin) =>
		admin
			.from('stripe_subscriptions')
			.select('*')
			.eq('user_id', userId)
			.in('status', ['trialing', 'active', 'past_due'])
			.maybeSingle()
	);
	if (error) {
		throw new Error(`[subscriptions] getActiveSubscription failed for ${userId}: ${error.message}`);
	}
	return data ?? null;
}

/**
 * Resolve a user's current tier.
 *
 * Resolution order:
 *   1. No active subscription → `'starter'`.
 *   2. Active subscription whose price has a known lookup key →
 *      tier extracted via `parseLookupKey`. This is the canonical
 *      path; matches the Lesson 5.6 invariant.
 *   3. Active subscription whose price has no lookup key OR an
 *      unknown one → log + return `'starter'`. Forces feature gates
 *      to fail closed when our local catalog is out of sync.
 *
 * NOTE: We deliberately DO NOT read `tier_snapshot` from the
 * subscription row here. That column is for analytics; the
 * lookup-key path is the entitlement source of truth.
 */
export async function tierForUser(userId: string): Promise<Tier> {
	const subscription = await getActiveSubscription(userId);
	if (!subscription) return 'starter';

	const { data, error } = await withAdmin('billing.subs.price-lookup', 'system', async (admin) =>
		admin.from('stripe_prices').select('lookup_key').eq('id', subscription.price_id).maybeSingle()
	);
	if (error) {
		throw new Error(
			`[subscriptions] tierForUser price lookup failed for user ${userId}: ${error.message}`
		);
	}

	const lookupKey = data?.lookup_key;
	if (!isLookupKey(lookupKey)) {
		console.warn(
			'[subscriptions] active subscription has no recognized lookup_key; falling back to starter',
			{ user_id: userId, subscription_id: subscription.id, lookup_key: lookupKey ?? null }
		);
		return 'starter';
	}

	const { tier } = parseLookupKey(lookupKey as LookupKey);
	return tier;
}
