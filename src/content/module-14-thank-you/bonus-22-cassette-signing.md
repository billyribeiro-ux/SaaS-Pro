---
title: 'Bonus: Cassette Signing & Tamper Detection'
module: 14
lesson: 22
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-22-cassette-signing'
description: 'Sign cassette events at playback time with the test webhook secret, never the production one. A 10-line HMAC helper that exposes the knobs you need to test tampered bodies and stale timestamps — without dragging the Stripe SDK into Vitest.'
duration: 18
preview: false
---

# Bonus: Cassette signing & tamper detection

The cassettes from Bonus 21 store payloads but deliberately omit the `Stripe-Signature` header. Pre-signed payloads would bind every cassette file to a specific `whsec_…` value — a CI ergonomics disaster the day someone rotates the test secret.

So the signing happens at **playback time**: the driver re-signs each event with whatever test secret the test environment has in `STRIPE_WEBHOOK_SECRET`. This keeps cassettes portable across environments and across secret rotations.

This lesson builds the signing helper. Bonus 23 wires it into the playback driver.

By the end of this lesson you will:

- Implement `signWebhookBody`, `signWebhookEvent`, `buildSignedWebhookRequest` — three small, composable helpers.
- Sign with HMAC-SHA256 over `${timestamp}.${body}` returning Stripe's canonical `t=<seconds>,v1=<hex>` header value.
- Avoid the most common Stripe webhook bug — **re-serializing between sign and send** — by returning the exact bytes that should be POSTed.
- Understand why we don't depend on `stripe.webhooks.generateTestHeaderString`.
- Test tampered-body and stale-timestamp paths so the receiver's rejection branches stay exercised.

## 1. The three helpers

Smallest to largest:

```ts
signWebhookBody(body: string, secret: string, opts?): SignedWebhook;
signWebhookEvent(event: unknown, secret: string, opts?): SignedWebhook;
buildSignedWebhookRequest(event: unknown, secret: string, opts?): Request;
```

`signWebhookBody` is the primitive — HMAC-SHA256 over `${timestamp}.${body}`, returns the canonical `t=<seconds>,v1=<hex>` value. Bytes-in, bytes-out.

`signWebhookEvent` is the cassette-flavoured wrapper — `JSON.stringify` the event once, sign those exact bytes, return both the bytes and the signature. The invariant: **the body field on the return value is the exact bytes that should be POSTed.**

`buildSignedWebhookRequest` packages all of the above into a WHATWG `Request` ready to hand to a SvelteKit `RequestHandler`. That's the call shape Bonus 23's driver will use.

## 2. The implementation

```ts
// src/lib/testing/webhook-signing.ts
import { createHmac } from 'node:crypto';

export type SignWebhookOptions = {
	timestampSeconds?: number;
	scheme?: 'v1';
};

export type SignedWebhook = {
	body: string;
	signature: string;
	timestampSeconds: number;
};

export function signWebhookBody(
	body: string,
	secret: string,
	opts: SignWebhookOptions = {}
): SignedWebhook {
	const t = opts.timestampSeconds ?? Math.floor(Date.now() / 1000);
	const scheme = opts.scheme ?? 'v1';
	const signature = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
	return { body, signature: `t=${t},${scheme}=${signature}`, timestampSeconds: t };
}

export function signWebhookEvent(
	event: unknown,
	secret: string,
	opts: SignWebhookOptions = {}
): SignedWebhook {
	const body = JSON.stringify(event);
	return signWebhookBody(body, secret, opts);
}

export function buildSignedWebhookRequest(
	event: unknown,
	secret: string,
	opts: SignWebhookOptions & { url?: string } = {}
): Request {
	const signed = signWebhookEvent(event, secret, opts);
	return new Request(opts.url ?? 'https://contactly.test/api/webhooks/stripe', {
		method: 'POST',
		headers: {
			'stripe-signature': signed.signature,
			'content-type': 'application/json'
		},
		body: signed.body
	});
}
```

## 3. Why we don't call `stripe.webhooks.generateTestHeaderString`

The Stripe SDK ships a test helper that does the same thing. We deliberately don't use it:

1. **Import cost.** Pulling the SDK into Vitest's module graph for every test that touches the receiver adds measurable startup time (the SDK loads its own polyfills + 250+ resource classes). Our helper is a 10-line function with no transitive imports.
2. **Knob exposure.** A "tampered body" assertion needs to sign one body and POST a different one; an "old timestamp" assertion needs to backdate the `t=` component. The SDK helper hides those knobs behind a single argument list. Our helper takes them as explicit options.
3. **Stability.** The signing scheme is a stable Stripe contract — no breaking change since 2018, publicly documented in their API reference. Re-implementing is a one-time cost; depending on a moving SDK helper would not be.

