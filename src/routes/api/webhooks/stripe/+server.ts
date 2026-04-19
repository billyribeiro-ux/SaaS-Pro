import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';
import { upsertPrice, upsertProduct } from '$server/billing/products.service';
import {
	markSubscriptionDeleted,
	upsertSubscription
} from '$server/billing/subscriptions.service';

// Stripe webhook handler. Verifies the signature, then dispatches to service
// methods that own the DB writes. Must return 200 quickly; retries are expensive.
// Any handler that throws will result in a 500 so Stripe retries — that's the
// desired behavior for transient failures.

const HANDLED_EVENT_TYPES = new Set([
	'product.created',
	'product.updated',
	'product.deleted',
	'price.created',
	'price.updated',
	'price.deleted',
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.paused',
	'customer.subscription.resumed',
	'invoice.payment_succeeded',
	'invoice.payment_failed'
]);

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		return new Response('Missing stripe-signature header', { status: 400 });
	}

	const rawBody = await request.text();

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET!);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown signature error';
		console.warn('[stripe webhook] signature verification failed:', message);
		return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
	}

	if (!HANDLED_EVENT_TYPES.has(event.type)) {
		// Unhandled type — ack so Stripe stops retrying.
		return new Response('ok', { status: 200 });
	}

	// Idempotency: Stripe delivers at-least-once. A unique insert on event.id
	// means the second delivery trips the PK constraint and we ack without
	// re-running the handler. `stripe_events` isn't in the generated types yet,
	// so we escape the schema-aware builder for this one call.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const insertResult = await (supabaseAdmin as any)
		.from('stripe_events')
		.insert({ id: event.id, type: event.type });
	if (insertResult.error) {
		// Postgres unique_violation (23505) — already processed, ack cleanly.
		if ((insertResult.error as { code?: string }).code === '23505') {
			return new Response('ok', { status: 200 });
		}
		console.error('[stripe webhook] idempotency insert failed:', insertResult.error);
		// Don't block processing on ledger failure — retries are safe at the handler layer.
	}

	try {
		switch (event.type) {
			case 'product.created':
			case 'product.updated':
			case 'product.deleted': {
				await upsertProduct(event.data.object as Stripe.Product);
				break;
			}
			case 'price.created':
			case 'price.updated':
			case 'price.deleted': {
				await upsertPrice(event.data.object as Stripe.Price);
				break;
			}
			case 'checkout.session.completed': {
				const session = event.data.object as Stripe.Checkout.Session;
				if (session.mode === 'subscription' && session.subscription) {
					const subscriptionId =
						typeof session.subscription === 'string'
							? session.subscription
							: session.subscription.id;
					const sub = await stripe.subscriptions.retrieve(subscriptionId);
					await upsertSubscription(sub);
				}
				break;
			}
			case 'customer.subscription.created':
			case 'customer.subscription.updated':
			case 'customer.subscription.paused':
			case 'customer.subscription.resumed': {
				await upsertSubscription(event.data.object as Stripe.Subscription);
				break;
			}
			case 'customer.subscription.deleted': {
				await markSubscriptionDeleted(event.data.object as Stripe.Subscription);
				break;
			}
			case 'invoice.payment_succeeded':
			case 'invoice.payment_failed': {
				// Under 2026-03-25.dahlia the subscription id moved to
				// invoice.parent.subscription_details.subscription. Older SDK payloads
				// still expose it at the top level; check both so webhook replay across
				// API versions keeps working.
				const invoice = event.data.object as Stripe.Invoice & {
					subscription?: string | Stripe.Subscription | null;
					parent?: {
						subscription_details?: {
							subscription?: string | Stripe.Subscription | null;
						} | null;
					} | null;
				};
				const fromParent = invoice.parent?.subscription_details?.subscription ?? null;
				const subRef = fromParent ?? invoice.subscription ?? null;
				if (subRef) {
					const subscriptionId = typeof subRef === 'string' ? subRef : subRef.id;
					const sub = await stripe.subscriptions.retrieve(subscriptionId);
					await upsertSubscription(sub);
				}
				break;
			}
		}
	} catch (error) {
		console.error(`[stripe webhook] handler failed for ${event.type}:`, error);
		return new Response('Webhook handler error', { status: 500 });
	}

	return new Response('ok', { status: 200 });
};
