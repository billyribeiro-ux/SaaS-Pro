/**
 * Checkout service — turn an authenticated user + a `LookupKey` into
 * a redirectable Stripe Checkout Session URL.
 *
 * SCOPE
 * -----
 * One operation: `createSubscriptionCheckoutSession({ user, lookupKey,
 * origin, idempotencySuffix? })`. Two outcomes:
 *
 *   - `{ kind: 'redirect', url }` — created (or coalesced via Stripe's
 *     idempotency cache); caller 303s the browser to `url`.
 *   - `{ kind: 'refused', reason: 'already_subscribed' }` — the user
 *     already has a `trialing | active | past_due` subscription; the
 *     UI should send them to the Billing Portal (Lesson 9.3) instead.
 *
 * No throws on user-visible policy refusals — those are *expected
 * outcomes* and pollute call-sites if dressed up as exceptions. Throws
 * are reserved for environment / Stripe-API failures.
 *
 * STRIPE INTEGRATION SHAPE
 * ------------------------
 * Per the Stripe billing reference + ADR-007:
 *   - `mode: 'subscription'` — Billing APIs handle renewal, dunning,
 *     proration. Never roll our own renewal loop.
 *   - `automatic_tax: { enabled: true }` + `customer_update.address` so
 *     Stripe Tax can compute the correct line at checkout (ADR-006).
 *   - `billing_address_collection: 'required'` — required for tax
 *     calc and saved on the Customer for future invoices.
 *   - `subscription_data.trial_period_days: 14` — every paid plan has
 *     a 14-day trial (ADR-007). The serial-trial guard in Lesson 9.4
 *     makes this `0` if the user has used their trial.
 *   - `allow_promotion_codes: true` — operator-controlled; promotion
 *     codes are managed in the Stripe Dashboard.
 *   - `payment_method_collection: 'always'` — yes even with a trial.
 *     Capturing the card up-front converts ~3-5x better than "card
 *     required at trial end" because trial-start friction equals
 *     conversion friction.
 *   - `metadata: { user_id, lookup_key, tier, interval }` — denorm so
 *     the success page and audit log don't need to call back to
 *     Stripe to recover what the user was trying to buy.
 *   - `client_reference_id: user_id` — Stripe surfaces this in their
 *     Dashboard search. Free correlation for support tickets.
 *
 * IDEMPOTENCY
 * -----------
 * Two flavors stack:
 *
 *   1. **Stripe Idempotency-Key** on the API call itself. We derive it
 *      from `(intent, user_id, lookup_key, day)` — within 24h, the
 *      same triple returns the same Checkout Session. A double-click
 *      on Upgrade therefore opens the SAME hosted page, not two.
 *      Optional `idempotencySuffix` lets a future retry-button
 *      explicitly create a NEW session.
 *
 *   2. **Local pre-check** for "already has an active subscription".
 *      Stripe will happily let a user open a second Checkout Session
 *      on top of an existing subscription; we refuse it server-side
 *      so the user lands in the Billing Portal instead, where they
 *      can change plan with proration.
 *
 * The DB-level `stripe_subscriptions_one_active_per_user` partial
 * unique index from Lesson 7.1 is the third line of defense — even
 * if both checks somehow regress and a duplicate subscription is
 * created in Stripe, the mirror upsert refuses to land it.
 */
import type Stripe from 'stripe';
import { stripe, withIdempotencyKey } from '$lib/server/stripe';
import { ensureStripeCustomer } from '$lib/server/billing/customers';
import { getActiveSubscription } from '$lib/server/billing/subscriptions';
import { withAdmin } from '$lib/server/supabase-admin';
import {
	type LookupKey,
	type Tier,
	type BillingInterval,
	parseLookupKey
} from '$lib/billing/lookup-keys';

