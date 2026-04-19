# Lesson 9.3 — Billing Portal session + "Manage billing" wiring

> **Module 9 — Checkout & billing portal**
> Previous: [07 — Checkout CTA wiring](./07-checkout-cta-wiring.md)
> Next: 09 — Post-checkout success page + serial-trial guard (Lesson 9.4)

## Goal

Give every paying user a one-click path to Stripe's hosted **Customer
Portal**, where they can swap plan (with proration), update their card,
download invoices, or cancel — without us writing a single line of
"manage subscription" UI.

By the end of this lesson, the **Manage billing** button on `/account`
posts to a new `/api/billing/portal` endpoint that 303s the browser
straight into the Stripe-hosted portal. When the user is done, Stripe
sends them back to `/account`.

## Why use the Customer Portal at all

The Stripe billing skill is unambiguous about this:

> The Customer Portal is the recommended surface for self-service
> subscription management. Build it before building anything else.

Every feature it ships — proration preview, dunning emails, payment
method UX, invoice history, "are you sure you want to cancel" flow —
is one we'd otherwise have to build, test, and maintain. None of those
are differentiators for Contactly. They are pure cost.

We do not own that code. We open the portal.

## Module map

| File                                                          | Layer                | Role                                                                                                                                |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/billing/portal.ts` _(new)_                    | Service              | `createPortalSession({ user, origin, returnPath? })` → `{ kind: 'redirect', url } \| { kind: 'refused', reason: 'no_customer' }`.   |
| `src/routes/api/billing/portal/+server.ts` _(new)_            | HTTP boundary (POST) | Auth → `safeRedirectPath`-sanitize `return_path` → call service → 303 to portal (or to `/pricing` on refusal).                      |
| `src/lib/components/billing/ManageBillingForm.svelte` _(new)_ | UI primitive         | Tiny `<form method="POST" action="/api/billing/portal">` wrapper with a Button + loading state. Symmetric to `UpgradeCheckoutForm`. |
| `src/lib/components/billing/PlanSection.svelte` _(modified)_  | UI                   | Replaces the disabled placeholder button on `/account` with the live `ManageBillingForm`.                                           |
| `src/routes/(marketing)/pricing/+page.svelte` _(modified)_    | UI                   | Adds `?portal=no-customer` flash for users redirected here from the refusal path.                                                   |

Same shape as Lesson 9.1: pure-ish service + thin HTTP route + reusable
form. No new env, no new tables, no new migrations.

## Design

### Service: `createPortalSession`

```ts
export type CreatePortalResult =
	| { kind: 'redirect'; url: string }
	| { kind: 'refused'; reason: 'no_customer' };