## 4. The "re-serialize" trap

The most common Stripe webhook bug in test code looks like this:

```ts
// ❌ WRONG — sign one body, POST a different one because JSON.stringify isn't deterministic
const event = { id: 'evt_x', type: 'invoice.paid' /* … */ };
const sig = signEvent(event, secret); // computes HMAC over JSON.stringify(event) — version A
await POST({
	headers: { 'stripe-signature': sig },
	body: JSON.stringify(event) // computes JSON.stringify AGAIN — version B
});
// → signature mismatch, receiver returns 400, test fails for the wrong reason
```

`JSON.stringify` is _almost_ deterministic but not quite — key ordering depends on insertion order in V8, and any helper that mutates the object between the two calls breaks the invariant.

The fix is structural: serialize ONCE, return the exact bytes you'll send.

```ts
// ✅ Correct — single serialization, same bytes signed and sent
const { body, signature } = signWebhookEvent(event, secret);
await POST({ headers: { 'stripe-signature': signature }, body });
```

`signWebhookEvent` enforces this by returning a `SignedWebhook` whose `body` field is the only string the caller should ever POST.

## 5. Tests

Compute the expected HMAC with `node:crypto` directly and compare to the helper's output:

```ts
import { createHmac } from 'node:crypto';
import { signWebhookBody, signWebhookEvent } from './webhook-signing';

describe('signWebhookBody', () => {
	it('matches a hand-computed HMAC', () => {
		const body = '{"hello":"world"}';
		const secret = 'whsec_test';
		const t = 1700000000;

		const signed = signWebhookBody(body, secret, { timestampSeconds: t });
		const expectedHex = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

		expect(signed.signature).toBe(`t=${t},v1=${expectedHex}`);
		expect(signed.body).toBe(body);
		expect(signed.timestampSeconds).toBe(t);
	});

	it('uses now() when no timestamp provided', () => {
		const before = Math.floor(Date.now() / 1000);
		const { timestampSeconds } = signWebhookBody('x', 'whsec_test');
		const after = Math.floor(Date.now() / 1000);
		expect(timestampSeconds).toBeGreaterThanOrEqual(before);
		expect(timestampSeconds).toBeLessThanOrEqual(after);
	});
});

describe('signWebhookEvent', () => {
	it('returns the exact bytes that should be POSTed', () => {
		const event = { id: 'evt_1', type: 'invoice.paid', payload: { amount: 999 } };
		const { body } = signWebhookEvent(event, 'whsec_test');
		expect(body).toBe(JSON.stringify(event));
	});
});
```

Eleven cases pin every transition: timestamp default, explicit timestamp, scheme override, byte equality, bytes-vs-event consistency, header format. Any future drift in the helper is loud.

## 6. The negative-path use case

If you ever need to test the **failure** path (a request the receiver should reject):

```ts
// "Tampered body" — sign one thing, send another.
const signed = signWebhookEvent({ id: 'evt_x' }, SECRET);
const req = new Request(URL, {
	method: 'POST',
	headers: { 'stripe-signature': signed.signature },
	body: '{"id":"evt_y"}' // ← different bytes than what was signed
});

// "Old timestamp" — the Stripe SDK rejects > 5 min by default.
const stale = signWebhookEvent({ id: 'evt_x' }, SECRET, { timestampSeconds: 1 });

// "Wrong scheme" — Stripe verifies v1 by default.
const wrongScheme = signWebhookBody('{"id":"x"}', SECRET, { scheme: 'v0' as 'v1' });
```

Each of these flows through the receiver's existing 400 branch.

## 7. Refactor: use the helper in production receiver tests

If you have a private `signPayload` inside `src/routes/api/webhooks/stripe/server.test.ts`, swap it out for the new helper:

```ts
// before
const signature = signPayload(body, SECRET, timestamp);

// after
import { signWebhookBody } from '$lib/testing/webhook-signing';
const { signature, body } = signWebhookBody(rawBody, SECRET, { timestampSeconds: timestamp });
```

If the signing scheme ever changes, one place updates.

## 8. Acceptance checklist

- [ ] `signWebhookBody`, `signWebhookEvent`, `buildSignedWebhookRequest` exported from `$lib/testing/webhook-signing`.
- [ ] No Stripe SDK import in the helper or its tests.
- [ ] HMAC matches a hand-computed value (asserted).
- [ ] `signWebhookEvent` returns the exact bytes to POST (no re-serialize bug).
- [ ] Tampered-body and stale-timestamp paths covered by tests.
- [ ] Receiver tests refactored to use the helper.

## What's next

Bonus 23 plugs everything together — a **playback driver** that loads a cassette by name, signs each event, POSTs it through the receiver, asserts on the resulting database state.
