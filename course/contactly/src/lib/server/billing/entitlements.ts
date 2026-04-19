/**
 * Entitlements service — the snapshot every authenticated screen
 * reads to know "what is this user allowed to do?"
 *
 * Module 7.4 shipped two primitives:
 *   - `getActiveSubscription(userId)` — the row, or `null`.
 *   - `tierForUser(userId)` — `'starter' | 'pro' | 'business'`.
 *
 * This module composes both into a single `EntitlementSnapshot` with
 * the convenience fields the UI actually wants:
 *   - `tier`, `isPaid`, `isTrialing`, `status`
 *   - `badgeLabel`, `badgeTone`               (drives the AppNav badge)
 *   - `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEnd`, `priceId`
 *     (drives `/account` → "Plan" — Lesson 8.4)
 *
 * THE SNAPSHOT IS THE PUBLIC CONTRACT
 * -----------------------------------
 * Three call-sites consume `EntitlementSnapshot`:
 *
 *   1. `(app)/+layout.server.ts` — runs once per request, exposes
 *      the snapshot to every child page via `LayoutData`.
 *   2. `(app)/account/+page.server.ts` — reuses the snapshot from
 *      `parent()` to render the "current plan" section.
 *   3. `(app)/contacts/new/+page.server.ts` (Lesson 8.5) — reads
 *      `tier` from the snapshot to enforce the contact-list cap.
 *
 * Anything UI-specific (e.g. "renews in 12 days") that all three
 * call-sites would otherwise duplicate gets pre-computed here.
 *
 * PURE CORE, THIN ASYNC SHELL
 * ---------------------------
 * `snapshotFor` is the pure function — given `tier` + `subscription`
 * row, it returns the snapshot. `loadEntitlements` is the async
 * shell that fetches both inputs and calls the pure mapper. The
 * unit tests (`entitlements.test.ts`) hit `snapshotFor` directly,
 * so we never have to mock Supabase to assert e.g. "trialing is true
 * iff status === 'trialing' AND trial_end is in the future."
 *
 * FAIL-CLOSED ON THE ENTITLEMENT-DECISION SIDE
 * --------------------------------------------
 * `tierForUser` already falls back to `'starter'` on any unknown
 * lookup_key, unknown status, or DB miss (Lesson 7.4). This module
 * inherits that behavior — if `loadEntitlements` cannot answer with
 * confidence, the user gets the Starter tier and the gate refuses
 * the action. That's the right default for billing: never grant a
 * paid feature on uncertainty.
 */
import type { Database } from '$lib/database.types';
import type { Tier } from '$lib/billing/lookup-keys';
import { getActiveSubscription, tierForUser } from '$lib/server/billing/subscriptions';

type SubscriptionRow = Database['public']['Tables']['stripe_subscriptions']['Row'];
type SubscriptionStatus = Database['public']['Enums']['stripe_subscription_status'];

/**
 * Tones the badge can take. Drives `cn()` in AppNav and `/account`.
 *
 *   - `starter` — neutral. "Starter".
 *   - `paid`    — solid brand fill. "Pro" / "Business" on a
 *                 healthy active subscription.
 *   - `trial`   — same color as `paid` but with an outline + label
 *                 suffix ("Pro · Trial") to signal "this user is on
 *                 a paid tier conditionally."
 *   - `past_due` — amber. "Pro · Past due". The user keeps the
 *                  paid tier (Stripe is the boss; they retry the
 *                  invoice; we don't gate UX while that's in
 *                  flight) but we want them to see the warning
 *                  so they update payment before grace expires.
 */
export type BadgeTone = 'starter' | 'paid' | 'trial' | 'past_due';

export type EntitlementSnapshot = {
	tier: Tier;
	/** True iff `tier !== 'starter'`. Convenience for `{#if isPaid}`. */
	isPaid: boolean;
	/**
	 * True iff the user is currently on an active paid subscription
	 * whose status is `'trialing'`. Different from `isPaid` (a
	 * trialing user IS paid) — this powers the "Trial ends in N days"
	 * surfaces.
	 */
	isTrialing: boolean;
	/** Raw Stripe status, or `null` for Starter (no subscription). */
	status: SubscriptionStatus | null;

	/** Display name shown in the badge. */
	badgeLabel: 'Starter' | 'Pro' | 'Business';
	/** Drives the badge's color/style — see `BadgeTone` doc above. */
	badgeTone: BadgeTone;

	/** ISO-8601. The next billing date. `null` for Starter. */
	currentPeriodEnd: string | null;
	/** True iff the user has clicked "cancel" but the period hasn't ended yet. */
	cancelAtPeriodEnd: boolean;
	/** ISO-8601. Trial end timestamp; `null` outside a trial. */
	trialEnd: string | null;
	/** The Stripe price ID powering the active subscription, or `null` for Starter. */
	priceId: string | null;
};

/** Map a paid Tier to its display name. */
const PAID_LABEL: Record<Exclude<Tier, 'starter'>, 'Pro' | 'Business'> = {
	pro: 'Pro',
	business: 'Business'
};

/**
 * Pure mapper from `(tier, subscription)` to a snapshot. Handles every
 * edge case the UI cares about:
 *
 *   - Starter (no subscription) → Starter badge, no period fields.
 *   - tier=Pro, subscription=null (e.g. price->tier resolved fine but
 *     active subscription was archived between the two calls) → fall
 *     back to Starter; we trust the *active subscription* row over
 *     `tierForUser`'s last reading. (`tierForUser` reads
 *     `getActiveSubscription` itself, so this branch is rare; the
 *     fallback is defense-in-depth.)
 *   - tier=Pro/Business, subscription set → derive isTrialing,
 *     period_end, etc. from the subscription row.
 *
 * Pure → unit-tested without a database.
 */
export function snapshotFor(args: {
	tier: Tier;
	subscription: SubscriptionRow | null;
}): EntitlementSnapshot {
	const { tier, subscription } = args;

	// Defensive: we should never see a paid tier without a row, but
	// if we do, treat it as starter rather than guess at fields.
	if (tier === 'starter' || !subscription) {
		return {
			tier: 'starter',
			isPaid: false,
			isTrialing: false,
			status: null,
			badgeLabel: 'Starter',
			badgeTone: 'starter',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			trialEnd: null,
			priceId: null
		};
	}

	const isTrialing = subscription.status === 'trialing';
	const tone: BadgeTone =
		subscription.status === 'past_due' ? 'past_due' : isTrialing ? 'trial' : 'paid';

	return {
		tier,
		isPaid: true,
		isTrialing,
		status: subscription.status,
		badgeLabel: PAID_LABEL[tier],
		badgeTone: tone,
		currentPeriodEnd: subscription.current_period_end,
		cancelAtPeriodEnd: subscription.cancel_at_period_end,
		trialEnd: subscription.trial_end,
		priceId: subscription.price_id
	};
}

/**
 * Async shell — fetch the two inputs in parallel and hand them to
 * `snapshotFor`. Used by `(app)/+layout.server.ts` and `/account`.
 *
 * Parallel because the two queries hit different tables and have no
 * dependency between them; sequential `await` would double the
 * layout's load latency for no benefit. Both calls are themselves
 * fronted by `withAdmin` so they share a single service-role client
 * instance.
 */
export async function loadEntitlements(userId: string): Promise<EntitlementSnapshot> {
	const [tier, subscription] = await Promise.all([
		tierForUser(userId),
		getActiveSubscription(userId)
	]);
	return snapshotFor({ tier, subscription });
}
