# Documentation index

> One table. Every doc in this repo. Last-revised dates are kept current
> in the same commit that changes the doc itself.
>
> _Last revised: 2026-04-19_

---

## Repo-level docs

| Doc                                      | Purpose                                                       | Last revised |
| ---------------------------------------- | ------------------------------------------------------------- | ------------ |
| [`../README.md`](../README.md)           | Repo entry point — what's here, how to run it, where to look  | 2026-04-19   |
| [`./architecture.md`](./architecture.md) | Current state of the saas-pro course platform app             | 2026-04-19   |
| [`./README.md`](./README.md)             | This file                                                     | 2026-04-19   |
| [`../AGENTS.md`](../AGENTS.md)           | Canonical AI-agent rules (Cursor / Claude / Junie / Windsurf) | 2026-04-19   |
| [`../CLAUDE.md`](../CLAUDE.md)           | Pointer to `AGENTS.md` (kept for Claude Code defaults)        | 2026-04-19   |

---

## Contactly app — architecture & guides

| Doc                                                                        | Purpose                                             | Last revised |
| -------------------------------------------------------------------------- | --------------------------------------------------- | ------------ |
| [`../course/ARCHITECTURE.md`](../course/ARCHITECTURE.md)                   | Append-only ADRs that govern every contactly lesson | 2026-04-19   |
| [`../course/contactly/README.md`](../course/contactly/README.md)           | Contactly app guide — stack, scripts, module recap  | 2026-04-19   |
| [`../course/contactly/docs/README.md`](../course/contactly/docs/README.md) | Per-module doc index for the contactly app          | 2026-04-19   |

---

## Contactly app — per-module docs

Lesson-aligned implementation docs that explain _why_ the app's code
ended up the way it did. Run order matches the curriculum.

### Stripe primer (Modules 5–7)

| Doc                                                                                                                                        | Module |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`../course/contactly/docs/stripe/01-dashboard-overview.md`](../course/contactly/docs/stripe/01-dashboard-overview.md)                     | 5.1    |
| [`../course/contactly/docs/stripe/02-api-and-docs.md`](../course/contactly/docs/stripe/02-api-and-docs.md)                                 | 5.2    |
| [`../course/contactly/docs/stripe/03-stripe-cli.md`](../course/contactly/docs/stripe/03-stripe-cli.md)                                     | 5.3    |
| [`../course/contactly/docs/stripe/03-1-stripe-cli-wsl.md`](../course/contactly/docs/stripe/03-1-stripe-cli-wsl.md)                         | 5.3.1  |
| [`../course/contactly/docs/stripe/04-products-and-prices.md`](../course/contactly/docs/stripe/04-products-and-prices.md)                   | 5.4    |
| [`../course/contactly/docs/stripe/05-creating-products-and-prices.md`](../course/contactly/docs/stripe/05-creating-products-and-prices.md) | 5.5    |
| [`../course/contactly/docs/stripe/06-cleanup.md`](../course/contactly/docs/stripe/06-cleanup.md)                                           | 5.7    |
| [`../course/contactly/docs/stripe/07-stripe-node-client.md`](../course/contactly/docs/stripe/07-stripe-node-client.md)                     | 6.1    |
| [`../course/contactly/docs/stripe/08-webhooks-and-events.md`](../course/contactly/docs/stripe/08-webhooks-and-events.md)                   | 6.2    |
| [`../course/contactly/docs/stripe/09-webhook-endpoint.md`](../course/contactly/docs/stripe/09-webhook-endpoint.md)                         | 6.3    |
| [`../course/contactly/docs/stripe/10-webhook-dev-script.md`](../course/contactly/docs/stripe/10-webhook-dev-script.md)                     | 6.3.1  |
| [`../course/contactly/docs/stripe/11-what-data-to-store.md`](../course/contactly/docs/stripe/11-what-data-to-store.md)                     | 6.4    |
| [`../course/contactly/docs/stripe/12-billing-tables.md`](../course/contactly/docs/stripe/12-billing-tables.md)                             | 7.1    |
| [`../course/contactly/docs/stripe/13-products-service.md`](../course/contactly/docs/stripe/13-products-service.md)                         | 7.2    |
| [`../course/contactly/docs/stripe/14-customers-service.md`](../course/contactly/docs/stripe/14-customers-service.md)                       | 7.3    |
| [`../course/contactly/docs/stripe/15-subscriptions-service.md`](../course/contactly/docs/stripe/15-subscriptions-service.md)               | 7.4    |

### Billing surface (Modules 8–9)

| Doc                                                                                                                                                  | Module |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`../course/contactly/docs/billing/01-pricing-catalog.md`](../course/contactly/docs/billing/01-pricing-catalog.md)                                   | 8.1    |
| [`../course/contactly/docs/billing/02-pricing-page.md`](../course/contactly/docs/billing/02-pricing-page.md)                                         | 8.2    |
| [`../course/contactly/docs/billing/03-entitlements-and-plan-badge.md`](../course/contactly/docs/billing/03-entitlements-and-plan-badge.md)           | 8.3    |
| [`../course/contactly/docs/billing/04-account-plan-section.md`](../course/contactly/docs/billing/04-account-plan-section.md)                         | 8.4    |
| [`../course/contactly/docs/billing/05-fail-closed-contact-cap.md`](../course/contactly/docs/billing/05-fail-closed-contact-cap.md)                   | 8.5    |
| [`../course/contactly/docs/billing/06-checkout-session.md`](../course/contactly/docs/billing/06-checkout-session.md)                                 | 9.1    |
| [`../course/contactly/docs/billing/07-checkout-cta-wiring.md`](../course/contactly/docs/billing/07-checkout-cta-wiring.md)                           | 9.2    |
| [`../course/contactly/docs/billing/08-billing-portal.md`](../course/contactly/docs/billing/08-billing-portal.md)                                     | 9.3    |
| [`../course/contactly/docs/billing/09-checkout-success-and-trial-guard.md`](../course/contactly/docs/billing/09-checkout-success-and-trial-guard.md) | 9.4    |
| [`../course/contactly/docs/billing/10-invoice-mirror-and-history.md`](../course/contactly/docs/billing/10-invoice-mirror-and-history.md)             | 9.5    |

