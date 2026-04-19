# Lesson 9.1 — Checkout Session creation

## Goal

Turn an authenticated user + a `LookupKey` into a redirectable Stripe
hosted Checkout URL, with every Contactly invariant baked in:

- `mode: 'subscription'` (Billing API; never roll your own renewals)
- Stripe Tax + required billing-address collection (ADR-006)
- 14-day free trial with up-front card capture (ADR-007)
- Lookup-key-driven price selection (Lesson 5.6); never trust client-supplied price IDs
- Stripe Idempotency-Key + a local "already-subscribed" pre-check
- Per-request `origin` for success/cancel URLs so preview deploys stay self-consistent

## Module map

```
src/lib/server/billing/
  ├── checkout.ts          ← createSubscriptionCheckoutSession (async shell)
  │                        ← buildSubscriptionCheckoutParams   (pure, tested)
  └── checkout.test.ts     ← unit tests for the params builder

src/routes/api/billing/checkout/
  └── +server.ts           ← POST /api/billing/checkout (form submit target)
```

## Pure params builder, async shell

```text
                  buildSubscriptionCheckoutParams        ← pure: customer + price + user + origin → params
                              ▲
                              │
              createSubscriptionCheckoutSession          ← async shell: pre-check, ensure customer, idempotency, Stripe
                              ▲
                              │
                  POST /api/billing/checkout             ← HTTP boundary: auth, CSRF, input narrowing, 303
                              ▲
                              │
              <form method="POST" action="/api/billing/checkout">
                <input name="lookup_key" value="contactly_pro_monthly">
              </form>
```

The same separation we used for the entitlement gate (Lesson 8.5) and the
entitlement snapshot (8.3): the rule (params we always pass to Stripe) is a
pure function with unit tests, the I/O wraps it.

## What `buildSubscriptionCheckoutParams` always sets

Every test in `checkout.test.ts` exists to lock one of these in place so
nobody accidentally drops a guarantee in a future refactor:

| Field                                 | Value                                                                | Why                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `mode`                                | `'subscription'`                                                     | Billing API handles renewal, dunning, proration. Never use raw PaymentIntents for recurring revenue.         |
| `automatic_tax.enabled`               | `true`                                                               | ADR-006. Stripe Tax computes the correct line at checkout.                                                   |
| `billing_address_collection`          | `'required'`                                                         | Required input for Stripe Tax + saved on the Customer for future invoices.                                   |
| `customer_update`                     | `{ address: 'auto', name: 'auto' }`                                  | Push the entered address back onto the Customer so subsequent invoices don't re-prompt.                      |
| `payment_method_collection`           | `'always'`                                                           | Capture the card up-front _during_ the trial. Trial-end "card now please" prompts cut conversion 3-5x.       |
| `allow_promotion_codes`               | `true`                                                               | Operator-controlled — codes live in the Stripe Dashboard.                                                    |
| `client_reference_id`                 | `userId`                                                             | Surfaces in Stripe Dashboard search; free correlation for support.                                           |
| `metadata` (top + subscription)       | `{ user_id, lookup_key, tier, interval }`                            | Lets the success page + `checkout.session.completed` handler audit without re-fetching.                      |
| `subscription_data.description`       | `Contactly Pro (monthly)` etc.                                       | Shows on the customer's invoice — clearer than "Subscription to Pro Monthly".                                |
| `subscription_data.trial_period_days` | `14` (or omitted when `0`)                                           | ADR-007. Lesson 9.4 will replace the constant with a serial-trial guard.                                     |
| `success_url`                         | `${origin}/account/billing/success?session_id={CHECKOUT_SESSION_ID}` | Per-request origin keeps Vercel preview deploys self-consistent. `{CHECKOUT_SESSION_ID}` is Stripe-expanded. |
| `cancel_url`                          | `${origin}/pricing?checkout=cancelled`                               | The user is back on the pricing page with a flash so they can retry without losing context.                  |
| `locale`                              | `'en'`                                                               | Locks language; matches the locale-stable currency formatting on the pricing page.                           |

## Why per-request `origin` and not `PUBLIC_APP_URL`

A single env var would 99% work — but the 1% breaks the developer
experience hard. Vercel preview deploys, custom domains, `localhost`, and
multi-region setups all serve the same build with different origins.
Reading `url.origin` from the request guarantees the user lands back on
the exact host they came from, every time. The success page can't
accidentally bounce a preview-deploy purchaser into production.

