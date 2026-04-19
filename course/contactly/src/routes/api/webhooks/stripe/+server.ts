/**
 * Stripe webhook receiver.
 *
 * The lone POST endpoint Stripe's servers (or `stripe listen`) call
 * with HMAC-SHA256-signed event payloads. The full theory of what
 * "signed", "idempotent", and "untrusted-by-default" mean is in
 * `docs/stripe/08-webhooks-and-events.md`; this file is the *code*
 * implementation.
 *
 * STEP-BY-STEP:
 *
 *   1. Pull `Stripe-Signature` header. Missing → 400.
 *   2. Read raw body via `request.text()`. NEVER `request.json()`
 *      — the JSON round-trip rewrites whitespace and breaks the HMAC.
 *      The whole signature scheme depends on the bytes Stripe sent
 *      being the bytes we hash.
 *   3. Verify with `stripe.webhooks.constructEventAsync(body, sig,
 *      secret)`. Failure → 400.
 *   4. Dispatch the event to the typed handler table in
 *      `$lib/server/stripe-events`. Handler errors → 500 (Stripe
 *      retries with backoff).
 *   5. Return `200 { received: true }` so Stripe stops retrying.
 *
 * WHAT'S NOT HERE YET:
 *
 *  - Storage idempotency: we'll insert into `stripe_events` *before*
 *    dispatching in Module 6.4, so duplicate deliveries hit a unique
 *    constraint and skip the side effect entirely.
 *  - Real DB writes: Modules 7.3 / 7.4 fill in the dispatch table
 *    bodies; the routing here doesn't change.
 */
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { stripe } from '$lib/server/stripe';
import { serverEnv } from '$lib/server/env';
import { dispatchStripeEvent } from '$lib/server/stripe-events';
import { markStripeEventProcessed, recordStripeEvent } from '$lib/server/stripe-events-store';

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		// No `stripe-signature` header at all means this isn't a real
		// Stripe delivery — almost certainly a curl/scanner probe.
		// 400 (not 401) because there's no auth scheme to challenge;
		// the request is just malformed.
		throw error(400, 'Missing stripe-signature header');
	}

	// `request.text()` returns the body as the exact bytes Stripe
	// sent, in the encoding Stripe sent them. Any other accessor
	// (json/formData) re-parses or re-decodes and the HMAC stops
	// matching. This is the single most common Stripe-webhook bug.
	const rawBody = await request.text();

	let event;
	try {
		// `constructEventAsync` works in both Node and Web Crypto
		// runtimes (Vercel Edge, Cloudflare Workers, etc.) — the
		// sync `constructEvent` only works in Node. Always default
		// to the async one so the code is portable across SvelteKit
		// adapters.
		event = await stripe().webhooks.constructEventAsync(
			rawBody,
			signature,
			serverEnv.STRIPE_WEBHOOK_SECRET
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown signature error';
		// Don't leak the secret-derivation error string to the
		// network — it's noisy and faintly attacker-useful. Log
		// server-side, return a generic 400 to the caller.
		console.warn('[stripe-webhook] signature verification failed:', message);
		throw error(400, 'Invalid signature');
	}

	// Storage-layer idempotency (Module 6.4). The PK on
	// `stripe_events.id` makes the duplicate check atomic — Postgres
	// arbitrates between two concurrent webhook deliveries for the
	// same event.id without an application-level lock.
	const recorded = await recordStripeEvent(event);
	if (recorded === 'already-processed') {
		console.info('[stripe-webhook] duplicate event already-processed, skipping', {
			id: event.id,
			type: event.type
		});
		return json({ received: true, duplicate: true });
	}
	if (recorded === 'failed') {
		// DB write failed (transient blip, RLS misconfig, etc.).
		// 500 → Stripe retries. We have NOT run the dispatcher, so
		// no side effect happened either; the retry is safe.
		throw error(500, 'Failed to record event');
	}
	// 'fresh' OR 'retry' both fall through to dispatch — the latter
	// means a previous delivery's dispatch did not reach
	// markStripeEventProcessed and we're getting a second chance.

	try {
		const result = await dispatchStripeEvent(event);
		if (result.kind === 'unhandled') {
			// Intentional silence: Stripe Dashboard might be sending
			// us events we never asked for; we ack 200 (so Stripe
			// stops retrying) but log at info-level so the developer
			// can spot misconfigured Dashboard subscriptions.
			console.info('[stripe-webhook] unhandled event type', {
				id: event.id,
				type: result.type
			});
		}
		// Stamp `processed_at` so unprocessed-event monitoring (the
		// `stripe_events_unprocessed_idx` partial index) can flag
		// stuck events. Failure here is logged but not fatal — see
		// markStripeEventProcessed for the rationale.
		await markStripeEventProcessed(event.id);
		// 200 is the "stop retrying" signal. Keep the body small —
		// Stripe doesn't read it; `received: true` is purely so
		// curl-against-the-endpoint debugging is informative.
		return json({ received: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown handler error';
		console.error('[stripe-webhook] handler failed', {
			id: event.id,
			type: event.type,
			error: message
		});
		// 500 — NOT 200 — so Stripe retries. The dispatcher is
		// itself written to be idempotent (Module 6.2), and the
		// stored `stripe_events` row will dedupe on the second
		// delivery — except, deliberately, in this failure path:
		// the row DID get inserted above, but `processed_at` is
		// still null, so a later replay (manual or automatic) will
		// re-run the side effect. That's the right semantic —
		// failed dispatches are not "done."
		throw error(500, 'Webhook handler error');
	}
};