```

Three real things happen inside it:

1. **Look up the cached Stripe customer id** via a single `maybeSingle()`
   on `stripe_customers`.
   - **Why we don't lazy-create here.** `ensureStripeCustomer` (used by
     checkout, Lesson 9.1) lazy-creates a customer on first call. The
     Portal route deliberately doesn't. Opening the Customer Portal for
     a user who has never had a subscription is a UX dead-end: the
     portal renders with no plan to manage and no invoices to show.
     Sending them to `/pricing` is a better outcome.
   - That's the entire reason `'refused' | 'no_customer'` exists.
2. **Mint the portal session** with `stripe().billingPortal.sessions.create({ customer, return_url })`.
   - `return_url` is built off the request's `url.origin`, _not_ a
     compile-time `PUBLIC_APP_URL`. Same rationale as Lesson 9.1:
     correct in dev, preview, prod, and `127.0.0.1` without a per-env
     branch.
   - The portal config (which products to allow swapping, whether
     cancellation is enabled, etc.) lives in the **Stripe Dashboard**.
     We do not pass `configuration` here — letting product/ops adjust
     the portal without a deploy is the whole point.
3. **Return the URL.** The result is single-use and short-lived; we do
   not cache it. Every "Manage billing" click mints a fresh one.

### Refusals are returned, not thrown

Same convention as `createSubscriptionCheckoutSession`: business
"can't do that" cases (`no_customer`) come back as a tagged result and
the route turns them into a 303. Throws are reserved for the truly
unexpected — Stripe API error, DB outage, missing `session.url`.

The HTTP route knows nothing about portal semantics; it just maps:

```text
'redirect'              → 303 result.url             (off to Stripe)
'refused' no_customer   → 303 /pricing?portal=no-customer
unhandled exception     → 502 "Could not open billing portal..."
```

### Idempotency: 5-minute bucket

Stripe Billing Portal sessions are themselves single-use, so generous
idempotency buckets would just hide the "user actually clicked twice"
story without saving any API cost. We pick **5 minutes**:

```text
portal:user-<id>:bucket-<floor(now / 5min)>
```

Tight enough that `Date.now()` jitter never collides; long enough that
a real frantic double-click hits the same key and Stripe returns the
same session. Anything beyond that, the user gets a fresh URL — fine,
the previous one expires soon anyway.

### `return_path` is sanitized

The form supports an optional `return_path` hidden input so future
features (e.g. a "Manage billing" button on a per-team settings page)
can return the user to where they started. Anything passed in is fed
through `safeRedirectPath` first — same helper that protects sign-in's
`?next` parameter from open-redirect attacks. Failure falls back to
`/account`.

The route accepts both `application/x-www-form-urlencoded` (the
default for `<form method="POST">`) and `application/json` (for any
future JS callers). All paths converge on `safeRedirectPath` before
the value reaches Stripe.

## UI: `ManageBillingForm` — symmetric sibling of `UpgradeCheckoutForm`

```svelte
<form method="POST" action="/api/billing/portal" data-testid={testid} onsubmit={onSubmit}>
	{#if returnPath}
		<input type="hidden" name="return_path" value={returnPath} />
	{/if}
	<Button type="submit" {variant} loading={submitting} disabled={submitting}>
		{label}
	</Button>
</form>
```

Same UX contract as the upgrade form:

- **Plain HTML form, no JS required.** Submits, server 303s, browser
  follows. JS off, screen reader, slow Android — all the same path.
- **Progressive enhancement.** With JS, an internal `submitting` flag
  flips the Button into its loading state for the (typically
  500–1500 ms) Stripe round-trip. We never reset it to `false` —
  the page navigates away on success, and on rare server failure the
  browser stays on `/account` showing the spinner long enough to feel
  weird, which is the right signal that something's wrong (a flash
  banner is added in a follow-up if we see it in the wild).
- **`data-testid` plumbed through** so Playwright can find the right
  form on `/account` without coupling to the rendered label.

### `PlanSection` updates

Before:

```svelte
<!-- Pro / Business -->
<Button
	type="button"
	variant="secondary"
	disabled
	title="Self-serve billing portal arrives in Module 9.3"
>
	Manage billing
</Button>
```

After:

```svelte
{#if entitlements.tier === 'pro'}
	<Button href={resolve('/pricing')} variant="primary">Upgrade to Business</Button>
	<ManageBillingForm testid="plan-manage-billing-cta" />
{:else}
	<!-- business -->
	<ManageBillingForm variant="primary" testid="plan-manage-billing-cta" />
{/if}
```

The Starter branch does **not** render `ManageBillingForm` — Starter
users have no Stripe customer (lazy-created on first checkout, ADR-002),
so opening the Portal would land on an empty page. They get an
**Upgrade** link to `/pricing` instead. That mirrors the refusal logic
in the service layer: don't open an empty portal.

### The `?portal=no-customer` flash on `/pricing`

The HTTP route's refusal path 303s the user to
`/pricing?portal=no-customer`. Without a flash banner, that looks like
a silent navigation failure. We add one:

> You don't have a paid plan yet, so the billing portal isn't
> available. Pick a plan below to get started.

Plain language, no Stripe jargon, points the user at the next correct
action — same writing rule as the `?checkout=cancelled` flash from
Lesson 9.2.

## What we deliberately did not do

- **No serial-trial guard yet.** That's Lesson 9.4 — same place we add
  the post-checkout success page.
- **No PaymentMethod attach UI.** The portal owns this; we don't need
  to.
- **No invoice mirror surface.** Lesson 9.5 mirrors `invoice.*` events
  into a local table for the in-app billing history list. The Portal's
  "Invoice history" tab is enough until then.
- **No webhook plumbing.** Subscription state is already kept in sync
  by the `customer.subscription.*` handlers from Module 7. The Portal
  emits the same events when a user upgrades/cancels through it — we
  catch them automatically.
- **No `use:enhance`.** Same rationale as Lesson 9.2: we want the
  browser to follow Stripe's 303, not the SvelteKit form runtime to
  intercept it.

## Manual verification checklist

1. **Free user clicks "Upgrade" on `/account`.** Lands on `/pricing`,
   no banner. (No-op.)
2. **Pro user clicks "Manage billing" on `/account`.** Briefly sees the
   button spinner, lands on the Stripe Customer Portal with the
   correct customer's plan and invoices.
3. **Cancel from the portal "X" → return to `/account`.** Lands back
   on `/account`, plan unchanged.
4. **Free user manually opens `/api/billing/portal` (POST via curl with a session cookie).**
   303s to `/pricing?portal=no-customer`, banner shows.
5. **Logged-out POST to `/api/billing/portal`.** 303s to
   `/sign-in?next=/account`.
6. **Cross-origin POST.** SvelteKit's CSRF check returns 403 — confirmed
   by Lesson 9.1's checkout endpoint, same protection here.

## Tests

Pure-function coverage for `createPortalSession` requires Stripe + DB
mocks; we cover the meaningful branches in the integration tier
alongside the existing checkout integration tests in Module 10. The
unit tier in this lesson stays at **0 added tests** for the service —
all behavior reachable here is either a single Stripe call (already
mocked end-to-end in our cassette tests) or a simple DB read whose
behavior is identical to the one already covered for
`ensureStripeCustomer`. Adding a unit test that just re-asserts "we
called `billingPortal.sessions.create` with this customer" would test
the mock, not the code.

The compile-time gate (`pnpm run check`), prettier (`pnpm run lint`),
and the existing 110-test suite all stay green.

## Try it

```bash
pnpm dev
# 1. Sign in as a Pro user.
# 2. /account → "Manage billing" → portal opens.
# 3. Sign in as a Starter user.
# 4. POST /api/billing/portal manually → /pricing?portal=no-customer.
```

[Back to course README](../../README.md)