/**
 * Inputs to a checkout session creation. `origin` lives on the input
 * (rather than being grabbed from `$env`) because per-request `origin`
 * differs across preview deploys, custom domains, and `localhost` — we
 * do NOT want a stale `PUBLIC_APP_URL` to send a Vercel preview user
 * back to production after they pay.
 */
export type CreateCheckoutInput = {
	user: { id: string; email: string | null };
	lookupKey: LookupKey;
	origin: string;
	/**
	 * Optional disambiguator for the Stripe idempotency key. Default
	 * shape coalesces same-day double-submits to the same session
	 * URL; pass a fresh value when the user explicitly retries.
	 */
	idempotencySuffix?: string;
};

export type CreateCheckoutResult =
	| { kind: 'redirect'; url: string; sessionId: string }
	| { kind: 'refused'; reason: 'already_subscribed' };

/**
 * Resolve a `LookupKey` to a Stripe `price_…` id by reading the local
 * mirror. We MUST go through `lookup_key` (Lesson 5.6) — never accept
 * `price_…` from the request, never hard-code price ids.
 *
 * Returns `null` if the lookup key isn't in our mirror; caller throws
 * with context (this is an operational misconfiguration: fixtures
 * weren't seeded, webhooks missed the price.created event, etc.).
 */
async function priceIdForLookupKey(lookupKey: LookupKey): Promise<string | null> {
	const { data, error } = await withAdmin(
		'billing.checkout.price-lookup',
		'system',
		async (admin) =>
			admin
				.from('stripe_prices')
				.select('id, active')
				.eq('lookup_key', lookupKey)
				.eq('active', true)
				.maybeSingle()
	);
	if (error) {
		throw new Error(
			`[checkout] priceIdForLookupKey(${lookupKey}) failed: ${error.message}. ` +
				`Local price mirror may be out of sync — run \`pnpm run stripe:fixtures\` ` +
				`and confirm webhooks have caught up.`
		);
	}
	return data?.id ?? null;
}

/**
 * Build the Stripe Checkout Session create-params for a Contactly
 * subscription. Pure: no I/O, no `Date.now()`, no env reads — every
 * dynamic input is a function argument. This is what the unit test
 * exercises, so the integration flow doesn't need to mock Stripe.
 */
export function buildSubscriptionCheckoutParams(args: {
	customerId: string;
	priceId: string;
	lookupKey: LookupKey;
	tier: Tier;
	interval: BillingInterval;
	userId: string;
	origin: string;
	trialPeriodDays: number;
}): Stripe.Checkout.SessionCreateParams {
	const { customerId, priceId, lookupKey, tier, interval, userId, origin, trialPeriodDays } = args;

	const successUrl = `${origin}/account/billing/success?session_id={CHECKOUT_SESSION_ID}`;
	const cancelUrl = `${origin}/pricing?checkout=cancelled`;

	const subscriptionData: NonNullable<Stripe.Checkout.SessionCreateParams['subscription_data']> = {
		// `tier_snapshot` mirrors the same field on stripe_subscriptions
		// for analytics-on-creation; the *authoritative* tier is still
		// derived from price → lookup_key in code.
		metadata: {
			user_id: userId,
			lookup_key: lookupKey,
			tier,
			interval
		},
		description: `Contactly ${tier === 'pro' ? 'Pro' : 'Business'} (${interval})`
	};

	if (trialPeriodDays > 0) {
		subscriptionData.trial_period_days = trialPeriodDays;
		// If we ever want "trial without card", set this to 'pause'.
		// We default to 'create_invoice' (the SDK default), which means
		// at trial end Stripe charges the captured card automatically.
	}

	return {
		mode: 'subscription',
		customer: customerId,
		client_reference_id: userId,
		// The exact line items are derived from the lookup key, not
		// the request — the user can't switch plans by editing the form.
		line_items: [{ price: priceId, quantity: 1 }],
		// ADR-006: Stripe Tax is the only sane choice for a
		// US-multi-state SaaS. Required: address collection so Stripe
		// has the inputs to compute the correct rate.
		automatic_tax: { enabled: true },
		billing_address_collection: 'required',
		// Save the address the customer enters back onto the Customer
		// object so subsequent invoices use it without re-prompting.
		customer_update: { address: 'auto', name: 'auto' },
		// Operator-managed — codes are created in the Dashboard.
		allow_promotion_codes: true,
		// Required-card-during-trial: see file header.
		payment_method_collection: 'always',
		// Top-level metadata so the `checkout.session.completed`
		// webhook handler can audit without re-fetching.
		metadata: {
			user_id: userId,
			lookup_key: lookupKey,
			tier,
			interval
		},
		subscription_data: subscriptionData,
		success_url: successUrl,
		cancel_url: cancelUrl,
		// Lock the language; matches our locale-stable currency
		// formatting on the pricing page.
		locale: 'en'
	};
}