### Operations & observability (Module 10)

| Doc                                                                                                                          | Module  |
| ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| [`../course/contactly/docs/operations/01-structured-logger.md`](../course/contactly/docs/operations/01-structured-logger.md) | 10.1    |
| [`../course/contactly/docs/operations/02-sentry.md`](../course/contactly/docs/operations/02-sentry.md)                       | 10.2    |
| [`../course/contactly/docs/operations/03-webhook-health.md`](../course/contactly/docs/operations/03-webhook-health.md)       | 10.3    |
| [`../course/contactly/docs/operations/04-webhook-replay.md`](../course/contactly/docs/operations/04-webhook-replay.md)       | 10.4    |
| [`../course/contactly/docs/operations/05-runbook.md`](../course/contactly/docs/operations/05-runbook.md)                     | 10.5    |
| [`../course/contactly/docs/operations/00-module-10-wrap.md`](../course/contactly/docs/operations/00-module-10-wrap.md)       | 10 wrap |

### Production deploy & hardening (Module 11)

| Doc                                                                                                                    | Module |
| ---------------------------------------------------------------------------------------------------------------------- | ------ |
| [`../course/contactly/docs/deploy/01-vercel-adapter.md`](../course/contactly/docs/deploy/01-vercel-adapter.md)         | 11.1   |
| [`../course/contactly/docs/deploy/02-sentry-source-maps.md`](../course/contactly/docs/deploy/02-sentry-source-maps.md) | 11.2   |
| [`../course/contactly/docs/deploy/03-release-pin.md`](../course/contactly/docs/deploy/03-release-pin.md)               | 11.3   |
| [`../course/contactly/docs/deploy/04-security-headers.md`](../course/contactly/docs/deploy/04-security-headers.md)     | 11.4   |
| [`../course/contactly/docs/deploy/05-runbook-and-wrap.md`](../course/contactly/docs/deploy/05-runbook-and-wrap.md)     | 11.5   |
| [`../course/contactly/docs/deploy/06-secret-rotation.md`](../course/contactly/docs/deploy/06-secret-rotation.md)       | Ops    |

### Cassette test harness (Module 12)

| Doc                                                                                                                      | Module |
| ------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`../course/contactly/docs/testing/01-cassette-format.md`](../course/contactly/docs/testing/01-cassette-format.md)       | 12.1   |
| [`../course/contactly/docs/testing/02-cassette-signing.md`](../course/contactly/docs/testing/02-cassette-signing.md)     | 12.2   |
| [`../course/contactly/docs/testing/03-cassette-driver.md`](../course/contactly/docs/testing/03-cassette-driver.md)       | 12.3   |
| [`../course/contactly/docs/testing/04-cassette-scenarios.md`](../course/contactly/docs/testing/04-cassette-scenarios.md) | 12.4   |
| [`../course/contactly/docs/testing/05-ci-and-wrap.md`](../course/contactly/docs/testing/05-ci-and-wrap.md)               | 12.5   |

---

## Course curriculum (lesson markdown the saas-pro app renders)

The lesson **content** itself lives in [`../src/content/`](../src/content/),
one folder per module. Each `*.md` file has frontmatter
(`title`, `module`, `lesson`, `slug`, `description`, `duration`,
`preview`) consumed by `src/lib/server/lessons/content.service.ts`.

The high-level shape is:

```
src/content/
├── module-00-introduction/        ← Welcome + course mechanics
├── module-01-project-setup/       ← SvelteKit + local Supabase
├── module-02-supabase-integration/← SDKs + server/client clients
├── module-03-user-auth/           ← Sign up / in / out, account
├── module-04-crud/                ← Contacts CRUD + seeding
├── module-05-stripe-intro/        ← Dashboard, CLI, products, prices
├── module-06-stripe-sveltekit/    ← Webhook receiver, what to store
├── module-07-billing-services/    ← Tables + service layer
├── module-08-pricing-page/        ← Pricing UX backed by mirror
├── module-09-checkout-billing/    ← Checkout, trials, portal
├── module-10-access-control/      ← Tier gates, multi-trial guard
├── module-11-testing/             ← Playwright auth + CRUD coverage
├── module-12-cicd/                ← CI/CD pipeline + Vercel + Supabase
├── module-13-ux-extras/           ← Toasts, redirects, branding
└── module-14-thank-you/           ← Bonus lessons (OAuth, search, realtime, …)
```

Update `src/lib/config/curriculum.config.ts` when adding/renaming a
lesson — the registry is what powers navigation in the lesson viewer.

---

## How to keep this index honest

1. When you add or remove a doc, update the relevant table here in the
   same commit.
2. Bump the `_Last revised:_` line of any doc you materially change, and
   reflect that date in the table.
3. CI does not enforce these dates. Code review does.
