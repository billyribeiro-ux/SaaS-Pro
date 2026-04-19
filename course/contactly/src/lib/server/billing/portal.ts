/**
 * Billing Portal service — open the Stripe Customer Portal for an
 * authenticated, paying user.
 *
 * The Customer Portal is Stripe's hosted "manage my subscription"
 * surface: change plan (with proration), update payment method,
 * download invoices, cancel. Per the Stripe billing skill it is the
 * recommended surface for self-service subscription management;
 * rolling our own would mean re-implementing dunning UI, proration
 * preview, payment-method UX, invoice history — every one of those
 * is a category bug source we don't need to own.
 *
 * SCOPE
 * -----
 * One operation: `createPortalSession({ user, origin })` →
 *
 *   - `{ kind: 'redirect', url }`         — caller 303s to the portal.
 *   - `{ kind: 'refused', reason: 'no_customer' }`
 *                                         — user has never had a
 *                                           Stripe customer (free-
 *                                           tier user who's never
 *                                           opened Checkout). Caller
 *                                           sends them to /pricing.
 *
 * Like checkout.ts, refusals are returned, not thrown. Throws are
 * reserved for the unexpected (Stripe API errors, DB failures, etc).
 *
 * NO SUBSCRIPTION REQUIREMENT
 * ---------------------------
 * We DO NOT require an active subscription to open the Portal. A
 * cancelled-customer can still go in and view their invoice history
 * or even re-subscribe via the portal's "reactivate" UI (when the
 * Dashboard's portal config enables it). The only gate is "do we
 * have a Stripe customer at all" — i.e. has this user ever opened
 * checkout. The mapping lives in `stripe_customers`.
 *
 * The cached customer-id lookup is a single indexed read on
 * `stripe_customers.user_id` (PK). If we ever miss the cache for a
 * user we KNOW has paid (e.g. webhook race during signup), we deal
 * with that the same way `ensureStripeCustomer` does it on the
 * checkout side: lazy-create. But we DON'T do that here on the
 * Portal route — opening the Portal for a customer with no
 * subscription history would just show them an empty page.
 */
import { stripe, withIdempotencyKey } from '$lib/server/stripe';
import { withAdmin } from '$lib/server/supabase-admin';

export type CreatePortalInput = {
	user: { id: string };
	origin: string;
	/** Optional override for return URL. Defaults to `${origin}/account`. */
	returnPath?: string;
	/** Optional disambiguator for the Stripe idempotency key. */
	idempotencySuffix?: string;
};

export type CreatePortalResult =
	| { kind: 'redirect'; url: string }
	| { kind: 'refused'; reason: 'no_customer' };

/**
 * Look up the user's cached Stripe customer id, or null. Distinct
 * from `ensureStripeCustomer`: we do NOT create one here. Opening the
 * Customer Portal for someone who has never had a subscription is a
 * UX dead-end (empty page) — we send them to /pricing instead.
 */
async function readCustomerForUser(userId: string): Promise<string | null> {
	const { data, error } = await withAdmin(
		'billing.portal.customer-lookup',
		'system',
		async (admin) =>
			admin
				.from('stripe_customers')
				.select('stripe_customer_id')
				.eq('user_id', userId)
				.maybeSingle()
	);
	if (error) {
		throw new Error(`[portal] readCustomerForUser failed for ${userId}: ${error.message}`);
	}
	return data?.stripe_customer_id ?? null;
}

/**
 * Create a Stripe Billing Portal session for the user and return the
 * one-shot URL. The URL is single-use and expires after a few
 * minutes — we DO NOT cache it; every "Manage billing" click mints a
 * fresh session.
 *
 * Idempotency-key: 5-minute bucket. The portal session URL itself
 * is single-use anyway, so wider buckets just hide the "user
 * actually clicked twice" story without saving any Stripe API cost.
 */
export async function createPortalSession(input: CreatePortalInput): Promise<CreatePortalResult> {
	const { user, origin, returnPath = '/account', idempotencySuffix } = input;

	const customerId = await readCustomerForUser(user.id);
	if (!customerId) {
		console.info('[portal] refusing — no Stripe customer for user', { user_id: user.id });
		return { kind: 'refused', reason: 'no_customer' };
	}

	const returnUrl = `${origin}${returnPath}`;

	// 5-minute bucket so an accidental double-click doesn't double-
	// log a portal-open in Stripe. After 5 minutes the user gets a
	// fresh session (single-use anyway, so this is fine).
	const minuteBucket = Math.floor(Date.now() / (5 * 60 * 1000));
	const idempotencyBase = `portal:user-${user.id}:bucket-${minuteBucket}`;
	const idempotencyKey = idempotencySuffix
		? `${idempotencyBase}:${idempotencySuffix}`
		: idempotencyBase;

	const session = await withIdempotencyKey(idempotencyKey, async (key) =>
		stripe().billingPortal.sessions.create(
			{
				customer: customerId,
				return_url: returnUrl
			},
			{ idempotencyKey: key }
		)
	);

	if (!session.url) {
		throw new Error(
			`[portal] Stripe returned a portal session without a url; session_id=${session.id}`
		);
	}

	console.info('[portal] session created', {
		user_id: user.id,
		session_id: session.id,
		customer: customerId,
		return_url: returnUrl,
		idempotency_key: idempotencyKey
	});

	return { kind: 'redirect', url: session.url };
}
