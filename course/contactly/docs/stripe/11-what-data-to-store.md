# Lesson 6.4 — What Data to Store

The webhook handler from Lesson 6.3 was a stateless echo: verify
signature, route to a stub, return 200. That works for a smoke test;
it doesn't survive its first duplicate delivery.

This lesson lays the two storage tables every later billing lesson
reads from, and rewires the receiver to use the first one as the
storage-layer half of webhook idempotency.

## The two tables

```
┌────────────────────────┐         ┌──────────────────────────────────┐
│ stripe_customers       │         │ stripe_events                    │
│  (1:1 with profiles)   │         │  (1:N over webhook deliveries)   │
├────────────────────────┤         ├──────────────────────────────────┤
│ user_id (PK, FK)       │         │ id           text PK ('evt_…')   │
│ stripe_customer_id     │         │ type         text                │
│ email                  │         │ payload      jsonb               │
│ created_at             │         │ received_at  timestamptz         │
│ updated_at             │         │ processed_at timestamptz nullable│
└────────────────────────┘         │ livemode     boolean             │
                                   │ api_version  text                │
                                   └──────────────────────────────────┘
```

Migration: `supabase/migrations/20260419000004_stripe_billing.sql`.

### `stripe_customers` — why this shape, and why now

Per **ADR-002** (`ARCHITECTURE.md`), a Stripe Customer is owned by the
_user_, not the organization. So `user_id` is both PK and the FK back
to `profiles(id)` (which mirrors `auth.users(id)`):

- **PK on `user_id`** enforces the 1:1 nature in the schema, not just
  the application code. There can be only one Stripe Customer per
  user, ever. If you ever need to roll a customer (rare; usually for
  legal/region migrations), you migrate the existing `cus_…` to a
  new value with an UPDATE — you don't create a parallel row.
