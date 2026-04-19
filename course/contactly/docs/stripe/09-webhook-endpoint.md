# Lesson 6.3 — Create the Webhook Endpoint

Theory in 6.2; code in 6.3. The receiver lives at:

```
POST /api/webhooks/stripe
```

served by `src/routes/api/webhooks/stripe/+server.ts`. The dispatch
table lives next door in `src/lib/server/stripe-events.ts` so the HTTP
adapter and the business routing can be tested independently.

## The endpoint, line-by-line

```ts
const signature = request.headers.get('stripe-signature');
if (!signature) throw error(400, 'Missing stripe-signature header');
```

No `Stripe-Signature` header → 400. No 401 — there's no auth scheme to
challenge; the request is simply malformed. Most non-Stripe traffic
that hits this URL is a port scanner.

```ts
const rawBody = await request.text();
```

**The most important line in the file.** Stripe's HMAC is computed
over the literal request body bytes. SvelteKit's `await request.json()`
parses then re-serializes — the resulting string almost always has
slightly different whitespace, key ordering, or escape encoding, and
the HMAC stops matching. Use `request.text()` exclusively. Same gotcha
applies to `request.formData()`, `request.arrayBuffer()` mutations,
or any middleware that touches the body upstream.

```ts
event = await stripe().webhooks.constructEventAsync(
	rawBody,
	signature,
	serverEnv.STRIPE_WEBHOOK_SECRET
);
```

`constructEventAsync` (not the sync `constructEvent`) works in both
Node and Web Crypto runtimes — Vercel Edge, Cloudflare Workers, and
Deno all expose Web Crypto but not the Node `crypto` module the sync
helper depends on. Defaulting to async means the same code runs in
every adapter SvelteKit supports. The cost is one Promise; not
measurable.

If verification fails, the SDK throws a `Stripe.errors.StripeSignatureVerificationError`.
We catch generically (`unknown`), log message-only server-side, and
return `400 Invalid signature`. Don't put the full error in the
response body — it's noisy and faintly attacker-useful (it tells them
_which_ signature scheme they're failing).

```ts
const result = await dispatchStripeEvent(event);
if (result.kind === 'unhandled') {
	console.info('[stripe-webhook] unhandled event type', { id: event.id, type: result.type });
}
return json({ received: true });
```

A 200 response tells Stripe "got it, stop retrying." We always return
200 after a successful dispatch — handled or unhandled. **Never**
return 4xx for an event we don't subscribe to: that pattern would let
a Stripe Dashboard misconfiguration fill our error logs forever
without any production impact.

The `console.info` line is the cheap canary that catches "you
subscribed the Dashboard endpoint to events your code doesn't know
about." Module 12 will graduate this to a structured `audit_log`
event.

```ts
} catch (err) {
	console.error('[stripe-webhook] handler failed', { ... });
	throw error(500, 'Webhook handler error');
}
```

A 500 makes Stripe retry with exponential backoff. The Lesson 6.2 doc
spells out the schedule: ~3 days of attempts before Stripe gives up.
A handler that's idempotent (Module 6.4 enforces this at the storage
layer) is _safe_ to retry — at worst we burn some database writes
recomputing a state we already had.

## The dispatch table

`SUBSCRIBED_EVENTS` is a typed const tuple, like the lookup-keys
pattern from Lesson 5.6:

```ts
export const SUBSCRIBED_EVENTS = [
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.trial_will_end',
	'invoice.paid',
	'invoice.payment_failed'
] as const;

type EventHandlers = { [K in SubscribedEventType]: EventHandler };
const EVENT_HANDLERS: EventHandlers = {
	'checkout.session.completed': async (event) => {
		/* ... */
	}
	// ...
};
```

The mapped type `EventHandlers` is the gate: if you add a string to
`SUBSCRIBED_EVENTS` without adding a corresponding handler in
`EVENT_HANDLERS`, `tsc` flags the missing key. If you add a handler
without registering the type, `tsc` flags the index. There is no third
state where the table is half-defined.

Today's handlers all just `console.info` the inbound event. Modules
6.4, 7.3, 7.4, 9.4, and 10 progressively replace each stub body with
the real DB writes and side effects — but the _signatures_ and
_registration_ are stable from this lesson onwards.

## "Unhandled" is not "error"

A common mistake is to log a warning when a Stripe event arrives that
the app doesn't know about. Don't. Three reasons:

1. The Dashboard endpoint config controls which events Stripe sends.
   If we ever subscribe to a category-wide filter ("all `customer.*`")
   we'd get 30+ types we don't care about, every minute, forever.
2. New event types appear in Stripe's API on a regular cadence. Logging
   warnings for them turns "Stripe shipped a feature" into "our
   on-call wakes up."
3. The route already returns 200 silently — Stripe never retries. The
   only signal an unhandled event has anywhere is the `info`-level
   log, which a developer can grep when they're suspicious about a
   missing dispatch.

Module 12 (logging) revisits this and adds an admin Dashboard view
showing rolling counts of `unhandled` types. That's the right place
for visibility, not a runtime warning.

## What the test suite covers

`src/routes/api/webhooks/stripe/server.test.ts` exercises the HTTP
contract end-to-end without hitting the network:

| Case                                     | Expected                 |
| ---------------------------------------- | ------------------------ |
| Missing `stripe-signature` header        | 400                      |
| Tampered signature value                 | 400                      |
| Valid signature, subscribed event type   | 200 `{ received: true }` |
| Valid signature, unsubscribed event type | 200 (silent ack)         |
| Valid signature, dispatch handler throws | 500 (Stripe will retry)  |

The signature is generated with the same HMAC formula the Stripe SDK
verifies against (`t=<ts>,v1=<HMAC-SHA256(secret, "<ts>.<body>")>`),
which is documented in Stripe's webhook signature reference. We
implement it inline in the test (rather than importing
`stripe.webhooks.generateTestHeaderString`) so that an SDK helper move
or rename can't silently break the test.

`src/lib/server/stripe-events.test.ts` covers the dispatch table:
every subscribed type returns `{ kind: 'handled' }`, unknown types
return `{ kind: 'unhandled' }` without throwing, and the
`isSubscribedEvent` type guard accepts the right strings and rejects
the rest.

## What's deliberately NOT here

| Concern                               | Lands in         | Why deferred                                       |
| ------------------------------------- | ---------------- | -------------------------------------------------- |
| Storage idempotency (`stripe_events`) | Module 6.4       | Needs the table migration first.                   |
| Linking Customer ↔ user               | Module 7.3       | Requires the `stripe_customers` mapping table.     |
| Mirroring subscription state          | Module 7.4       | Requires the `subscriptions` table + entitlements. |
| Email side effects (trial, dunning)   | Modules 9.4 / 10 | Needs Resend wired up + the dunning state machine. |

Next up (6.3.1): a `stripe:dev` convenience script that boots the
SvelteKit dev server and the Stripe CLI listener side-by-side so a
fresh checkout from the four-pane workstation just works.
