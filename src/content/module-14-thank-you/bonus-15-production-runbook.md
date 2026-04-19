---
title: 'Bonus: Production Runbook & Incident Response'
module: 14
lesson: 15
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-15-production-runbook'
description: "The on-call playbook for the surfaces Bonuses 11–14 built. Incident-shaped: 'you are paged because…' followed by the response, not the architecture. Plus preflight, weekly hygiene, and what NOT to do."
duration: 22
preview: false
---

# Bonus: Production runbook & incident response

A health endpoint is the alarm. A replay tool is the wrench. A **runbook** is the muscle memory.

The first time you wake up at 2 a.m. to a Sentry alert, you don't want to be _designing_ the response. You want to open one document, read three numbered steps, and execute. This lesson is the template — the on-call's playbook for the surfaces the previous four bonuses built.

The format is incident-shaped: each section starts with **"you are paged because…"** and walks the response, not the architecture. Treat it as a starting point and rewrite each section the first time it actually saves you (or fails to save you) at 2 a.m.

By the end of this lesson you will:

- Have a one-time preflight checklist for every deployed environment.
- Have triage procedures for the two kinds of webhook backlog (single-type vs mixed-type).
- Know what NOT to do (manual `stripe_events` deletes, Stripe Dashboard re-triggers).
- Have rotation procedures for `OPS_API_TOKEN` and platform admin promotion/demotion.
- Know how to debug a Sentry quota spike without losing error visibility.
- Have a weekly hygiene routine that catches SLO regressions before they page you.

## 0. Preflight (one-time setup per environment)

Before anything else, the deployed environment needs:

- `PUBLIC_SENTRY_DSN` set to the project's DSN. Empty disables Sentry — fine in dev, wrong in prod.
- `OPS_API_TOKEN` set to a 32-char-or-longer secret:

  ```bash
  node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
  ```

  Stash it in 1Password / a secret manager. Rotate quarterly or on any team-departure.

- At least one platform admin in `profiles` (Bonus 13):

  ```sql
  update public.profiles
  set is_platform_admin = true
  where email = 'oncall@contactly.io';
  ```

- A monitor (UptimeRobot / Datadog Synthetics / your choice) polling the health endpoint **every 60 seconds**:

  ```
  GET https://contactly.io/api/admin/webhooks/health
  Authorization: Bearer <OPS_API_TOKEN>

  Alert when HTTP status != 200.
  ```

- A Sentry alert rule on **`stripe_event_type` IS NOT NULL** for the production project, routing to the on-call rotation.

## 1. "Webhook health is unhealthy" alert (HTTP 503)

**You're paged because:** the health endpoint returned 503 and the monitor's grace period elapsed.

**What that means:** at least one row in `stripe_events` has `processed_at IS NULL` and was received more than 10 minutes ago. Stripe is retrying with exponential backoff but the local mirror / side effects are stale.

**First minute:**

1. Open `/admin/webhooks` in your browser. The "Stuck events" table shows the top 50 by age. Read the **`type`** column.
2. If everything stuck is **one event type** → likely a handler regression (a recent deploy broke `invoice.payment_failed`, say). Skip to §1a.
3. If everything stuck is **mixed types** → likely a downstream outage (Postgres write contention, Stripe API outage during handler-side calls). Skip to §1b.

### 1a. Single-type backlog → handler regression

