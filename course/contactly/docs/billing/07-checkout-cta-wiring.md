# Lesson 9.2 — Wiring upgrade CTAs through checkout

## Goal

Take the `POST /api/billing/checkout` endpoint shipped in Lesson 9.1
and wire every "buy a plan" surface in the app to it:

- The three cards on `/pricing`
- The "Upgrade" / "Upgrade to Business" buttons in the `/account` Plan section
- The contacts cap banner's "Upgrade to add more" CTA

…with one shared component, one wire-protocol, and a flash-message
loop for the two outcomes the endpoint can produce that the user
needs to see.

## The reusable form: `<UpgradeCheckoutForm>`

```text
src/lib/components/billing/UpgradeCheckoutForm.svelte
```

One place to evolve the wire-protocol, the loading UX, and the
test-id convention. Every caller looks like:

```svelte
<UpgradeCheckoutForm lookupKey={price.lookupKey} variant="primary" testid="pricing-cta-pro" />
```

The component renders nothing more than:

```html
<form method="POST" action="/api/billing/checkout">
	<input type="hidden" name="lookup_key" value="..." />
	<button type="submit">Start 14-day trial</button>
</form>
```

Everything beyond that is presentation:

- Routes through the existing `<Button>` primitive so the variants
  (`primary` / `secondary`) match the rest of the app exactly.
- Tracks an internal `submitting` boolean, set on submit and never
  reset (the page navigates away on success, so a spinner stuck in
  the "loading" state for the ~800–2000 ms round-trip to Stripe is
  the correct UX — no flash back to "idle" right before the
  redirect).
- `data-lookup-key` on the form makes Playwright assertions tight
  without coupling them to the visible label.

**No-JS users still work.** The form is plain HTML; the browser
follows the 303 to Stripe-hosted Checkout. The `submitting` spinner
is purely a JS-progressive-enhancement nicety.

## Pricing page — one branch per (auth × tier)

`src/routes/(marketing)/pricing/+page.svelte` was previously a single
"Sign up — it's free" / "Go to dashboard" button on every card. Now it
fans into four branches:

| Card     | Anonymous                                                | Authenticated                                            |
| -------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Starter  | `<a href="/sign-up">`                                    | `<a href="/dashboard">`                                  |
| Pro      | `<a href="/sign-up?next=/pricing">` "Start 14-day trial" | `<UpgradeCheckoutForm lookupKey="contactly_pro_*">`      |
| Business | `<a href="/sign-up?next=/pricing">` "Start 14-day trial" | `<UpgradeCheckoutForm lookupKey="contactly_business_*">` |

- **Starter is never a checkout.** It's the absence of a Stripe
  subscription (ADR-007), so its CTA is always navigation.
- **Anonymous users on a paid card** go through `/sign-up?next=/pricing`,
  which lands them right back on the pricing page with the same
  cards selected. They re-click and the branch becomes the form-post
  branch.
- **The form posts `lookup_key`, never `price_id`.** `lookup_key` is
  type-narrowed against the `LookupKey` union on the server. Anyone
  who tampers with the hidden input gets a 400 long before they hit
  Stripe.
- **No client-side tier check.** The endpoint is the source of truth
  on "can this user open this checkout?". A Pro user clicking the
  Business card lands at `/account?upgrade=needs-portal` via the
  endpoint's "already subscribed" branch — no work required on the
  pricing page.

There's also a graceful-degradation branch: if the price object
itself didn't load (`data.loadError === true` and the catalog has
nulls), the CTA renders as a disabled "Currently unavailable"
button. The page still renders the curated copy + bullets; the
visitor just can't transact.

## Two new flash banners

Stripe's hosted Checkout is a side-trip — when the user comes back,
they need a visible "you're in the right place" message. Two
banners now exist:

### `?checkout=cancelled` on `/pricing`

The `cancel_url` from Lesson 9.1's session params is
`${origin}/pricing?checkout=cancelled`. When the user clicks "back"
from the Stripe hosted page, they land here with a slate banner
that confirms the no-card-charged state and invites them to retry.

### `?upgrade=needs-portal` and `?checkout=cancelled` on `/account`

The endpoint redirects users with active subscriptions to
`/account?upgrade=needs-portal`. The new amber banner above the
Plan section explains the "Manage billing" CTA is the right path —
which Lesson 9.3 turns into a real Stripe Billing Portal redirect.

The cancel-flash on `/account` is a parallel courtesy for when an
authenticated user backs out: any future flow that uses `/account`
as a return surface (e.g. a re-auth bounce) gets the same "no card
charged" reassurance for free.

## Per-card `interval` selection

The pricing page state still owns the monthly/yearly toggle. Each
`<UpgradeCheckoutForm>` is mounted with the `lookupKey` derived from
the **currently visible** `CatalogPrice` for that card. When the
user flips the toggle, the form re-mounts with the new lookup key —
no need for the form itself to be aware of the interval at all.

Every active price's lookup key matches `contactly_<tier>_<interval>`
by construction (see `src/lib/billing/lookup-keys.ts`). That single
lookup-key is sufficient input for the server to know exactly which
Stripe price to load.

## Why no `use:enhance`?

`use:enhance` from Superforms would normally be the right choice for
form posts in this app — it wraps the submit, runs the action, and
manages the `delayed`/`submitting` stores. Two reasons we don't use
it here:

1. **The endpoint is `+server.ts`, not a form action.** `use:enhance`
   targets SvelteKit form actions (`?/name`) and doesn't speak the
   POST-to-an-API-endpoint protocol.
2. **303 → external redirect.** `use:enhance` intercepts the response
   to keep the user on the same page. We _want_ the browser to
   follow the 303 to `https://checkout.stripe.com/...`. A native form
   submit does that for free.

A simple `onsubmit` handler that toggles `submitting = true` is
plenty: the page is leaving, the spinner just needs to be visible
during the network round-trip.

## What we deliberately did NOT do

- **Inline pricing on `/account`.** The Upgrade button on the Plan
  section continues to send the user to `/pricing` where they can
  pick interval and tier. Inlining a checkout form on `/account`
  would mean choosing a default interval, which is a marketing
  decision that belongs on the marketing page.
- **Skipping the pre-flight tier check on the pricing page.** We
  could short-circuit the form for users we know are already
  subscribed, but that would mean loading entitlements on every
  pricing-page hit (anonymous AND authenticated), which kills the
  page's caching story. Letting the endpoint handle the refusal
  costs one extra round-trip in the rare "Pro user clicks
  Business" case and zero in every other.
- **Replacing the contacts-cap "Upgrade to add more" button.** That
  button still uses an `<a href="/pricing">` because the user has
  to pick a tier and interval. It funnels through the same
  /pricing → checkout flow as everything else.

## Files touched

New:

- `src/lib/components/billing/UpgradeCheckoutForm.svelte` — the shared form
- `docs/billing/07-checkout-cta-wiring.md` — this doc

Edited:

- `src/routes/(marketing)/pricing/+page.svelte` — per-card per-auth branching + cancel flash
- `src/routes/(app)/account/+page.svelte` — `?upgrade=needs-portal` + `?checkout=cancelled` banners

## Up next

Lesson 9.3 — Billing Portal session creation + wiring the "Manage
billing" button on `/account` so paid users have a self-serve
upgrade / downgrade / cancel surface. Same pattern: pure session
builder, async shell, tiny POST endpoint, one form post.
