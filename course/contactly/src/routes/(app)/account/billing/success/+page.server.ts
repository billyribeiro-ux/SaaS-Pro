/**
 * Post-checkout success page — `/account/billing/success?session_id=cs_…`
 *
 * Stripe redirects the user here from a successful Checkout via the
 * `success_url` we set in `buildSubscriptionCheckoutParams`
 * (Lesson 9.1). The job of this `load` is to:
 *
 *   1. Validate the `session_id` query parameter belongs to *this*
 *      authenticated user — no peeking at someone else's session.
 *   2. Retrieve the session from Stripe (with subscription expanded)
 *      so we can show "what you bought" without depending on the
 *      `customer.subscription.created` webhook having landed yet.
 *   3. Build a tiny view-model for the page: tier / interval / trial
 *      end / next-renewal headline.
 *
 * WHY NOT JUST READ FROM `loadEntitlements`?
 * ------------------------------------------
 * Because there is a real, observable race: Stripe redirects the
 * user the moment the Checkout Session completes, but the
 * `customer.subscription.created` webhook arrives milliseconds-to-
 * seconds later. If we relied solely on the local mirror, a fast
 * user would land on the success page with `tier=starter` (the
 * snapshot fallback) until the webhook caught up — which reads as
 * "your payment failed" to a normal human.
 *
 * Reading the session directly from Stripe sidesteps the race
 * entirely. The mirror is still the source of truth for everything
 * downstream (entitlements, plan badge, contact-cap); the success
 * page is the ONE place we deliberately reach back out to Stripe
 * for an authoritative "what just happened."
 *
 * Once entitlements catch up, the page is happy to use them — the
 * view-model prefers the local snapshot's interval/tier when they
 * agree with the session, falling back to the session-derived ones
 * when the snapshot still says "starter."
 *
 * SECURITY: `client_reference_id` IS THE OWNERSHIP TOKEN
 * ------------------------------------------------------
 * Anyone can guess (or get phished into clicking) a `cs_…` URL.
 * We refuse to render the page unless the session's
 * `client_reference_id` (set by `buildSubscriptionCheckoutParams`
 * to `userId`) matches the authenticated user. This stops:
 *
 *   - Logged-in user A from confirming user B's subscription.
 *   - A success-page link from being a side-channel that leaks
 *     billing metadata across accounts.
 *
 * Policy refusals throw `error(404)`, NOT 403, to avoid revealing
 * whether the session id exists in our system.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { stripe } from '$lib/server/stripe';
import {
	isLookupKey,
	parseLookupKey,
	type Tier,
	type BillingInterval
} from '$lib/billing/lookup-keys';
import { formatCurrency } from '$lib/billing/catalog';

/**
 * Loose check before we hand the value to Stripe — they'll reject a
 * malformed id with a 400 anyway, but doing it here means we can
 * 404 with our own message instead of bubbling a Stripe API error.
 */
function isPlausibleSessionId(value: string): boolean {
	return /^cs_[A-Za-z0-9_]+$/.test(value);
}

export type SuccessViewModel = {
	tier: Tier;
	tierLabel: 'Pro' | 'Business';
	interval: BillingInterval;
	priceHeadline: string | null;
	/** ISO-8601. Set when the subscription is currently in trial. */
	trialEndIso: string | null;
	/** ISO-8601. Always set; falls back to trial_end for trialing subs. */
	nextChargeIso: string | null;
	/** Last 4 of the captured card if Stripe expanded it; else null. */
	cardLast4: string | null;
	/** ISO 4217 currency code, lowercase, for downstream formatting. */
	currency: string;
	customerEmail: string | null;
};

