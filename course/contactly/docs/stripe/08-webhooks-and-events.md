# Lesson 6.2 — Stripe Webhooks & Events

The pricing catalog from Module 5 is static — checkout in, money out.
Everything _interesting_ about a subscription happens after Stripe
takes over the lifecycle: trial ending, card declining, customer
clicking "Cancel" in the portal six weeks later. The only way
Contactly hears about any of it is via webhooks.

This lesson is conceptual. The code lands in 6.3. Read this once
before you write the handler — every line of that handler is a
defensive response to one of the properties below.

## What a webhook actually is

When something noteworthy happens in your Stripe account, Stripe
performs an HTTP `POST` to a URL you've registered, with a JSON body
describing the event. From your application's perspective:

```
Stripe (event source) ────POST────►  https://contactly.example/api/webhooks/stripe
                                     ├── headers
                                     │     stripe-signature: t=…,v1=…
                                     │     content-type: application/json
                                     │     user-agent: Stripe/1.0 (+https://stripe.com/docs/webhooks)
                                     └── body
                                           { "id": "evt_…", "type": "customer.subscription.updated", "data": { ... } }
```

That's it. Stripe expects a `2xx` response within ~30 seconds. Anything
else (4xx, 5xx, timeout, network error) is a _delivery failure_ and
Stripe will retry — see "Retries" below.

## The four uncomfortable truths

A naive webhook handler — "decode the JSON, look up the customer, do
the thing" — is wrong in four predictable ways. Internalizing these is
80% of the work.

### 1. Webhooks are async

Inside an HTTP request handler you are accustomed to: receive request,
read database, do work, return response, _and the user is staring at a
spinner the whole time_. Webhooks invert that completely. There is no
human waiting. There is no UI thread to unblock. Stripe doesn't care
whether you take 50ms or 5 seconds — only that you eventually return
2xx.

This means:

- **The "actor" is your system, not a user.** Use the
  `withAdmin('stripe-webhook', 'system', ...)` audit envelope from
  Module 4.4 for any service-role DB write. There's no `request.locals.user`.
- **You should do the _minimum work_ that lets you return 2xx fast,
  then enqueue follow-up work.** Sending an email synchronously inside
  a webhook handler is an anti-pattern: if the email provider is
  having a bad afternoon, Stripe sees a 5xx, retries, and you've now
  sent ten emails. We park that pattern (job queue) until Module 14;
  for v1 we'll only do DB writes from the handler, never network calls
  to other third parties.

### 2. Webhooks are idempotent (or rather: they MUST be — Stripe isn't)

Stripe will deliver the same `event.id` more than once under normal
operation:

- Network blip on its side: it never saw your 2xx.
- Network blip on yours: you returned 2xx but it never reached Stripe.
- Stripe's own at-least-once delivery infra retrying on its schedule.

Your handler must produce the same end state regardless of whether
`evt_1Pq3aZ` arrives once or seventeen times. There are two layers of
defense — Module 6.4 builds them both:

| Layer       | Mechanism                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Storage** | A `stripe_events` table with `id` as PRIMARY KEY. The handler tries to `INSERT` first; on `unique_violation` it returns 200 immediately without re-running the side effect.                      |
| **Logic**   | Each event-type handler is written to be idempotent in its own right — e.g. UPSERT-by-`subscription.id` rather than INSERT, so "the row already matches" is a no-op rather than a duplicate row. |

Belt and braces. The storage layer catches retries-of-the-same-event;
the logic layer catches "two different events that happen to converge
on the same intent" (e.g. `customer.subscription.created` arrives a
second time because Stripe replayed it from history during a
backfill).

### 3. Webhooks are untrusted by default

The URL is public. Anyone on the internet can `POST` whatever JSON
they want to `/api/webhooks/stripe`. If the handler trusts the body
without verifying the source, an attacker can:

- Mark themselves as a paying customer by forging
  `customer.subscription.created`.
- Wipe out a real subscriber's plan by forging
  `customer.subscription.deleted`.
- Trigger any side effect your dispatcher cares to call.

Stripe defends this with HMAC-SHA256 signatures over the raw request
body, using a secret only Stripe and your endpoint know
(`STRIPE_WEBHOOK_SECRET`). The Stripe Node SDK does the verification
in `stripe.webhooks.constructEvent(rawBody, signature, secret)`.

**Two non-negotiable consequences:**

1. **The first thing the handler does is verify the signature.**
   Before parsing the body. Before logging anything from it. Before
   any database lookup. If verification fails, return `400` and stop.