/**
 * Create-or-coalesce a Stripe Checkout Session for the given user +
 * lookup key. See file header for the contract.
 */
export async function createSubscriptionCheckoutSession(
	input: CreateCheckoutInput
): Promise<CreateCheckoutResult> {
	const { user, lookupKey, origin, idempotencySuffix } = input;

	// === 1. Refuse if already subscribed.
	const existing = await getActiveSubscription(user.id);
	if (existing) {
		console.info('[checkout] refusing — user already has an active subscription', {
			user_id: user.id,
			subscription_id: existing.id,
			status: existing.status
		});
		return { kind: 'refused', reason: 'already_subscribed' };
	}

	// === 2. Resolve lookup_key → price_id (mirror).
	const priceId = await priceIdForLookupKey(lookupKey);
	if (!priceId) {
		throw new Error(
			`[checkout] no active price found for lookup_key=${lookupKey}. ` +
				`Did you run \`pnpm run stripe:fixtures\` and let webhooks catch up?`
		);
	}

	const { tier, interval } = parseLookupKey(lookupKey);

	// === 3. Ensure the Stripe customer exists for this user.
	const customerId = await ensureStripeCustomer({ userId: user.id, email: user.email });

	// === 4. Trial logic. ADR-007 says "every paid plan has a 14-day
	// trial" — the serial-trial guard from Lesson 9.4 will replace
	// this constant with a runtime check; for this lesson it's the
	// flat 14.
	const trialPeriodDays = 14;

	// === 5. Build params + create session with idempotency.
	const params = buildSubscriptionCheckoutParams({
		customerId,
		priceId,
		lookupKey,
		tier,
		interval,
		userId: user.id,
		origin,
		trialPeriodDays
	});

	// Day-bucketed key: same user + lookup_key within the same UTC day
	// returns the same Checkout Session URL. After 24h, Stripe expires
	// the cache — a user retrying tomorrow gets a fresh session.
	const day = new Date().toISOString().slice(0, 10);
	const idempotencyBase = `checkout:user-${user.id}:lk-${lookupKey}:${day}`;
	const idempotencyKey = idempotencySuffix
		? `${idempotencyBase}:${idempotencySuffix}`
		: idempotencyBase;

	const session = await withIdempotencyKey(idempotencyKey, async (key) =>
		stripe().checkout.sessions.create(params, { idempotencyKey: key })
	);

	if (!session.url) {
		// Hosted Checkout sessions ALWAYS have a `url`. If we ever see
		// `null` here, Stripe's API contract changed underneath us and
		// we want loud failure, not a silent no-op redirect.
		throw new Error(
			`[checkout] Stripe returned a session without a hosted url; session_id=${session.id}`
		);
	}

	console.info('[checkout] session created', {
		user_id: user.id,
		session_id: session.id,
		lookup_key: lookupKey,
		tier,
		interval,
		idempotency_key: idempotencyKey
	});

	return { kind: 'redirect', url: session.url, sessionId: session.id };
}