export const load: PageServerLoad = async ({ url, parent }) => {
	const { user } = await parent();

	const sessionId = url.searchParams.get('session_id');
	if (!sessionId || !isPlausibleSessionId(sessionId)) {
		// Bad/empty `session_id`. Either the user navigated here
		// directly or the redirect was tampered with. Send them to
		// /account where the plan badge tells them their real state.
		redirect(303, '/account');
	}

	let session;
	try {
		session = await stripe().checkout.sessions.retrieve(sessionId, {
			// `subscription` for trial_end / current_period; the
			// default expansion already includes the line items.
			// `payment_intent.latest_charge.payment_method_details`
			// is how we recover "Visa ending 4242" without a second
			// API call. (Optional — present after a paid session,
			// absent during a $0 trial start.)
			expand: [
				'subscription.items.data.price',
				'payment_intent.latest_charge.payment_method_details'
			]
		});
	} catch (err) {
		console.warn('[billing/success] Stripe session retrieve failed', {
			user_id: user.id,
			session_id: sessionId,
			err: err instanceof Error ? err.message : String(err)
		});
		// Don't 502 — this page is reachable from a phishing-like
		// guess too. 404 keeps it indistinguishable from "no such
		// session".
		error(404, 'We could not find that checkout session.');
	}

	// Ownership check: the session must have been created for this
	// user. `client_reference_id` is set by our checkout builder.
	if (session.client_reference_id !== user.id) {
		console.warn('[billing/success] ownership mismatch — refusing to render', {
			user_id: user.id,
			session_id: sessionId,
			client_reference_id: session.client_reference_id
		});
		error(404, 'We could not find that checkout session.');
	}

	// `payment_status` of `paid` (immediate charge, e.g. annual no-trial)
	// or `no_payment_required` (trial start, $0 today) both mean the
	// session completed successfully. Anything else means the user
	// landed here through a prematurely-followed link or a Stripe
	// race — bounce them back to /account.
	if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
		console.info('[billing/success] session not yet completed; bouncing to /account', {
			user_id: user.id,
			session_id: sessionId,
			payment_status: session.payment_status
		});
		redirect(303, '/account');
	}

	const lookupKeyMeta = session.metadata?.lookup_key;
	if (!isLookupKey(lookupKeyMeta)) {
		// Should never happen — every session we mint includes
		// `metadata.lookup_key`. Loud failure if it doesn't.
		console.error('[billing/success] missing/invalid lookup_key in session metadata', {
			user_id: user.id,
			session_id: sessionId,
			lookup_key: lookupKeyMeta ?? null
		});
		error(500, 'Checkout completed but we could not identify the plan. Support has been notified.');
	}

	// `parseLookupKey` is already typed `tier: 'pro' | 'business'`
	// (Starter has no Stripe price → no lookup key), so we can use
	// it directly without an extra runtime guard.
	const { tier, interval } = parseLookupKey(lookupKeyMeta);

	const subscription = typeof session.subscription === 'string' ? null : session.subscription;
	const item = subscription?.items?.data?.[0];
	const itemPrice = item?.price;

	const priceHeadline =
		itemPrice && typeof itemPrice.unit_amount === 'number'
			? formatCurrency(itemPrice.unit_amount, itemPrice.currency, interval)
			: null;

	const trialEndIso = subscription?.trial_end
		? new Date(subscription.trial_end * 1000).toISOString()
		: null;

	const nextChargeIso = trialEndIso
		? trialEndIso
		: item?.current_period_end
			? new Date(item.current_period_end * 1000).toISOString()
			: null;

	const customerEmail =
		session.customer_details?.email ??
		(typeof session.customer === 'object' && session.customer && !('deleted' in session.customer)
			? (session.customer.email ?? null)
			: null);

	const paymentIntent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
	const latestCharge =
		paymentIntent && typeof paymentIntent.latest_charge === 'object'
			? paymentIntent.latest_charge
			: null;
	const cardLast4 =
		latestCharge?.payment_method_details?.card?.last4 ??
		(session.payment_method_types?.includes('card') ? null : null);

	const view: SuccessViewModel = {
		tier,
		tierLabel: tier === 'pro' ? 'Pro' : 'Business',
		interval,
		priceHeadline,
		trialEndIso,
		nextChargeIso,
		cardLast4,
		currency: itemPrice?.currency ?? 'usd',
		customerEmail
	};

	return { view };
};
