/**
 * Stripe webhook event dispatch.
 *
 * Splits the routing table out of `+server.ts` so the HTTP layer
 * (signature verification, status codes, header parsing) and the
 * business layer (what we do when we receive `invoice.paid`) can
 * evolve and be tested independently.
 *
 * What's HERE (Module 6.3):
 *  - The list of event types Contactly subscribes to.
 *  - Stub handlers that just log `[stripe-webhook] received: …`.
 *  - The `dispatchStripeEvent` orchestrator that picks the right
 *    handler, runs it, and surfaces "unhandled" vs "handler-error"
 *    distinctly.
 *
 * What's been added (Module 7+):
 *  - product.* / price.* handlers wired to the products service       — Module 7.2
 *  - customer.* handlers wired to the customers service                — Module 7.3
 *  - customer.subscription.* handlers wired to the subscriptions svc   — Module 7.4
 *
 * What's NOT here yet:
 *  - Email side-effects (trial-ending, dunning)                        — Modules 9.4 / 10
 *
 * Each stub handler is the deliberate landing pad for the future
 * lesson that fills it in. Keep the signatures stable so those
 * lessons are pure additions, not refactors.
 */
import type Stripe from 'stripe';

import {
	deleteStripePrice,
	deleteStripeProduct,
	upsertStripePrice,
	upsertStripeProduct
} from '$lib/server/billing/products';
import {
	handleCustomerCreated,
	handleCustomerDeleted,
	handleCustomerUpdated
} from '$lib/server/billing/customers';
import {
	handleSubscriptionDeleted,
	handleSubscriptionTrialWillEnd,
	upsertSubscription
} from '$lib/server/billing/subscriptions';

/**
 * The exhaustive set of Stripe event types Contactly listens for.
 *
 * Adding to this list is a deliberate act: every entry must have a
 * corresponding handler in `EVENT_HANDLERS` below, and `tsc` enforces
 * that 1:1 via the index signature on `EventHandlers`.
 *
 * Keep this list aligned with the Dashboard endpoint configuration
 * (Module 12.5) — events the Dashboard sends but we don't list here
 * fall through to the "unhandled" path; events we list but the
 * Dashboard isn't subscribed to never arrive at all (still safe).
 */
export const SUBSCRIBED_EVENTS = [
	// Catalog mirroring (Module 7.2). Both `created` and `updated`
	// route through the same upsert; `deleted` archives the local
	// row so the pricing page stops rendering it.
	'product.created',
	'product.updated',
	'product.deleted',
	'price.created',
	'price.updated',
	'price.deleted',
	// Customer mapping mirror (Module 7.3). `customer.created` is
	// largely redundant with the upsert inside ensureStripeCustomer
	// but keeps Dashboard-created customers in sync.
	'customer.created',
	'customer.updated',
	'customer.deleted',
	// Checkout completion (Module 9.1).
	'checkout.session.completed',
	// Subscription mirror (Module 7.4).
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.trial_will_end',
	// Invoice notifications (Modules 9.5 / 10).
	'invoice.paid',
	'invoice.payment_failed'
] as const;

export type SubscribedEventType = (typeof SUBSCRIBED_EVENTS)[number];

/**
 * Narrow `string`-typed `event.type` (which is the entire Stripe
 * event-type union, ~250 strings) down to "is this one we care
 * about" so the dispatcher can `switch` on a small enum.
 */
export function isSubscribedEvent(type: string): type is SubscribedEventType {
	return (SUBSCRIBED_EVENTS as readonly string[]).includes(type);
}

/**
 * Per-event-type handler shape.
 *
 * `Extract<Stripe.Event, { type: K }>` uses Stripe SDK v22's
 * discriminated `Stripe.Event` union to give each handler the exact
 * event variant for its key — so `event.data.object` is correctly
 * typed (`Stripe.Product`, `Stripe.Subscription`, etc.) without any
 * casts at the call site.
 *
 * Returns void; throws on failure. The +server.ts handler converts a
 * thrown error into a 500 (so Stripe retries with backoff) and a
 * clean return into a 200.
 */
type HandlerFor<K extends SubscribedEventType> = (
	event: Extract<Stripe.Event, { type: K }>
) => Promise<void>;

