# Lesson 6.1 — Setup Stripe Node Client

Module 5 set up the catalog. Module 6 starts integrating: install the
Stripe Node SDK, lock down the API key story, and stand up the
singleton client every server route in Modules 6–10 will import from.

## What we install

```bash
pnpm add stripe
```

That's it — one runtime dependency, no companion type packages (the
SDK ships its own types, generated from the same internal schema
Stripe runs against in production).

Pinned versions at the time this module was authored:

| Package  | Version | Notes                                              |
| -------- | ------- | -------------------------------------------------- |
| `stripe` | `^22`   | Latest major. Targets Node 18+; we're on Node 20+. |

## Restricted API Keys (RAKs) — the only key you should ship

Stripe issues two flavors of secret credential:

| Prefix | Type               | Permissions                                                        |
| ------ | ------------------ | ------------------------------------------------------------------ |
| `sk_*` | Secret Key         | Full access. Anything you can do in the Dashboard, the key can do. |
| `rk_*` | Restricted API Key | Only the scopes you check off when creating the key.               |

The Stripe security best-practices skill is unambiguous: **default to
RAKs and treat secret keys as a fallback for one-off Dashboard scripts
you run locally, never something an application loads at boot.** The
`STRIPE_SECRET_KEY` env var Contactly reads accepts both prefixes, but
if you give it an `sk_*` key it's because you skipped the safer path.

### The minimum scopes Contactly needs

Create an `rk_test_...` in **Developers → API keys → Create restricted
key** with exactly these permissions checked:

| Resource          | Permission | Why                                                    |
| ----------------- | ---------- | ------------------------------------------------------ |
| Customers         | Write      | Lazily create + update Customer records (Module 7.3).  |
| Checkout Sessions | Write      | The "Upgrade" CTA mints these (Module 9.1).            |
| Billing Portal    | Write      | Self-service plan management (Module 9.7–9.8).         |
| Prices            | Read       | Pricing-page and webhook handlers resolve lookup keys. |
| Products          | Read       | Render the catalog metadata.                           |
| Subscriptions     | Read       | Mirror state from webhooks; never mutate from the app. |
| Invoices          | Read       | "Recent invoices" UI (Module 13).                      |

Everything else stays unchecked. If Module 13+ adds a feature that
needs more scopes, mint a _new_ RAK with the additions — don't widen
this one in place.

When the key goes live (Module 12.5), repeat the process in live mode
and update production env. The two keys are independent and cannot
cross-pollute environments.

## The singleton

```ts
// src/lib/server/stripe.ts (excerpt)
export const STRIPE_API_VERSION = '2026-03-25.dahlia' satisfies Stripe.LatestApiVersion;

let cached: Stripe | undefined;

export function stripe(): Stripe {
	if (!cached) {
		cached = new Stripe(serverEnv.STRIPE_SECRET_KEY, {
			apiVersion: STRIPE_API_VERSION,
			appInfo: { name: 'contactly', version: '0.1.0', url: '...' },
			maxNetworkRetries: 2,
			timeout: 20_000
		});
	}
	return cached;
}
```

Three deliberate choices:

1. **`apiVersion` is a hard-coded literal.** Lesson 5.2 made this an
   architectural rule and `STRIPE_API_VERSION` enforces it: a Stripe
   account-level default upgrade can't change Contactly's behavior.
   The `satisfies Stripe.LatestApiVersion` keeps the literal in sync
   with the SDK's own type — when we bump the SDK and the literal
   becomes stale, `tsc` flags it.
2. **Lazy via `cached`.** SvelteKit evaluates server modules on
   route entry; routes that never touch Stripe shouldn't pay the
   `new Stripe(...)` cost.
3. **`appInfo`.** Shows up in Stripe's request logs as the
   integration identifier. Worth the four lines for the moment a
   Stripe support engineer asks "which of your three apps made this
   call" and you have the answer in the Dashboard.

## Idempotency, the helper edition

Every retryable mutation Contactly makes against Stripe's API will
travel through `withIdempotencyKey`:

```ts
import { stripe, withIdempotencyKey } from '$lib/server/stripe';

await withIdempotencyKey(`upgrade:${user.id}:${form.nonce}`, (key) =>
	stripe().checkout.sessions.create(
		{
			mode: 'subscription',
			line_items: [{ price: priceId, quantity: 1 }]
			/* ... */
		},
		{ idempotencyKey: key }
	)
);
```

Two things the helper enforces:

- **Every mutation declares a key.** Forgetting one becomes a code-
  review block, not a production duplicate.
- **A naming convention.** `<intent>:<scope>:<nonce>`, grep-able,
  meaningful in Stripe's request logs. The wrapper rejects
  trivially-short keys (`< 8` chars) at runtime.

Webhook idempotency is a different layer (storage-side dedupe on
`event.id`); Module 6.4 adds that table.

## Env validation

`src/lib/server/env.ts` now requires both:

| Var                     | Format checked                                                | First lesson it's required |
| ----------------------- | ------------------------------------------------------------- | -------------------------- |
| `STRIPE_SECRET_KEY`     | starts with `sk_test_` / `sk_live_` / `rk_test_` / `rk_live_` | 6.1                        |
| `STRIPE_WEBHOOK_SECRET` | starts with `whsec_`                                          | 6.3                        |

Missing or malformed keys fail `pnpm run build` with a precise
message, not a runtime "undefined" five minutes into a checkout flow.

The Playwright `webServer` config now ships syntactically-valid
**demo** values for both, so `pnpm run test:e2e` and `pnpm run build`
work without anyone signing into Stripe just to run the test suite.
The demo values are deliberately invalid as Stripe credentials — any
real API call returns 401 — so they can't accidentally hit a real
account.

## A four-pane workstation, updated

```text
┌─────────────────────────────┬─────────────────────────────┐
│ pnpm run dev                │ pnpm run stripe:listen       │
│ (SvelteKit + Vite)          │ (forwards webhooks to :5173)│
├─────────────────────────────┴─────────────────────────────┤
│ pnpm run db:start (one-time, then idle)                    │
└────────────────────────────────────────────────────────────┘
```

Dev pane sees the Stripe singleton's first request the moment a route
calls it. The listen pane delivers signed events. The DB stack is the
storage backplane. The fourth pane is yours.

Lesson 6.2 covers the webhook event surface in detail before Lesson
6.3 wires the receiving endpoint.