2. **Verification needs the _raw_ request body, byte-for-byte as
   Stripe sent it.** SvelteKit's `await request.json()` parses,
   re-serializes, and changes whitespace — that breaks the HMAC.
   Always use `await request.text()` (or `request.arrayBuffer()`) and
   pass the raw string to `constructEvent`. The Lesson 6.3 handler
   walks through this gotcha in detail.

The `stripe listen` CLI in dev mode mints a _different_
`whsec_...` for each session, so a recently-rebooted machine will
get spurious 400s until you copy the new secret into `.env`. That's a
common dev confusion, not a code bug.

### 4. Order is not guaranteed

Stripe sends events in _roughly_ causal order, but retries break that
guarantee. You can absolutely receive
`customer.subscription.updated` (status: `active`) before
`customer.subscription.created` if the first attempt at the
`created` event timed out and Stripe is now retrying it while a
second human-driven update has already happened.

The right way to think about events is:

> **The event tells me a fact changed in Stripe; the truth is what
> the API returns when I ask Stripe right now.**

For state-mirroring handlers (almost all of ours) the pattern is:

```ts
// Receive event for subscription sub_xxx
// IGNORE event.data.object — it's a snapshot from when the event was created
// FETCH the subscription fresh from Stripe (or trust the snapshot only after checking event.created vs db's last_synced_at)
// UPSERT into our local mirror table
```

The freshly-fetched object is canonical. The event is a _trigger_,
not a data source.

(For some events — `checkout.session.completed`, `invoice.paid`'s
`payment_intent` — the snapshot IS canonical because those objects are
immutable once created. The handler dispatch table in 6.3 documents
which events get re-fetched and which don't.)

## Retries

Stripe retries failed webhook deliveries with exponential backoff for
**up to 3 days** by default. The full schedule is roughly:

```
Attempt 1:    immediate
Attempt 2:    +1 hour
Attempt 3:    +6 hours
Attempt 4:    +12 hours
…
Final attempt: ~72 hours after the original event
```

After the final attempt the event is moved to a _failed_ state in the
Dashboard (Developers → Webhooks → endpoint → Failed). It is **not**
deleted — you can manually replay it. We'll wire up an internal
admin "replay" UI in Module 12.6 once the audit table exists to record
who clicked the button.

What this means at the handler level:

- A 5xx from the handler **will be retried**. So a transient DB blip
  won't lose the event.
- A 200 from the handler is treated as final acknowledgement, even if
  the actual side effect inside the handler crashed. This is why we
  always wrap the handler body in a try/catch and **only return 200
  after the side effect is durable** (i.e. after the DB COMMIT, not
  before).
- The `stripe_events` table (Module 6.4) gives us a queryable record
  of "what did we actually receive and process" independent of Stripe's
  Dashboard view. Useful when reconciling a billing bug six months
  later.

## Which events does Contactly subscribe to?

The handler's `EVENT_HANDLERS` dispatch table (Lesson 6.3) only
processes events Contactly cares about. Everything else returns 200
silently — Stripe ignores 200s, but we _don't_ want to log "unhandled
event" warnings on every `customer.tax_id.created` notification we
didn't ask for. The Dashboard endpoint config also lets us filter to
only the event types we care about; we'll set that up in Module 12.5
when we configure production endpoints.

The minimum set we'll handle through Modules 6–10:

| Event type                             | Why we care                                                               |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `checkout.session.completed`           | First time a user successfully checks out — link Customer to user (M7.3). |
| `customer.subscription.created`        | Mirror new subscription → `subscriptions` table (M7.4).                   |
| `customer.subscription.updated`        | Status, plan, period changes — re-mirror.                                 |
| `customer.subscription.deleted`        | Cancellation effective — set status, drop entitlement.                    |
| `customer.subscription.trial_will_end` | T-3 days reminder hook (M9.4 trial system).                               |
| `invoice.paid`                         | Renewal succeeded — extend access window.                                 |
| `invoice.payment_failed`               | Card declined — kick off dunning (M10).                                   |

Everything else is for now intentionally a no-op.

## A mental model summary

A webhook handler is **not** a normal HTTP endpoint. It is:

> A signature-verified, idempotent, reentrant message processor whose
> only job is to durably record "Stripe says X happened" and trigger
> the minimal local side effect that keeps our DB consistent with
> Stripe's view of the world.

Carry that one sentence into Lesson 6.3 and the code will write
itself.
