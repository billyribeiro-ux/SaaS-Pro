/**
 * Server-side Stripe client (Node SDK).
 *
 * USAGE
 * -----
 * Import the singleton via `stripe()` (function, not bare value) so
 * the actual constructor only runs on first use. This matters because
 * SvelteKit's adapter-auto build evaluates this file at server start
 * even on routes that never touch Stripe — lazy construction keeps
 * cold-start latency unmeasurable.
 *
 *   import { stripe } from '$lib/server/stripe';
 *   const session = await stripe().checkout.sessions.create({ ... });
 *
 * API VERSION
 * -----------
 * Pinned to `2026-03-25.dahlia` (the latest at the time of writing).
 * **Never read this from env or auto-bump it.** A hard-coded version
 * means a Stripe-side default change can't silently rewrite our
 * integration's behavior. To upgrade, change the literal here, run
 * the full e2e + webhook trigger suite, and ship the bump as its own
 * commit. Lesson 6.1 of the course documents this discipline.
 *
 * RESTRICTED API KEYS
 * -------------------
 * `STRIPE_SECRET_KEY` accepts both `sk_*` and `rk_*` prefixes (env
 * validator at `src/lib/server/env.ts`). For Contactly we strongly
 * recommend a Restricted API Key (`rk_test_...`/`rk_live_...`) with
 * only the permissions the app actually uses:
 *
 *   - Customers              read + write
 *   - Checkout Sessions      write
 *   - Billing Portal         write
 *   - Prices, Products       read
 *   - Subscriptions          read   (writes happen via the Portal)
 *   - Invoices               read
 *   - Webhook Endpoints      none   (managed in Dashboard, not by app)
 *   - Files, Refunds, Disputes, Tax, Connect…  none
 *
 * Generate the RAK in the Stripe Dashboard:
 *   Developers → API keys → "Create restricted key".
 *
 * IDEMPOTENCY
 * -----------
 * Use the `withIdempotencyKey` helper for any mutation that could
 * sanely be retried (form submission, webhook handler retry, queue
 * worker). Stripe deduplicates per-key for ~24 hours; passing the
 * same key with the same params is a no-op, passing a different key
 * with the same params will create a duplicate.
 *
 *   await withIdempotencyKey(`upgrade:${user.id}:${form.nonce}`, (key) =>
 *     stripe().checkout.sessions.create({ ... }, { idempotencyKey: key })
 *   );
 *
 * Module 6.4 wires every webhook ingestion through a unique-on-
 * `event.id` insert into `stripe_events`, which is the *other* half of
 * the idempotency story (dedupe at the storage layer, not just the
 * API layer).
 */
import Stripe from 'stripe';
import { serverEnv } from '$lib/server/env';

/**
 * Pinned Stripe REST API version. See module-level comment.
 *
 * The literal `'2026-03-25.dahlia'` is type-checked against the SDK's
 * `apiVersion` parameter at the `new Stripe(...)` call below: if a
 * future SDK upgrade drops support for this exact string, the
 * constructor invocation will fail `tsc`. That's the right place for
 * the failure — louder than a runtime 400 from Stripe.
 */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

let cached: Stripe | undefined;

/**
 * Return the singleton Stripe client.
 *
 * Lazy-instantiated; subsequent calls return the same instance.
 */
export function stripe(): Stripe {
	if (!cached) {
		cached = new Stripe(serverEnv.STRIPE_SECRET_KEY, {
			apiVersion: STRIPE_API_VERSION,
			// Identifies this integration in Stripe's logs and
			// usage analytics — useful when triaging weird API calls
			// across multiple Stripe Apps / SDKs in the same account.
			appInfo: {
				name: 'contactly',
				version: '0.1.0',
				url: 'https://github.com/your-org/contactly'
			},
			// Default network resilience knobs. The SDK retries
			// idempotent failures (network errors, 5xx) with
			// exponential backoff; cap the count so a sustained
			// outage doesn't pin a serverless function past its
			// timeout.
			maxNetworkRetries: 2,
			timeout: 20_000
		});
	}
	return cached;
}

/**
 * Wrap a Stripe API call with a structured idempotency key.
 *
 * Pass a function that takes the resolved key string and returns the
 * Stripe SDK call (with the key passed via `{ idempotencyKey: key }`
 * request options). The wrapper exists for two reasons:
 *
 *   1. Forces every retryable mutation to declare its key, instead of
 *      letting individual call sites quietly skip it.
 *   2. Centralizes the key-shape convention so a future audit can
 *      grep all of them: `<intent>:<scope>:<nonce>`. Examples:
 *         upgrade:user_abc:nonce_xyz
 *         portal:user_abc:2026-04-19T11:23
 *         refund:invoice_in_def:20260419-q4-bug
 */
export async function withIdempotencyKey<T>(
	key: string,
	fn: (key: string) => Promise<T>
): Promise<T> {
	if (!key || key.length < 8) {
		throw new Error(
			`withIdempotencyKey: key must be a stable, non-trivial string (got: ${JSON.stringify(key)})`
		);
	}
	return fn(key);
}

/**
 * Re-export the Stripe namespace so callers can `import type` request
 * + response shapes without a second `import Stripe from 'stripe'`.
 *
 *   import type { StripeTypes } from '$lib/server/stripe';
 *   function handle(event: StripeTypes.Event) { ... }
 */
export type { Stripe as StripeTypes };
