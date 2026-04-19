# Contactly — documentation index

> Per-module implementation docs that explain the _why_ behind every
> change the course makes to the contactly app. Keep `Last revised` up to
> date in the same commit you change a doc.
>
> _Last revised: 2026-04-19_

---

## How to read this

- One folder per major surface (`stripe/`, `billing/`, `operations/`,
  `deploy/`, `testing/`).
- Files are numbered to match the order the lessons reach them. The
  number after the dash is the lesson within the module.
- Every doc is paired with the lesson markdown in
  [`../../src/content/`](../../src/content/) at the repo root and with
  the code state captured at the matching `course/lesson-MM-LL-*` git tag.

For repo-level architecture, see
[`../../docs/architecture.md`](../../docs/architecture.md). For the
append-only ADRs that govern the design, see
[`../ARCHITECTURE.md`](../ARCHITECTURE.md).

---

## Stripe primer & integration (Modules 5–7)

| #     | Doc                                                                                        | What it documents                           |
| ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 5.1   | [`stripe/01-dashboard-overview.md`](./stripe/01-dashboard-overview.md)                     | Stripe Dashboard tour                       |
| 5.2   | [`stripe/02-api-and-docs.md`](./stripe/02-api-and-docs.md)                                 | Stripe API + docs orientation               |
| 5.3   | [`stripe/03-stripe-cli.md`](./stripe/03-stripe-cli.md)                                     | Installing the Stripe CLI                   |
| 5.3.1 | [`stripe/03-1-stripe-cli-wsl.md`](./stripe/03-1-stripe-cli-wsl.md)                         | WSL-specific install caveats                |
| 5.4   | [`stripe/04-products-and-prices.md`](./stripe/04-products-and-prices.md)                   | Products + Prices model                     |
| 5.5   | [`stripe/05-creating-products-and-prices.md`](./stripe/05-creating-products-and-prices.md) | Hand-built fixtures for Contactly's catalog |
| 5.7   | [`stripe/06-cleanup.md`](./stripe/06-cleanup.md)                                           | Idempotent Stripe cleanup script            |
| 6.1   | [`stripe/07-stripe-node-client.md`](./stripe/07-stripe-node-client.md)                     | `src/lib/server/stripe.ts` SDK singleton    |
| 6.2   | [`stripe/08-webhooks-and-events.md`](./stripe/08-webhooks-and-events.md)                   | Webhook event types + Contactly's subset    |
| 6.3   | [`stripe/09-webhook-endpoint.md`](./stripe/09-webhook-endpoint.md)                         | `POST /api/webhooks/stripe` receiver        |
| 6.3.1 | [`stripe/10-webhook-dev-script.md`](./stripe/10-webhook-dev-script.md)                     | `pnpm run stripe:listen` dev forwarding     |
| 6.4   | [`stripe/11-what-data-to-store.md`](./stripe/11-what-data-to-store.md)                     | The `WHAT_TO_STORE` inventory               |
| 7.1   | [`stripe/12-billing-tables.md`](./stripe/12-billing-tables.md)                             | Billing tables migration                    |
| 7.2   | [`stripe/13-products-service.md`](./stripe/13-products-service.md)                         | `products.ts` service                       |
| 7.3   | [`stripe/14-customers-service.md`](./stripe/14-customers-service.md)                       | `customers.ts` service                      |
| 7.4   | [`stripe/15-subscriptions-service.md`](./stripe/15-subscriptions-service.md)               | `subscriptions.ts` lifecycle mirror         |

---

## Billing surface (Modules 8–9)

| #   | Doc                                                                                                  | What it documents                          |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 8.1 | [`billing/01-pricing-catalog.md`](./billing/01-pricing-catalog.md)                                   | Pricing catalog driven by mirrored data    |
| 8.2 | [`billing/02-pricing-page.md`](./billing/02-pricing-page.md)                                         | `/pricing` page server load + UX           |
| 8.3 | [`billing/03-entitlements-and-plan-badge.md`](./billing/03-entitlements-and-plan-badge.md)           | Entitlements + `PlanBadge` component       |
| 8.4 | [`billing/04-account-plan-section.md`](./billing/04-account-plan-section.md)                         | Account-page Plan section                  |
| 8.5 | [`billing/05-fail-closed-contact-cap.md`](./billing/05-fail-closed-contact-cap.md)                   | Server-side, fail-closed contact cap       |
| 9.1 | [`billing/06-checkout-session.md`](./billing/06-checkout-session.md)                                 | Checkout session creation                  |
| 9.2 | [`billing/07-checkout-cta-wiring.md`](./billing/07-checkout-cta-wiring.md)                           | Pricing CTA → checkout wiring              |
| 9.3 | [`billing/08-billing-portal.md`](./billing/08-billing-portal.md)                                     | Billing Portal session                     |
| 9.4 | [`billing/09-checkout-success-and-trial-guard.md`](./billing/09-checkout-success-and-trial-guard.md) | `/checkout/success` trial-guard polling    |
| 9.5 | [`billing/10-invoice-mirror-and-history.md`](./billing/10-invoice-mirror-and-history.md)             | Invoice mirror + `account/billing` history |