- Open Sentry's "Issues" tab. Filter on `stripe_event_type:<type>`. The exception that's failing should be the top issue.
- If the regression is from a deploy you can identify (Sentry's `release` tag links to the SHA), revert. Watch the backlog drain on the next monitor poll.
- If you can hot-fix the handler (one-line null check, missing field, obvious bug), do that and deploy.
- Once the handler is healthy, **batch-replay the backlog** from `/admin/webhooks` ("Replay all (≤ 25)") or the CLI:

  ```bash
  curl -sS -X POST https://contactly.io/api/admin/webhooks/replay \
    -H "Authorization: Bearer ${OPS_API_TOKEN}" \
    -H "content-type: application/json" \
    -d '{"olderThanMs":600000}' | jq
  ```

- Repeat until `unprocessedCount` returns to 0.

### 1b. Mixed-type backlog → downstream outage

- Check the structured logs for the time window of the oldest stuck event. Filter on `req_id` from any failing log line; the same id is on the Sentry event so you can pivot back and forth.
- Most common cause: a Supabase / Postgres connection-pool saturation. Look for `ECONNRESET` or `TimeoutError` in the logs.
- Once the downstream is back, replay the backlog the same way as §1a.

### What NOT to do

- **Do not delete `stripe_events` rows.** They're the audit trail for whether a side effect ran. The replay tool is the only correct way to clear them; manually deleting throws Stripe's retries into ambiguous territory.
- **Do not re-trigger from Stripe's Dashboard.** That would produce a _new_ event id and bypass the idempotency table. Replay the existing row instead.
- **Do not lower the health-check threshold to dodge the page.** If 10 minutes is too tight, the answer is to fix the slow handler, not to widen the window.

## 2. "Sentry alert: webhook handler exception"

**You're paged because:** an exception fired inside a Stripe webhook handler and Sentry's `stripe_event_type` rule caught it.

**Why it's separate from §1:** Sentry fires on the _first_ exception; the health alert fires when the row stays stuck for 10 minutes. A single transient exception (Postgres deadlock, flaky network) usually self-heals on Stripe's first retry — Sentry tells you it happened, the health alert tells you it didn't recover.

**Triage:**

1. Sentry's event detail shows the full tag set: `req_id`, `route_id`, `release`, `environment`, `stripe_event_id`, `stripe_event_type`. Copy the `req_id`.
2. Search the structured logs for the same `req_id`. The full handler call tree is one query.
3. If the same exception is firing repeatedly (the Sentry "Events" tab shows the count), this is a regression — handle it as §1a above.
4. If it's a single hit and the health endpoint stays at 200, it's probably benign (Stripe's first retry succeeded). Mark the Sentry issue resolved with a one-line note.

## 3. "I can't reach `/admin/webhooks`" (404)

**Most likely cause:** your account isn't a platform admin.

The (admin) layout 404s every unauthorised caller — by design, so the existence of the surface is invisible to outsiders. To self-promote (assuming you have service-role access):

```sql
update public.profiles
set is_platform_admin = true
where email = '<your-email>';
```

If you don't have service-role access, page someone who does.

## 4. "I lost the `OPS_API_TOKEN` / I want to rotate it"

1. Mint a fresh token:

   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
   ```

2. Update the env var in Vercel (or your hosting platform).
3. Update the monitor's bearer-token configuration to match.
4. Update the 1Password entry.

There is no "session" to invalidate — every call validates the token live, so the old token stops working the moment Vercel ships the new env var.

## 5. Promoting / demoting a platform admin

```sql
-- Promote
update public.profiles
set is_platform_admin = true
where email = 'new-admin@contactly.io';

-- Demote
update public.profiles
set is_platform_admin = false
where email = 'former-admin@contactly.io';
```

The `profiles_protect_admin_flag` trigger ensures **only** service-role can run these. App code (and the user themselves) cannot self-elevate even if they craft a clever PATCH; the trigger silently pins the column.

## 6. "Sentry quota is alarming"

Open the Sentry project → Stats → "Events accepted by release". The release with the burst is your culprit.

If it's a one-deploy spike, deploy a hot-fix and let the spike age out of the rolling window.

If it's a slow burn (a degraded handler firing on every retry), you need to either fix the handler or **temporarily lower `tracesSampleRate`** in `src/lib/sentry-shared.ts`. The default is `0.1` in production; dropping to `0.01` while you stabilise is fine.

Errors are not affected by `tracesSampleRate` — only performance spans are. Your error visibility doesn't degrade.

## 7. Local dev / preview parity

Built-in: local dev never touches the production Sentry project (empty DSN ⇒ no-op) and never accepts a bearer token (empty `OPS_API_TOKEN` ⇒ branch fully disabled).

Preview deploys (Vercel `VERCEL_ENV=preview`) do report to Sentry with `environment: preview`, so you can validate Sentry wiring on a PR without contaminating production stats. Make sure the Sentry alert rule on `environment:production` is the one routing to PagerDuty — `environment:preview` is for dashboard-only triage.

## 8. Routine hygiene (weekly)

- `select count(*) from stripe_events where processed_at is null;` — should be 0 most of the time. Trends > 0 over multiple polls are an SLO regression even if no row is older than 10 minutes yet.
- `select count(*) from public.profiles where is_platform_admin;` — should match the 1Password "Admins" list. Departures should be revoked promptly (see §5).
- Sentry quarterly review: are alert rules still routed to the current on-call rotation? Are `release` tags landing? (Empty release ⇒ Vercel SHA env var got dropped from the build.)

## 9. Postmortem template

After every page that consumed >30 minutes of on-call time, write a postmortem. It doesn't have to be long. The template:

```md
# Postmortem: <one-line summary>

**Date:** YYYY-MM-DD
**Duration:** XXm from page to resolution
**Impact:** N customers affected, $X revenue at risk

## What happened

2-3 sentences. The mechanism, not the people.

## Timeline

- HH:MM — first symptom in $surface
- HH:MM — page fired
- HH:MM — diagnosed root cause as $cause
- HH:MM — mitigation deployed
- HH:MM — backlog drained, alarm cleared

## Root cause

1-2 paragraphs. _Why_ it happened, not _what_.

## What worked

What in the runbook / tooling let you resolve this faster than last time?

## What didn't

What slowed you down? File a ticket for each.

## Action items

- [ ] Specific, owned, deadlined fix #1
- [ ] Specific, owned, deadlined fix #2
```

The action items are the value. A postmortem with no action items is a story; the runbook gets longer because of action items.

## Appendix: the surfaces in one table

| Surface                                    | Purpose                              | Auth                       |
| ------------------------------------------ | ------------------------------------ | -------------------------- |
| `GET /api/admin/webhooks/health`           | Monitor-facing health JSON (200/503) | Bearer or admin user       |
| `GET /admin/webhooks`                      | Human dashboard for backlog triage   | Admin user (404 otherwise) |
| `POST /api/admin/webhooks/replay` (single) | `{"eventId":"evt_..."}`              | Bearer or admin user       |
| `POST /api/admin/webhooks/replay` (batch)  | `{"olderThanMs":N,"limit":N}`        | Bearer or admin user       |
| `POST /admin/webhooks?/replay`             | Form action: per-row replay button   | Admin user                 |
| `POST /admin/webhooks?/replayBatch`        | Form action: "Replay all" button     | Admin user                 |
| Sentry                                     | Error reports, tagged with `req_id`  | Sentry login               |
| `event.locals.logger.*`                    | Structured logs, every server path   | n/a (server-side)          |

## What's next

Bonus 16 starts the **production hardening track** — Vercel adapter configuration, runtime selection (Node vs Edge), prerender vs ssr decisions per route. Operations is what you do _after_ a problem; hardening is what you do to prevent it.
