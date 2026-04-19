/**
 * Customers service — the user ↔ Stripe-customer bridge.
 *
 * Per ADR-002 every Contactly *user* maps 1:1 to a Stripe *customer*
 * (`cus_…`). This module owns that mapping. There are exactly two
 * code paths that produce or modify a row in `stripe_customers`:
 *
 *   1. `ensureStripeCustomer({ userId, email })`
 *      — the LAZY-creation flow. Called from the Checkout endpoint
 *        (Module 9.1) the first time a user opens a payment surface.
 *        Returns an existing `cus_…` if we already have one cached;
 *        otherwise creates one in Stripe (with an idempotency key
 *        derived from `userId` so concurrent calls coalesce) and
 *        caches it. After this lesson, every checkout-bound user has
 *        a customer.
 *
 *   2. The `customer.*` webhook handlers
 *      — keep the cached row in sync with out-of-band edits made in
 *        the Stripe Dashboard (a support agent updating an email,
 *        the Customer Portal saving a payment method, deleting a
 *        test customer to start fresh, etc).
 *
 * EVERYTHING ELSE in the codebase that needs "the Stripe customer
 * for user X" calls `ensureStripeCustomer` — never the Stripe API
 * directly, never an ad-hoc `select stripe_customer_id from …`. That
 * keeps the lazy-creation invariant intact: a user we've never
 * touched billing-wise never has a Stripe customer (saving us the
 * Stripe API call + the "ghost customers in the dashboard" cleanup
 * tax).
 */
import type Stripe from 'stripe';
import { stripe, withIdempotencyKey } from '$lib/server/stripe';
import { withAdmin } from '$lib/server/supabase-admin';

/**
 * The minimum identity we need to materialize a Stripe customer for
 * a user. `email` is optional because we sometimes have a user-id
 * but no email (e.g. a `customer.created` webhook arriving for an
 * already-deleted user) — when present we forward it to Stripe so
 * the customer record carries it; when absent we skip.
 */
export type EnsureCustomerInput = {
	userId: string;
	email?: string | null;
};

/**
 * Ensure a Stripe customer exists for `userId` and the
 * `stripe_customers` row is cached. Returns the `cus_…` id.
 *
 * IDEMPOTENCY
 * -----------
 * Two concurrent checkout opens for the same user could both miss
 * the cache, both call `customers.create`, and produce two `cus_…`
 * with the same `metadata.user_id` — one of which would be orphaned
 * (cluttering the dashboard, paying $0 forever).
 *
 * The fix is Stripe's built-in `Idempotency-Key`: requests with the
 * same key within 24 h return the SAME customer object. We derive a
 * key from `userId` so concurrent calls collapse server-side at
 * Stripe; the loser's local upsert hits the existing row and is a
 * no-op.
 *
 * READ-FIRST
 * ----------
 * The cache check happens BEFORE the idempotency-keyed create. The
 * happy path (user has a customer already) costs one DB read and
 * zero Stripe API calls — checkout opens are not free at Stripe's
 * rate limit.
 */
export async function ensureStripeCustomer({
	userId,
	email
}: EnsureCustomerInput): Promise<string> {
	const cached = await readCachedCustomer(userId);
	if (cached) return cached;

	const customer = await withIdempotencyKey(
		`ensure-customer-user-${userId}`,
		async (idempotencyKey) =>
			stripe().customers.create(
				{
					email: email ?? undefined,
					// Stripe stringifies all metadata. Code that reads
					// metadata.user_id back must not rely on UUID type.
					metadata: { user_id: userId }
				},
				{ idempotencyKey }
			)
	);

	await upsertCustomerRow({
		userId,
		stripeCustomerId: customer.id,
		email: customer.email ?? email ?? null
	});

	return customer.id;
}

/** Cache lookup. Encapsulated so call sites stay one-line. */
async function readCachedCustomer(userId: string): Promise<string | null> {
	const { data, error } = await withAdmin('billing.customers.read', 'system', async (admin) =>
		admin.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle()
	);
	if (error) {
		throw new Error(`[customers] readCachedCustomer failed for user ${userId}: ${error.message}`);
	}
	return data?.stripe_customer_id ?? null;
}