---

## Operations & observability (Module 10)

| #    | Doc                                                                          | What it documents                                  |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| 10.1 | [`operations/01-structured-logger.md`](./operations/01-structured-logger.md) | `pino` logger + per-request correlation ids        |
| 10.2 | [`operations/02-sentry.md`](./operations/02-sentry.md)                       | Sentry SDKs (client + server) wired through hooks  |
| 10.3 | [`operations/03-webhook-health.md`](./operations/03-webhook-health.md)       | `/api/admin/webhooks/health` + `is_platform_admin` |
| 10.4 | [`operations/04-webhook-replay.md`](./operations/04-webhook-replay.md)       | `/admin/webhooks` dashboard + replay-by-event-id   |
| 10.5 | [`operations/05-runbook.md`](./operations/05-runbook.md)                     | On-call runbook                                    |
| Wrap | [`operations/00-module-10-wrap.md`](./operations/00-module-10-wrap.md)       | Module 10 wrap                                     |

---

## Production deploy & hardening (Module 11)

| #    | Doc                                                                    | What it documents                                                           |
| ---- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 11.1 | [`deploy/01-vercel-adapter.md`](./deploy/01-vercel-adapter.md)         | `@sveltejs/adapter-vercel` + `vercel.json` (runtime, region, memory, cache) |
| 11.2 | [`deploy/02-sentry-source-maps.md`](./deploy/02-sentry-source-maps.md) | `@sentry/vite-plugin` source-map upload, gated on the `SENTRY_*` triple     |
| 11.3 | [`deploy/03-release-pin.md`](./deploy/03-release-pin.md)               | `src/lib/release.ts` + `/api/version` + admin chrome deploy strip           |
| 11.4 | [`deploy/04-security-headers.md`](./deploy/04-security-headers.md)     | Per-environment HTTP security headers + dynamic `/robots.txt`               |
| 11.5 | [`deploy/05-runbook-and-wrap.md`](./deploy/05-runbook-and-wrap.md)     | Incident-shaped on-call runbook + Module 11 wrap                            |
| Ops  | [`deploy/06-secret-rotation.md`](./deploy/06-secret-rotation.md)       | CI deploy secret rotation runbook (Vercel + Supabase)                       |

---

## Cassette test harness (Module 12)

| #    | Doc                                                                      | What it documents                                                           |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 12.1 | [`testing/01-cassette-format.md`](./testing/01-cassette-format.md)       | Zod-validated cassette JSON format + loader; seed cassette                  |
| 12.2 | [`testing/02-cassette-signing.md`](./testing/02-cassette-signing.md)     | `signWebhookBody` / `signWebhookEvent` / `buildSignedWebhookRequest` helper |
| 12.3 | [`testing/03-cassette-driver.md`](./testing/03-cassette-driver.md)       | Transport-agnostic `playCassette({ transport, secret })`                    |
| 12.4 | [`testing/04-cassette-scenarios.md`](./testing/04-cassette-scenarios.md) | Three more cassettes (cancel, fail, recover) + 12 scenario tests            |
| 12.5 | [`testing/05-ci-and-wrap.md`](./testing/05-ci-and-wrap.md)               | Scoped GitHub Actions workflow + Module 12 wrap                             |

---

## Cross-cutting references

- [Contactly README](../README.md) — stack, scripts, module recap.
- [Contactly ADRs](../../course/ARCHITECTURE.md) — append-only design decisions.
- [Repo architecture](../../docs/architecture.md) — what's in the saas-pro app.
- [Repo docs index](../../docs/README.md) — every doc, repo-wide.
- [Agent rules](../../AGENTS.md) — what AI agents must do (and not do).
- [Secret rotation](./deploy/06-secret-rotation.md) — when CI fails on a secret.
