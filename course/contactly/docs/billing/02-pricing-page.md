# 02 — Marketing /pricing page (Module 8.2)

Lesson 8.1 produced the typed view-model. This lesson lands the
public route that consumes it: `src/routes/(marketing)/pricing/`,
two files, ~270 lines total.

## File layout

```text
src/routes/(marketing)/pricing/
├── +page.server.ts   # data load → buildPricingCatalog
└── +page.svelte      # 4-card grid + interval toggle + FAQ
```

## The server load is intentionally boring

```ts
export const load: PageServerLoad = async () => {
	try {
		const rows = await listActivePlans();
		return { cards: buildPricingCatalog(rows), loadError: false as const };
	} catch (err) {
		console.error('[pricing] failed; rendering with empty rows', err);
		return { cards: buildPricingCatalog([]), loadError: true as const };
	}
};
```

Two design decisions worth highlighting:

### 1. The page must render even when the DB is on fire

`listActivePlans()` reads from Supabase. Every external dependency
in a request path is a potential cause of a 500. A 500 on the
**pricing page** is a revenue incident — visitors arrive ready to
convert, see a broken page, and leave.

So we catch the error, return an empty rows array, and pass a
`loadError: true as const` flag to the page. The catalog function
still produces three cards (Starter + Pro + Business — Lesson 8.1
guarantees Starter is always present and the paid cards still render
their static copy and feature lists). The dollar headlines fall
through to "Coming soon" and a banner at the top of the page tells
the visitor "Live prices are temporarily unavailable" without
breaking the layout. The `Sign up — it's free` CTA still works.

`as const` on the discriminator is deliberate: the page can use
`{#if data.loadError}` and TypeScript narrows to the guaranteed
shape on each branch.

### 2. No auth guard

`/pricing` is a marketing surface, NOT an `(app)` route. Visitors
who aren't signed in see "Sign up — it's free" CTAs; signed-in
visitors see "Go to dashboard" (Module 9 will swap that for "Start
trial / Subscribe" once Checkout lands). The page never reads the
user's tier — that decision belongs to the entitlements module
(Lesson 8.3) and surfaces inside `(app)`.

Keeping the marketing page tier-agnostic means its HTML is the same
for every visitor (within a given interval toggle state), so when
the marketing site moves to its own deployment in Module 12 a CDN
can cache aggressively.

## The page is presentation only

Two pieces of state:

```ts
let interval: BillingInterval = $state('yearly');
const cards: PricingCard[] = $derived(data.cards);
```

The interval defaults to `yearly` because the ADR-007 yearly
discount is the message we want above the fold. Every dollar amount
on screen comes from `card.prices[interval].formatted`, which was
computed on the server in `buildPricingCatalog`. The client never
reformats — that's what guarantees no hydration mismatch warning.

### Snippet-driven layout

The four-card grid uses `{#snippet planCard(card)}` and `{@render
planCard(card)}` — Svelte 5's first-class composition primitive.
Doing this inline (one big `{#each}` body) would be ~120 lines of
nested markup; pulling it into a snippet keeps `<main>` readable as
a 30-line outline and keeps the per-card details in one place.

The interval toggle is also a snippet, for the same reason.

`{@const price = priceFor(card)}` inside the snippet computes the
currently-visible price once per card per render, so the
`{#if price}` and the `{price.formatted}` rendering both read from
the same source.

### Interval toggle UX

```html
<div role="tablist" aria-label="Billing interval">
	<button role="tab" aria-selected="{interval" ="" ="" ="monthly" } onclick="{()" ="">
		(interval = 'monthly')}> Monthly
	</button>
	<button role="tab" aria-selected="{interval" ="" ="" ="yearly" } onclick="{()" ="">
		(interval = 'yearly')}> Yearly <span>Save 17%</span>
	</button>
</div>
```

Real `<button>` elements with `role="tab"` give us focus rings, the
Enter/Space activation, and `aria-selected` styling for free —
nothing fancy, just the right semantic primitives. No keyboard
arrow-key handler because there are only two options and Tab
already cycles through them; ARIA Authoring Practices says
arrow-key handling is for tablists with more than ~3 panels.

The `Save 17%` badge re-skins itself when the yearly tab is active
(`bg-white/20` over the brand fill instead of `bg-emerald-100`).
That's pure Tailwind in `cn()` — no extra component needed.

## Wired into the marketing nav

`MarketingNav.svelte` gains a single link:

```svelte
<a href={resolve('/pricing')} data-testid="nav-pricing-link">Pricing</a>
```

`resolve()` is the SvelteKit 2 typed-paths helper (`$app/paths`); a
typo gets caught at `pnpm run check` time, not at click time.

## What's NOT in this lesson (deliberate)

- **No Checkout.** The CTA links to `/sign-up` (or `/dashboard` for
  signed-in users). The "Subscribe to Pro" button arrives in
  Module 9.1 alongside the Checkout endpoint. Linking to `/sign-up`
  here means the funnel still works end-to-end today: visitor sees
  the price ladder → signs up → lands on dashboard → comes back to
  upgrade once Checkout exists.
- **No tier highlighting.** Even when a logged-in Pro user visits
  `/pricing`, every card shows the same CTA. The "You're on Pro"
  callout belongs on `/account` (Lesson 8.4) where it has context;
  on a public marketing page it'd be noise.
- **No Stripe price ID in the URL.** Because no Checkout yet — the
  page model already exposes `card.prices.monthly.priceId` for when
  Module 9 wires up the action.
- **No prerender.** Prices come from the webhook stream, so the
  rendered HTML can go stale. SSR + a CDN cache header (added when
  the marketing site moves in Module 12) is the right compromise.

## Tests

The unit tests in `catalog.test.ts` (Lesson 8.1) cover every
permutation of the data the page renders. The next test that needs
writing is a Playwright e2e — "given a fresh seed, the four cards
render with the canonical fixture prices." That lands in Lesson 8.5
when the e2e suite needs upgrading anyway for the entitlement gate.

## Next

Lesson 8.3: surface `tier` and the active subscription inside
`(app)/+layout.server.ts` and render a plan badge in `AppNav` so
every authenticated screen shows the user their current entitlement
level at a glance.