/**
 * Type-level guard that the dispatch table covers every subscribed
 * event. If you add a string to `SUBSCRIBED_EVENTS` without adding
 * the corresponding entry below, `tsc` flags it.
 */
type EventHandlers = { [K in SubscribedEventType]: HandlerFor<K> };

/**
 * Module 6.4+ replaces these stub bodies with real DB writes. The
 * `console.info` stays around for human-visible feedback during
 * `pnpm run stripe:trigger` rehearsals; structured logging (Module 12)
 * supersedes it for production observability.
 */
const EVENT_HANDLERS: EventHandlers = {
	'product.created': async (event) => {
		await upsertStripeProduct(event.data.object);
	},
	'product.updated': async (event) => {
		await upsertStripeProduct(event.data.object);
	},
	'product.deleted': async (event) => {
		await deleteStripeProduct(event.data.object.id);
	},
	'price.created': async (event) => {
		await upsertStripePrice(event.data.object);
	},
	'price.updated': async (event) => {
		await upsertStripePrice(event.data.object);
	},
	'price.deleted': async (event) => {
		await deleteStripePrice(event.data.object.id);
	},
	'customer.created': async (event) => {
		await handleCustomerCreated(event.data.object);
	},
	'customer.updated': async (event) => {
		await handleCustomerUpdated(event.data.object);
	},
	'customer.deleted': async (event) => {
		// At runtime Stripe sends a `DeletedCustomer` payload (id +
		// `deleted: true`), but the SDK types `data.object` as
		// `Stripe.Customer` for ergonomics in the discriminated union.
		// `handleCustomerDeleted` accepts either shape — only `.id` is
		// read, which is present on both.
		await handleCustomerDeleted(event.data.object);
	},
	'checkout.session.completed': async (event) => {
		const session = event.data.object;
		console.info('[stripe-webhook] checkout.session.completed', {
			id: event.id,
			session: session.id,
			customer: session.customer,
			mode: session.mode
		});
	},
	'customer.subscription.created': async (event) => {
		await upsertSubscription(event.data.object);
	},
	'customer.subscription.updated': async (event) => {
		await upsertSubscription(event.data.object);
	},
	'customer.subscription.deleted': async (event) => {
		await handleSubscriptionDeleted(event.data.object);
	},
	'customer.subscription.trial_will_end': async (event) => {
		await handleSubscriptionTrialWillEnd(event.data.object);
	},
	'invoice.paid': async (event) => {
		const inv = event.data.object;
		console.info('[stripe-webhook] invoice.paid', {
			id: event.id,
			invoice: inv.id,
			customer: inv.customer,
			amount_paid: inv.amount_paid
		});
	},
	'invoice.payment_failed': async (event) => {
		const inv = event.data.object;
		console.info('[stripe-webhook] invoice.payment_failed', {
			id: event.id,
			invoice: inv.id,
			customer: inv.customer,
			attempt_count: inv.attempt_count
		});
	}
};

export type DispatchResult =
	| { kind: 'handled'; type: SubscribedEventType }
	| { kind: 'unhandled'; type: string };

/**
 * Route an authenticated, signature-verified Stripe event to its
 * handler.
 *
 * Throws on handler failure — caller (+server.ts) catches and returns
 * 500 so Stripe schedules a retry. Returns a `DispatchResult` so the
 * caller can choose how to log (`handled` is info-level, `unhandled`
 * is debug-level, never warn — silently ignoring an event we don't
 * care about is the *intended* behavior, not an anomaly).
 */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<DispatchResult> {
	if (!isSubscribedEvent(event.type)) {
		return { kind: 'unhandled', type: event.type };
	}
	// Indexing `EVENT_HANDLERS` with a narrowed `event.type` collapses
	// the per-key handler types back into their union — TS can't see
	// that the event we hold matches the one this entry expects, even
	// though by construction it does. The cast is the runtime no-op
	// required to bridge that type gap.
	const handler = EVENT_HANDLERS[event.type] as HandlerFor<typeof event.type>;
	await handler(event as Extract<Stripe.Event, { type: typeof event.type }>);
	return { kind: 'handled', type: event.type };
}