## "Already subscribed" — local pre-check

Stripe will happily let a user open a second Checkout Session on top of
an existing subscription. We refuse it server-side and return
`{ kind: 'refused', reason: 'already_subscribed' }`. The HTTP layer turns
that into `303 → /account?upgrade=needs-portal` so the user lands at the
Billing Portal CTA (Lesson 9.3) where plan changes happen with proration.

This is one of three layers protecting against duplicates:

1. **App layer** — this pre-check. Friendly redirect.
2. **Stripe Idempotency-Key** — same `(user, lookup_key, day)` returns
   the same Session URL within 24h. Double-clicks coalesce.
3. **DB partial unique index** — `stripe_subscriptions_one_active_per_user`
   from Lesson 7.1 makes "two active subscriptions for one user" a
   `23505` at the mirror upsert, even if both upper layers regress.

## Idempotency key shape

```ts
const day = new Date().toISOString().slice(0, 10);
const key = `checkout:user-${user.id}:lk-${lookupKey}:${day}`;
```

Day-bucketed because:

- Stripe's idempotency cache is ~24h. Anything wider buys nothing.
- A user retrying tomorrow expects a fresh session (the previous one
  may have expired Stripe-side anyway).
- Same-day double-clicks coalesce to the same hosted page — the user
  doesn't get confused by two slightly-different URLs in their tab
  history.

The optional `idempotencySuffix` parameter lets a future explicit "Retry"
button mint a fresh key without resetting the clock.

## HTTP endpoint: `POST /api/billing/checkout`

The endpoint is intentionally tiny — auth, CSRF (built into SvelteKit),
input narrowing, dispatch, redirect. All policy is in the service layer.

| Outcome                                       | HTTP response                                                    |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Anonymous POST                                | `303 → /sign-in?next=/pricing` (so user can retry after sign-in) |
| Missing/unknown `lookup_key`                  | `400 Unknown plan`                                               |
| User already has trialing/active/past_due sub | `303 → /account?upgrade=needs-portal`                            |
| Stripe-API failure                            | `502 Could not start checkout. Please try again.`                |
| Happy path                                    | `303 → ${session.url}` (Stripe-hosted Checkout)                  |

Both `application/x-www-form-urlencoded` (default HTML form) and
`application/json` bodies are accepted, so a future `fetch()` caller
doesn't need to construct a `FormData`.

The `try/catch` re-throws SvelteKit's `redirect()` sentinel so we don't
accidentally turn our own happy-path 303 into a 502.

## Why `+server.ts`, not a form action

A form action requires a `+page.svelte` companion. This route is
side-effect-only: there is no UI to render. A bare `+server.ts` POST
handler is the right shape — and SvelteKit's CSRF protection (origin
checking on POSTs) applies equally.

The form on the pricing page is plain HTML — no JS required:

```html
<form method="POST" action="/api/billing/checkout">
	<input type="hidden" name="lookup_key" value="contactly_pro_monthly" />
	<button type="submit">Start free trial</button>
</form>
```

Lesson 9.2 wires this up across `/pricing`, `/account` and the contacts
cap banner.

## What we deliberately did NOT do

- **Embedded Checkout (`ui_mode: 'embedded'`).** Hosted Checkout has
  better PCI scope, native Apple/Google Pay, and zero rendering cost.
  We can iterate to embedded later if the marketing data justifies it;
  starting hosted is the lower-risk default.
- **`subscription_schedule`.** Schedules are for "switch plans on a
  future date" workflows. Contactly's pricing is flat: pick a plan,
  start the trial. Schedules add complexity with no payoff yet.
- **`payment_method_options.card.request_three_d_secure: 'any'`.**
  Stripe's default ('automatic') already handles 3DS triggers. Forcing
  `any` adds friction on every card, every time, with measurable
  conversion loss.

## Files touched

New:

- `src/lib/server/billing/checkout.ts`
- `src/lib/server/billing/checkout.test.ts` (8 unit tests)
- `src/routes/api/billing/checkout/+server.ts`

## Up next

Lesson 9.2 — wire the upgrade CTAs across `/pricing`, `/account`, and
the contacts cap banners through the new endpoint. Today every
"Upgrade" button is a `href`; tomorrow it becomes a real form post.
