# Lesson 10.5 — Operational runbook

> **Module 10 — Webhooks resilience & operational hygiene**
> Previous: [04 — Webhook replay tool](./04-webhook-replay.md)
> Next: [Module 10 wrap-up](./00-module-10-wrap.md)

This page is the **on-call's playbook** for the surfaces Module 10
built. It assumes you've read the four feature lessons (10.1–10.4)
or at least know they exist.

The format is incident-shaped: each section starts with "you are
paged because…" and walks the response, not the architecture.

---

## 0. Preflight (one-time setup per environment)

Before anything else, the deployed environment needs:

- `PUBLIC_SENTRY_DSN` set to the project's DSN. Empty disables
  Sentry — fine in dev, wrong in prod.
- `OPS_API_TOKEN` set to a 32-char-or-longer secret:

  ```bash
  node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
  ```

  Stash it in 1Password under "Contactly / OPS_API_TOKEN /
  &lt;env&gt;". Rotate quarterly or on any team-departure.

- At least one platform admin in `profiles`. From a service-role
  psql session:

  ```sql
  update public.profiles
  set is_platform_admin = true
  where email = 'oncall@contactly.io';
  ```

- A monitor (UptimeRobot / Datadog Synthetics / your choice)
  polling the health endpoint **every 60 seconds**:

  ```
  GET https://contactly.io/api/admin/webhooks/health
  Authorization: Bearer <OPS_API_TOKEN>

  Alert when HTTP status != 200.
  ```

- A Sentry alert rule on **`stripe_event_type` IS NOT NULL** for
  the production project, routing to the on-call rotation.

---

## 1. "Webhook health is unhealthy" alert (HTTP 503)

**You're paged because:** the health endpoint returned 503 and the
monitor's grace period elapsed.

**What that means:** at least one row in `stripe_events` has
`processed_at IS NULL` and was received more than 10 minutes ago.
Stripe is retrying with exponential backoff but the local
mirror / side effects are stale.

**First minute:**

1. Open `/admin/webhooks` in your browser. The "Stuck events"
   table shows the top 50 by age. Read the **`type`** column.
2. If everything stuck is **one event type** → likely a handler
   regression (a recent deploy broke `invoice.payment_failed`,
   say). Skip to §1a.
3. If everything stuck is **mixed types** → likely a downstream
   outage (Postgres write contention, Stripe API outage during
   handler-side calls). Skip to §1b.

### 1a. Single-type backlog → handler regression

- Open Sentry's "Issues" tab. Filter on
  `stripe_event_type:<type>`. The exception that's failing should
  be the top issue.
- If the regression is from a deploy you can identify (Sentry's
  `release` tag links to the SHA), revert. Watch the backlog
  drain on the next monitor poll.
- If you can hot-fix the handler (one-line null check, missing
  field, obvious bug), do that and deploy.
- Once the handler is healthy, **batch-replay the backlog** from
  `/admin/webhooks` ("Replay all (≤ 25)") or the CLI:

  ```bash
  curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
    -H "Authorization: Bearer ${OPS_API_TOKEN}" \
    -H "content-type: application/json" \
    -d '{"olderThanMs":600000}' | jq
  ```

- Repeat until `unprocessedCount` returns to 0.

### 1b. Mixed-type backlog → downstream outage

- Check the structured logs for the time window of the oldest
  stuck event. Filter on `req_id` from any failing log line; the
  same id is on the Sentry event so you can pivot back and forth.
- Most common cause: a Supabase / Postgres connection-pool
  saturation. Look for `ECONNRESET` or `TimeoutError` in the
  logs.
- Once the downstream is back, replay the backlog the same way
  as §1a.

### What NOT to do

- **Do not delete `stripe_events` rows.** They're the audit trail
  for whether a side effect ran. The replay tool is the only
  correct way to clear them; manually deleting throws Stripe's
  retries into ambiguous territory.
- **Do not re-trigger from Stripe's Dashboard.** That would
  produce a _new_ event id and bypass the idempotency table.

---

## 2. "Sentry alert: webhook handler exception"

**You're paged because:** an exception fired inside a Stripe
webhook handler and Sentry's `stripe_event_type` rule caught it.

**Why it's separate from §1:** Sentry fires on the _first_
exception; the health alert fires when the row stays stuck for
10 minutes. A single transient exception (Postgres deadlock,
flaky network) usually self-heals on Stripe's first retry —
Sentry tells you it happened, the health alert tells you it
didn't recover.

**Triage:**