- **Unique index on `stripe_customer_id`** gives us the reverse
  lookup that every webhook handler needs ("Stripe says
  `cus_xyz`'s subscription updated; who is that?"). This is the
  hottest read in the billing path; without it we'd table-scan on
  every event.
- **`email` snapshot** captures whatever email we sent to Stripe at
  customer-creation time. The user might rename later; the snapshot
  is for audit ("what did Stripe think this user's email was on day
  one?"). The source of truth for _current_ email is still
  `auth.users.email`.

RLS is on, with a single SELECT policy: a user can read their own
mapping row (so the account UI can show "you've been a Stripe
customer since 2026-04-19"). All writes are service-role only —
i.e., only the webhook handler and the M7.3 lazy-creation path.

### `stripe_events` — the audit + idempotency ledger

Three jobs:

1. **Idempotency dedupe.** PK on `id` means a duplicate Stripe
   delivery hits a unique-constraint failure (with `ignoreDuplicates:
true` it's a silent no-op insert). The handler uses that signal
   to skip dispatching a second time.
2. **Audit trail.** Every signature-verified event is preserved in
   full (`payload jsonb`). When a billing bug surfaces six months
   later, you don't have to ask Stripe Support to re-deliver — you
   have the canonical record locally.
3. **Stuck-event monitoring.** `processed_at IS NULL` means the
   dispatch attempt didn't finish. The partial index
   `stripe_events_unprocessed_idx` makes the "find me anything
   unprocessed older than X" query a sub-millisecond seek even at
   millions of rows.

RLS is on with **no policies** — the only user of this table is
`service_role`, which bypasses RLS. End users have no business
reading webhook history.

## The four-state record protocol

`recordStripeEvent` returns one of four values:

| Value               | Meaning                                                                  | Handler does                          |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `fresh`             | First time we've seen this event-id. Insert succeeded.                   | Dispatch, then `markProcessed`.       |
| `retry`             | Row exists but `processed_at IS NULL` — previous dispatch didn't finish. | Dispatch again, then `markProcessed`. |
| `already-processed` | Row exists and `processed_at IS NOT NULL` — fully handled before.        | Return 200, skip dispatch.            |
| `failed`            | The DB write itself errored (transient blip, RLS misconfig, …).          | Return 500. Stripe retries.           |

The `retry` state is the subtle one. A naive "duplicate ⇒ skip"
implementation has a correctness hole: if the _first_ delivery's
dispatch crashes after the row was inserted but before
`processed_at` got stamped, then on Stripe's retry the row already
exists, the handler skips dispatch, and the side effect is lost
forever. Splitting "duplicate" into "retry" vs "already-processed"
closes that hole.

The cost is one extra `SELECT processed_at FROM stripe_events WHERE
id = $1` per duplicate delivery. Webhook traffic is single-digit
events per second at the high end of Contactly's expected scale —
the round-trip is invisible compared to network latency to Stripe.

## The receiver, updated

```ts
// src/routes/api/webhooks/stripe/+server.ts (excerpt)

const recorded = await recordStripeEvent(event);
if (recorded === 'already-processed') return json({ received: true, duplicate: true });
if (recorded === 'failed') throw error(500, 'Failed to record event');

try {
	const result = await dispatchStripeEvent(event);
	if (result.kind === 'unhandled') console.info('[stripe-webhook] unhandled event type', { ... });
	await markStripeEventProcessed(event.id);
	return json({ received: true });
} catch (err) {
	console.error('[stripe-webhook] handler failed', { id: event.id, error: ... });
	throw error(500, 'Webhook handler error');
}
```

Three crucial properties:

- **Storage write happens BEFORE dispatch.** If we crashed between
  dispatch and the storage write, the next delivery would have no
  record of the event, treat it as fresh, and re-run the side
  effect. By recording first, we always know what we've seen.
- **`markStripeEventProcessed` is the LAST thing before returning 200.** That's how we distinguish "fully finished" from "started
  but didn't finish."
- **All three failure modes return 5xx.** Stripe will retry
  failures with backoff for ~3 days (Lesson 6.2 retry table). The
  retry will hit the `retry` path (DB row exists, `processed_at`
  null) and re-attempt the dispatch.

## What's NOT here yet

| Concern                          | Lands in                  |
| -------------------------------- | ------------------------- |
| Lazy `stripe_customers` creation | Module 7.3 (Checkout)     |
| `subscriptions` mirror table     | Module 7.4 (Entitlements) |
| `subscription_trials` audit      | Module 9.4 (Trial system) |
| Replay UI on a stuck event       | Module 12.6               |

All of those land as additive migrations on top of this one. The
storage shape we just committed is the foundation.

## Verifying locally

If your Supabase stack is running:

```bash
pnpm run db:reset   # apply migrations including 20260419000004
pnpm run stripe:dev # boots app + listener (Lesson 6.3.1)
# in a third terminal:
pnpm run stripe:trigger invoice.paid

# Then in psql / Supabase Studio:
select id, type, processed_at from stripe_events order by received_at desc limit 5;
```

You should see one row per `stripe:trigger`, with `processed_at`
stamped within milliseconds of `received_at`. Triggering the same
event id twice (rare but possible with `--add` flag tricks) would
show one row with `duplicate: true` in the second response body.

## Module 6 — closing summary

After Module 6, Contactly knows how to:

| Capability                                   | Lesson |
| -------------------------------------------- | ------ |
| Talk to Stripe's API with a typed singleton  | 6.1    |
| Reason about webhook properties              | 6.2    |
| Receive and verify webhook events            | 6.3    |
| Develop with the listener side-by-side       | 6.3.1  |
| Persist events idempotently with audit trail | 6.4    |

Module 7 starts using all of this: the marketing-side pricing page,
the lazy `stripe_customers` row, the Checkout Session, and finally
the `subscriptions` mirror table that turns "Stripe says you're
paying" into "Contactly grants you Pro features."
