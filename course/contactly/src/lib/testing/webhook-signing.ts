/**
 * Stripe-Signature header generation for cassette playback.
 *
 * Stripe's webhook signing is HMAC-SHA256 over `${timestamp}.${body}`,
 * keyed by the project's `whsec_…` signing secret. The header value
 * is `t=<unix_seconds>,v1=<hex_hmac>` (with optional historical
 * `v0` schemes we never need to emit).
 *
 * We re-implement it here rather than calling
 * `stripe.webhooks.generateTestHeaderString` because:
 *
 *   1. The SDK helper requires importing the Stripe SDK in test code,
 *      which drags the dispatcher's transitive deps into Vitest's
 *      module graph and slows startup measurably.
 *   2. The signing scheme is a stable contract — Stripe has not
 *      changed it since 2018, and it's documented in their public
 *      API reference. Re-implementing it is a 10-line function with
 *      no upgrade risk.
 *   3. We need fine-grained control during test authoring: a
 *      "tampered body" assertion needs to sign one body and POST a
 *      different one; an "old timestamp" assertion needs to backdate
 *      the t= component. The SDK helper hides those knobs.
 *
 * The functions in this module are small enough to be obvious;
 * the test suite pins the bytes against `crypto.createHmac`
 * directly so any future scheme change in this file is loud.
 */
import { createHmac } from 'node:crypto';

/**
 * The Stripe-Signature header scheme version. Only `v1` is in use
 * today; `v0` was the original launch scheme and was deprecated
 * before any of this code existed. Exposed as a constant so a
 * future migration is one-place.
 */
export const STRIPE_SIGNATURE_SCHEME = 'v1' as const;

export type SignedWebhook = {
	/** The exact raw body bytes that were signed. */
	body: string;
	/** Header value: `t=<seconds>,v1=<hex>`. */
	signature: string;
	/** Unix seconds embedded in the `t=` component. */
	timestamp: number;
};

export type SignWebhookOptions = {
	/** Override the timestamp embedded in the header (unit: seconds). */
	timestampSeconds?: number;
};

/**
 * Compute the canonical `Stripe-Signature` header value for a body
 * and secret.
 *
 * The signed payload is `${timestampSeconds}.${body}` per Stripe's
 * spec. We default the timestamp to "now" because that's what
 * realistic playback wants; tests that need stale headers pass an
 * explicit `timestampSeconds` and assert the receiver still rejects
 * (or accepts within `tolerance`).
 *
 * Inputs are validated minimally: an empty `secret` is a developer
 * mistake (the real `whsec_…` is always 32+ chars) so we throw
 * rather than silently produce a spec-compliant but useless signature.
 */
export function signWebhookBody(
	body: string,
	secret: string,
	options: SignWebhookOptions = {}
): SignedWebhook {
	if (!secret) {
		throw new Error('signWebhookBody: secret is empty; pass the test webhook secret');
	}
	const timestamp = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
	const signedPayload = `${timestamp}.${body}`;
	const digest = createHmac('sha256', secret).update(signedPayload).digest('hex');
	return {
		body,
		signature: `t=${timestamp},${STRIPE_SIGNATURE_SCHEME}=${digest}`,
		timestamp
	};
}

/**
 * Convenience: sign a JS value as JSON. `JSON.stringify` is
 * deterministic for objects with a stable key order — cassettes are
 * authored as JSON, so the round-trip `JSON.parse` → `JSON.stringify`
 * we do during playback drops insignificant whitespace and produces a
 * canonical body. The receiver verifies against THESE bytes; the
 * cassette file's whitespace is irrelevant.
 *
 * Returns the same shape as `signWebhookBody`. The `body` field is the
 * exact bytes that were signed, which is also what should be sent in
 * the request — never re-serialize between sign and send.
 */
export function signWebhookEvent(
	event: unknown,
	secret: string,
	options: SignWebhookOptions = {}
): SignedWebhook {
	const body = JSON.stringify(event);
	return signWebhookBody(body, secret, options);
}

/**
 * Build a `Request` ready to hand to a SvelteKit handler under test.
 *
 * Targets `http://localhost/api/webhooks/stripe` by default — the
 * receiver only reads `request.headers` and `request.text()`, so the
 * URL is purely a Vitest formality. Override `url` if a future test
 * wants to assert the receiver respects a different mount point.
 */
export function buildSignedWebhookRequest(
	event: unknown,
	secret: string,
	options: SignWebhookOptions & { url?: string } = {}
): Request {
	const { url = 'http://localhost/api/webhooks/stripe', ...signOpts } = options;
	const signed = signWebhookEvent(event, secret, signOpts);
	return new Request(url, {
		method: 'POST',
		headers: {
			'stripe-signature': signed.signature,
			'content-type': 'application/json'
		},
		body: signed.body
	});
}