1. Sentry's event detail shows the full tag set: `req_id`,
   `route_id`, `release`, `environment`, `stripe_event_id`,
   `stripe_event_type`. Copy the `req_id`.
2. Search the structured logs for the same `req_id`. The full
   handler call tree is one query.
3. If the same exception is firing repeatedly (the Sentry "Events"
   tab shows the count), this is a regression — handle it as §1a
   above.
4. If it's a single hit and the health endpoint stays at 200,
   it's probably benign (Stripe's first retry succeeded). Mark
   the Sentry issue resolved with a one-line note.

---

## 3. "I can't reach `/admin/webhooks`" (404)

**Most likely cause:** your account isn't a platform admin.

The (admin) layout 404s every unauthorised caller — by design, so
the existence of the surface is invisible to outsiders. To
self-promote (assuming you have service-role access):

```sql
update public.profiles
set is_platform_admin = true
where email = '<your-email>';
```

If you don't have service-role access, page someone who does.

---

## 4. "I lost the `OPS_API_TOKEN` / I want to rotate it"

1. Mint a fresh token:

   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
   ```

2. Update the env var in Vercel (or your hosting platform).
3. Update the monitor's bearer-token configuration to match.
4. Update the 1Password entry.

There is no "session" to invalidate — every call validates the
token live, so the old token stops working the moment Vercel
ships the new env var.

---

## 5. Promoting / demoting a platform admin

**Promote:**

```sql
update public.profiles
set is_platform_admin = true
where email = 'new-admin@contactly.io';
```

**Demote:**

```sql
update public.profiles
set is_platform_admin = false
where email = 'former-admin@contactly.io';
```

The `profiles_protect_admin_flag` trigger ensures **only**
service-role can run these. App code (and the user themselves)
cannot self-elevate even if they craft a clever PATCH; the trigger
silently pins the column.

---

## 6. "Sentry quota is alarming"

Open the Sentry project → Stats → "Events accepted by
release". The release with the burst is your culprit.

If it's a one-deploy spike, deploy a hot-fix and let the spike age
out of the rolling window.

If it's a slow burn (a degraded handler firing on every retry),
you need to either fix the handler or **temporarily lower
`tracesSampleRate`** in `src/lib/sentry-shared.ts`. The default is
`0.1` in production; dropping to `0.01` while you stabilise is
fine.

Errors are not affected by `tracesSampleRate` — only performance
spans are. Your error visibility doesn't degrade.

---

## 7. Local dev / preview parity

Module 10 is built so local dev never touches the production
Sentry project (empty DSN ⇒ no-op) and never accepts a bearer
token (empty `OPS_API_TOKEN` ⇒ branch fully disabled).

Preview deploys (Vercel `VERCEL_ENV=preview`) do report to Sentry
with `environment: preview`, so you can validate Sentry wiring on
a PR without contaminating production stats. Make sure the Sentry
alert rule on `environment:production` is the one routing to
PagerDuty — `environment:preview` is for dashboard-only triage.

---

## 8. Routine hygiene (weekly)

- `select count(*) from stripe_events where processed_at is null;`
  — should be 0 most of the time. Trends > 0 over multiple polls
  are an SLO regression even if no row is older than 10 minutes
  yet.
- `select count(*) from public.profiles where is_platform_admin;`
  — should match the 1Password "Admins" list. Departures should
  be revoked promptly (see §5).
- Sentry quarterly review: are alert rules still routed to the
  current on-call rotation? Are `release` tags landing? (Empty
  release ⇒ Vercel SHA env var got dropped from the build.)

---

## Appendix: the surfaces in one table

| Surface                                    | Purpose                              | Auth                       |
| ------------------------------------------ | ------------------------------------ | -------------------------- |
| `GET /api/admin/webhooks/health`           | Monitor-facing health JSON (200/503) | Bearer or admin user       |
| `GET /admin/webhooks`                      | Human dashboard for backlog triage   | Admin user (404 otherwise) |
| `POST /api/admin/webhooks/replay` (single) | `{"eventId":"evt_..."}`              | Bearer or admin user       |
| `POST /api/admin/webhooks/replay` (batch)  | `{"olderThanMs":N,"limit":N}`        | Bearer or admin user       |
| `POST /admin/webhooks?/replay`             | Form action: per-row replay button   | Admin user                 |
| `POST /admin/webhooks?/replayBatch`        | Form action: "Replay all" button     | Admin user                 |
| `Sentry`                                   | Error reports, tagged with `req_id`  | Sentry login               |
| `event.locals.logger.*`                    | Structured logs, every server path   | n/a (server-side)          |