/**
 * Insert-or-update a `stripe_customers` row.
 *
 * `onConflict: 'user_id'` — the PK. Two concurrent ensures both end
 * up with the same Stripe customer (idempotency-key handles that)
 * and the second upsert no-ops on the conflict.
 */
async function upsertCustomerRow(input: {
	userId: string;
	stripeCustomerId: string;
	email: string | null;
}): Promise<void> {
	const { error } = await withAdmin('billing.customers.upsert', 'system', async (admin) =>
		admin.from('stripe_customers').upsert(
			{
				user_id: input.userId,
				stripe_customer_id: input.stripeCustomerId,
				email: input.email
			},
			{ onConflict: 'user_id' }
		)
	);
	if (error) {
		throw new Error(
			`[customers] upsertCustomerRow failed for ${input.userId} (${input.stripeCustomerId}): ${error.message}`
		);
	}
}

/**
 * Resolve a Stripe customer payload to its owning Contactly user.
 *
 * Returns `null` if no `metadata.user_id` is present — that means
 * the customer was created out-of-band (e.g. through the Dashboard
 * UI by a support agent who didn't set the metadata). We log and
 * skip rather than fabricating a mapping. Pure helper, no I/O.
 */
function userIdFromCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer): string | null {
	if (customer.deleted === true) return null;
	const userId = customer.metadata?.user_id;
	return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

/**
 * Webhook handler for `customer.created`.
 *
 * The most common reason this fires is `ensureStripeCustomer`'s own
 * `customers.create` call — the upsert below races the one inside
 * `ensureStripeCustomer`, but `onConflict: 'user_id'` makes that
 * race a no-op. An `customer.created` event with no `user_id`
 * metadata is a Dashboard-created customer; we log and skip.
 */
export async function handleCustomerCreated(customer: Stripe.Customer): Promise<void> {
	const userId = userIdFromCustomer(customer);
	if (!userId) {
		console.warn('[customers] customer.created with no metadata.user_id; skipping', {
			customer_id: customer.id
		});
		return;
	}
	await upsertCustomerRow({
		userId,
		stripeCustomerId: customer.id,
		email: customer.email ?? null
	});
}

/**
 * Webhook handler for `customer.updated`.
 *
 * Looks up the local row by `stripe_customer_id` (the unique
 * non-PK index) and updates the cached email. If we don't have a
 * row, the customer was either created out-of-band or has already
 * been deleted locally — either way, we don't try to retroactively
 * adopt it.
 */
export async function handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
	const { error } = await withAdmin('billing.customers.update', 'system', async (admin) =>
		admin
			.from('stripe_customers')
			.update({ email: customer.email ?? null })
			.eq('stripe_customer_id', customer.id)
	);
	if (error) {
		throw new Error(
			`[customers] handleCustomerUpdated failed for ${customer.id}: ${error.message}`
		);
	}
}

/**
 * Webhook handler for `customer.deleted`.
 *
 * We DO physically delete the local mapping here (unlike products /
 * prices, which we soft-delete). Reasoning:
 *   - The Stripe customer is gone; keeping a stale mapping would
 *     mean a future `ensureStripeCustomer` returns an id that 404s.
 *   - There's no historical data riding on the row — invoices and
 *     subscriptions live in their own tables and reference the
 *     `stripe_customer_id` string directly, which still works for
 *     read-only display even after the mapping is gone.
 */
export async function handleCustomerDeleted(
	customer: Stripe.Customer | Stripe.DeletedCustomer
): Promise<void> {
	const { error } = await withAdmin('billing.customers.delete', 'system', async (admin) =>
		admin.from('stripe_customers').delete().eq('stripe_customer_id', customer.id)
	);
	if (error) {
		throw new Error(
			`[customers] handleCustomerDeleted failed for ${customer.id}: ${error.message}`
		);
	}
}
