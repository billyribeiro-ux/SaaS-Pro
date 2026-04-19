# 12.2 — Cassette signing helper for webhook playback

> **Module 12 — Recorded-cassette test harness for end-to-end Stripe scenarios.**
>
> Lesson 2 of 5. Extracts the `Stripe-Signature` header signing
> logic into a reusable helper, ready for Lesson 12.3's playback
> driver.

## Why a dedicated module?

The Lesson 12.1 cassettes capture event payloads but deliberately
omit the `Stripe-Signature` header. Pre-signed payloads would bind
every cassette file to a specific `whsec_…` value — a CI ergonomics
disaster the day someone rotates the test secret. So the signing
happens at playback time.

Before this lesson, the only signer was a private `signPayload`
helper inside `src/routes/api/webhooks/stripe/server.test.ts`.
Lesson 12.3 would have copy-pasted it into the cassette driver
or imported across test boundaries. Either path is a duplication
trap; this lesson normalises it.

## What we built

```
src/lib/testing/
├── webhook-signing.ts            (3 small helpers)
└── webhook-signing.test.ts       (11 cases)
```

The helpers, smallest to largest:

```ts
signWebhookBody(body: string, secret: string, opts?): SignedWebhook;
signWebhookEvent(event: unknown, secret: string, opts?): SignedWebhook;
buildSignedWebhookRequest(event, secret, opts?): Request;
```

`signWebhookBody` is the primitive — HMAC-SHA256 over
`${timestamp}.${body}`, returns the canonical
`t=<seconds>,v1=<hex>` value. Bytes-in, bytes-out.

`signWebhookEvent` is the cassette-flavoured wrapper —
`JSON.stringify` the event once, sign those exact bytes, return
both the bytes and the signature. The invariant the function
exists to enforce: **the body field on the return value is the
exact bytes that should be POSTed**. Re-serializing between sign
and send is the most common Stripe webhook bug we don't want
re-introduced.

`buildSignedWebhookRequest` packages all of the above into a
WHATWG `Request` ready to hand to a SvelteKit `RequestHandler`.
That's the call shape Lesson 12.3's driver will use; exposing it
here keeps the caller-side signature playback invisible —
"signed and ready" rather than three lines of plumbing.

## Why we don't call `stripe.webhooks.generateTestHeaderString`

The Stripe SDK ships a test-helper that does the same thing.
We deliberately don't use it:

1. **Import cost.** Pulling the SDK into Vitest's module graph
   for every test that touches the receiver added measurable
   startup time (the SDK loads its own polyfills + 250+ resource
   classes). Our helper is a 10-line function with no transitive
   imports.
2. **Knob exposure.** A "tampered body" assertion needs to sign
   one body and POST a different one; an "old timestamp"
   assertion needs to backdate the `t=` component. The SDK
   helper hides those knobs behind a single argument list. Our
   helper takes them as explicit options.
3. **Stability.** The signing scheme is a stable Stripe contract
   — no breaking change since 2018, publicly documented in their
   API reference. Re-implementing is a one-time cost; depending
   on a moving SDK helper would not be.

## Refactor: production receiver test now uses the helper

`src/routes/api/webhooks/stripe/server.test.ts` previously had its
own private `signPayload`. It now imports `signWebhookBody`
directly. The receiver test is the canonical "real production code
under load" exercise, so this collapses two implementations into
one. If the signing scheme ever changes, one place updates.

The new helper passes a `timestampSeconds` option that defaults to
`undefined` (→ "now"), preserving the previous behaviour exactly.
All eight existing receiver tests stayed green through the swap.

## Tests added (12.2)

| Suite                     | Cases | Notes                                                |
| ------------------------- | ----- | ---------------------------------------------------- |
| `webhook-signing.test.ts` | 11    | Bytes-against-`crypto.createHmac`, no SDK dependency |

Suite total: **247 tests, 24 files, ~390 ms**. The `webhook-
signing` suite pins the wire format directly: every test computes
the expected HMAC with `node:crypto` and compares to the helper's
output. Any future drift in the helper is loud.

## Public API stability

`signWebhookBody`, `signWebhookEvent`, and `buildSignedWebhookRequest`
are part of `$lib/testing/*`'s test-only public surface. Lesson 12.3
will be the first heavy consumer; downstream lessons can rely on
the signatures.

If you ever need to test the **failure** path (a request the
receiver should reject), you can:

```ts
// "Tampered body" — sign one thing, send another.
const signed = signWebhookEvent({ id: 'evt_x' }, SECRET);
const req = new Request(URL, {
	method: 'POST',
	headers: { 'stripe-signature': signed.signature },
	body: '{"id":"evt_y"}' // ← different bytes than what was signed
});

// "Old timestamp" — Stripe SDK rejects > 5 min by default.
const stale = signWebhookEvent({ id: 'evt_x' }, SECRET, {
	timestampSeconds: 1
});
```

Both shapes already pass through the receiver's existing 400
branch — those tests live in
`src/routes/api/webhooks/stripe/server.test.ts`.

## What's next

→ [12.3 — Cassette playback driver](./03-cassette-driver.md)
