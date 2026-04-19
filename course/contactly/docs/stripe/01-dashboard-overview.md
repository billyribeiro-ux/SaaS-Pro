# Lesson 5.1 — Stripe Dashboard Overview

> **Module 5 — Stripe Introduction.** Before we touch a single line of
> Stripe SDK code, we orient ourselves in the Stripe Dashboard. The
> Dashboard is the source of truth for everything the API operates on:
> products, prices, customers, subscriptions, invoices, payouts, and
> webhook endpoints all live there first and the API mirrors them.

## Test mode vs. live mode

The Dashboard has **two completely isolated environments**:

| Mode      | URL prefix                                      | Purpose                                                                   |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Test mode | <https://dashboard.stripe.com/test/...>         | Safe sandbox. Test cards (`4242 4242 4242 4242`) work, real cards do not. |
| Live mode | <https://dashboard.stripe.com/...> (no `/test`) | Real money. Real cards work, test cards do not.                           |

Both modes have separate API keys, separate products, separate
customers, and separate webhook endpoints. **Toggle between them with
the switch in the top-left of the Dashboard.** The entire Contactly
course is built and graded in test mode; live-mode setup is a Module 12
discussion.

> **Habit to build now.** Whenever you copy a key, an ID, or a URL out
> of the Dashboard, glance at the address bar first. Test-mode IDs
> almost always contain the substring `test` or end with `_test`, but
> not always — the only reliable check is the URL.

## The map: where things live

Every menu item under "Product catalog", "Customers", and "Billing" maps
1:1 to an API resource we'll work with later in the course:

| Dashboard section              | API resource                                                 | Module |
| ------------------------------ | ------------------------------------------------------------ | ------ |
| Product catalog → **Products** | `Product` ([API](https://docs.stripe.com/api/products.md))   | 5.5    |
| Product catalog → **Pricing**  | `Price` ([API](https://docs.stripe.com/api/prices.md))       | 5.5    |
| Product catalog → **Coupons**  | `Coupon` / `PromotionCode`                                   | 13+    |
| Customers                      | `Customer` ([API](https://docs.stripe.com/api/customers.md)) | 7.3    |
| Billing → **Subscriptions**    | `Subscription`                                               | 7.4    |
| Billing → **Invoices**         | `Invoice`                                                    | 7.4    |
| Payments                       | `PaymentIntent`, `Charge`                                    | (info) |
| Developers → **Webhooks**      | `WebhookEndpoint`                                            | 6.2    |
| Developers → **API keys**      | (no API resource — managed in Dashboard only)                | 5.3    |
| Developers → **Logs**          | All API requests, the single best debugging tool             | 6.2    |
| Developers → **Events**        | The event log webhooks consume from                          | 6.2    |

Bookmark **Developers → Logs** before you do anything else. When a
webhook misfires or an API call returns 400, that's where you read the
exact request and response Stripe saw — it's a strictly better view
than your application logs because Stripe sees the wire-level truth.

## The five views you'll live in during this course

1. **Product catalog → Products.** We seed Pro and Business here in
   Lesson 5.5; the Customer Portal renders directly off this catalog.
2. **Customers → (any customer) → Subscriptions tab.** Where you see
   the live state of an active subscription, including its trial end,
   next invoice date, and metadata.
3. **Developers → Webhooks → (your endpoint) → Webhook attempts.**
   Where you debug "the webhook fired but my app didn't react." Each
   attempt shows the exact payload, the response code your endpoint
   returned, and how many retries Stripe will queue.
4. **Developers → Events.** The chronological tape of everything that
   happened in the account. Filter by event type when reproducing a
   bug.
5. **Workbench (the right-side slide-out).** Replay any past event
   against your local webhook listener. We use this constantly in
   Module 6.

## Account checklist before Lesson 5.2

- [ ] You have a Stripe account at <https://dashboard.stripe.com>.
      A personal account is fine for the course.
- [ ] You can toggle between **Test mode** and **Live mode**.
- [ ] You can find **Developers → API keys** in test mode and you see
      both a publishable key (`pk_test_...`) and a secret key
      (`sk_test_...`). Don't copy either yet — Lesson 5.3 walks
      through the safer way (a Restricted API Key + the Stripe CLI).
- [ ] You can find **Developers → Webhooks** in test mode (it should
      be empty). Lesson 6.3 will populate it.

## Why this lesson exists

Most Stripe integrations fail because the developer doesn't know what
the Dashboard would have shown them. They write code, get a confusing
error, and start guessing. The pattern we're going to drill repeatedly
is:

1. **Dashboard first.** Look at Developers → Logs and Developers →
   Events to see what Stripe actually saw.
2. **CLI second.** Use `stripe listen`, `stripe trigger`, and
   `stripe events resend` (Lesson 5.3) to reproduce the situation.
3. **Code third.** Only now write or modify the integration.

Internalize that order now. The rest of the Stripe modules are easier
when you stop fighting the platform's own observability and start using
it.
