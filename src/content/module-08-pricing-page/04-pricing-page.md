---
title: '8.4 - Pricing Page'
module: 8
lesson: 4
moduleSlug: 'module-08-pricing-page'
lessonSlug: '04-pricing-page'
description: 'Build the pricing page that fetches live prices from Stripe using lookup keys.'
duration: 18
preview: false
---

## Overview

Everything in this module has been setup. This lesson is the payoff: a live `/pricing` page, fetching real prices from Stripe on every request, rendering three responsive cards with formatted amounts, a highlighted "Best value" tier, and a CTA button per card ready to kick off checkout in Module 9.

The page has two files:

1. `src/routes/(marketing)/pricing/+page.server.ts` — the **load function**. Runs on the server for every request. Talks to Stripe via the secret key, zips live price data with the tier config from lesson 8.3, and returns a clean, ready-to-render `tiers` array.
2. `src/routes/(marketing)/pricing/+page.svelte` — the UI. Uses Svelte 5 runes to read the `data` prop, formats prices with `Intl.NumberFormat`, and renders three `<article>` cards with Tailwind.

Pay attention to three themes throughout:

- **SSR is the right choice for pricing.** Prices need to show up in the HTML on first paint — for SEO, for perceived performance, and because users shouldn't see a blank card while JavaScript boots.
- **Defensive zipping.** The tier config is in our repo; the price data is in Stripe. Either side can be "missing" a row. The page should degrade gracefully — render the tier, disable the button, show "Coming soon" — rather than crashing.
- **Progressive enhancement.** The CTA button is a real HTML form posting to a real URL. Even if JavaScript fails to load, the user can still start checkout. Module 9 builds the `/api/billing/checkout` handler the form posts to.

## Prerequisites

- Lesson 8.1 — three Stripe prices with the lookup keys `contactly_monthly`, `contactly_yearly`, `contactly_lifetime` exist in your test account.
- Lesson 8.2 — you've run the seed script (or verified the prices exist in the dashboard).
- Lesson 8.3 — `src/lib/config/pricing.config.ts` exports `PRICING_TIERS` and `PRICING_LOOKUP_KEYS`.
- A working `src/lib/server/stripe.ts` module that exports an instantiated `Stripe` client with `apiVersion: '2026-03-25.dahlia'`. (Set up in Module 5; if you skipped it, minimum viable version below.)
- A `(marketing)` route group for the public-facing site (Module 3's `(auth)` / `(app)` pattern — if you haven't made `(marketing)` yet, we'll cover it in Step 1).

### A minimum `src/lib/server/stripe.ts`

If you don't already have one, create it now:

```typescript
// src/lib/server/stripe.ts
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia'
});
```

Note that `$server` in this project aliases to `$lib/server` per the project's TS paths, so in some code you'll see `import { stripe } from '$server/stripe'`. Use whichever the project is configured for. Both resolve to the same file.

## What You'll Build

- `src/routes/(marketing)/pricing/+page.server.ts` with a typed `load` function that calls `stripe.prices.list`.
- A `Map` from `lookup_key → Stripe.Price` for O(1) lookup during tier zipping.
- Graceful error handling for missing prices (disabled CTA, "Coming soon" label).
- `src/routes/(marketing)/pricing/+page.svelte` using `$props()`, no stores, no `export let`.
- Currency formatting via `Intl.NumberFormat`.
- A three-column responsive grid with Tailwind, a highlighted card with a floating "Best value" badge, and a `<form>` CTA per card.

---

## Step 1: The `(marketing)` Route Group

SvelteKit route groups (wrapping folder names in parentheses) don't show up in URLs; they just share a layout. Our app has:

- `(auth)` — login, register pages with a chromeless centered layout.
- `(app)` — authenticated dashboard area with a navbar + sidebar.
- `(marketing)` — public pages like `/`, `/pricing`, `/about`. A regular landing-page layout with a top nav and footer.

If you haven't created `(marketing)` yet, here's a minimal layout. Create `src/routes/(marketing)/+layout.svelte`:

```svelte
<!-- src/routes/(marketing)/+layout.svelte -->
<script lang="ts">
	let { children } = $props();
</script>

<div class="min-h-screen bg-white">
	<nav class="border-b border-gray-200">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
			<a href="/" class="font-bold text-gray-900">Contactly</a>
			<div class="flex items-center gap-4 text-sm">
				<a href="/pricing" class="text-gray-600 hover:text-gray-900">Pricing</a>
				<a href="/login" class="text-gray-600 hover:text-gray-900">Log in</a>
				<a
					href="/register"
					class="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
					>Sign up</a
				>
			</div>
		</div>
	</nav>

	{@render children()}
</div>
```

Note the Svelte 5 conventions: `let { children } = $props()` and `{@render children()}`. Never `<slot />`, never `$app/stores`.

Now make the directory for the pricing page:

```bash
mkdir -p "src/routes/(marketing)/pricing"
```

---

## Step 2: The Load Function — `+page.server.ts`

This runs on the server for every request to `/pricing`. It talks to Stripe, zips live prices with the tier config, and returns the result to the Svelte component.

Create `src/routes/(marketing)/pricing/+page.server.ts`:

```typescript
// src/routes/(marketing)/pricing/+page.server.ts
import { error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { PRICING_TIERS } from '$lib/config/pricing.config';
import { stripe } from '$lib/server/stripe';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const prices = await stripe.prices.list({
			lookup_keys: PRICING_TIERS.map((t) => t.lookup_key),
			active: true,
			expand: ['data.product']
		});

		// Map lookup_key → Stripe.Price for O(1) joining with our tier config.
		const byLookupKey = new Map<string, Stripe.Price>();
		for (const price of prices.data) {
			if (price.lookup_key) byLookupKey.set(price.lookup_key, price);
		}

		const tiers = PRICING_TIERS.map((tier) => {
			const price = byLookupKey.get(tier.lookup_key);
			return {
				...tier,
				price_id: price?.id ?? null,
				unit_amount: price?.unit_amount ?? null,
				currency: price?.currency ?? 'usd',
				interval: price?.recurring?.interval ?? null
			};
		});

		return { tiers };
	} catch (e) {
		console.error('Failed to load Stripe prices', e);
		throw error(500, 'Unable to load pricing at the moment. Please try again.');
	}
};
```

Let's walk through it.

### `import type { PageServerLoad } from './$types'`

SvelteKit auto-generates a type for this file's `load` function. Using `PageServerLoad` gives you full type safety on the `event` parameter (even though we don't destructure it here) and flags the return type as something the page component can consume. **Always import from `./$types`** in route files — never handwrite these types.

### `stripe.prices.list({ lookup_keys, active: true, expand: ['data.product'] })`

Three options worth unpacking.

- **`lookup_keys: PRICING_TIERS.map((t) => t.lookup_key)`** — we ask Stripe for exactly the three prices our config knows about, by stable name. The response contains _at most_ three prices (fewer if one is archived or deleted in Stripe). Because we go in with named requests, we never accidentally pick up unrelated prices the marketing team created in the dashboard for an experiment.
- **`active: true`** — exclude archived prices. Stripe never deletes prices (they're referenced by subscriptions forever); instead it marks them `active: false`. If you archive a price and replace it with a new one using `transfer_lookup_key`, `active: true` filters the old one out automatically.
- **`expand: ['data.product']`** — Stripe responses use references: a `Price` has a `product` field that's just a product ID string by default. `expand: ['data.product']` tells Stripe "inline the full product object on each price in the response". You pay one extra round-trip on the Stripe side; you save a separate `stripe.products.retrieve` call per price. For three prices, one expand call is much cheaper. For 100+ prices, it starts mattering the other way (Stripe caps `expand` fan-out). We have three.

### Building the `Map`

```typescript
const byLookupKey = new Map<string, Stripe.Price>();
for (const price of prices.data) {
	if (price.lookup_key) byLookupKey.set(price.lookup_key, price);
}
```

Two reasons for a `Map` rather than a plain object:

1. `Map` has O(1) `get` and `set` with typed keys; plain objects rely on prototype-walking and string coercion.
2. We want to iterate over `PRICING_TIERS` (not over the Stripe response). The config is the source of truth for _what should be rendered_; Stripe is the source of truth for _the numbers_. Wrapping Stripe's data in a `Map` keyed by lookup_key gives us a fast, typed "look up the price for this tier" primitive.

The `if (price.lookup_key)` guard exists because Stripe's `lookup_key` field is technically nullable in the type definition — a price _can_ have no lookup key. We skip those; our zip depends on the key being present.

### The zip

```typescript
const tiers = PRICING_TIERS.map((tier) => {
	const price = byLookupKey.get(tier.lookup_key);
	return {
		...tier,
		price_id: price?.id ?? null,
		unit_amount: price?.unit_amount ?? null,
		currency: price?.currency ?? 'usd',
		interval: price?.recurring?.interval ?? null
	};
});
```

For each tier in the config, we look up its matching Stripe price and attach the pricing fields:

- `price_id` — used by the CTA form later. Null means "Stripe didn't return this price"; the UI disables the button.
- `unit_amount` — cents. `9700` for $97. Null if missing.
- `currency` — `'usd'`. Falls back to USD if missing.
- `interval` — `'month'` / `'year'` / `undefined`. `undefined` for one-time prices (Lifetime).

Notice we keep the full tier data (`...tier`) and add fields. The returned `tiers` array is a superset: config fields + live fields. The Svelte component just reads `tier.name`, `tier.unit_amount`, `tier.interval` — uniformly, whether the source was config or Stripe.

### Error handling

```typescript
} catch (e) {
  console.error('Failed to load Stripe prices', e)
  throw error(500, 'Unable to load pricing at the moment. Please try again.')
}
```

If Stripe is down, auth fails, or the API key is invalid, we log the raw error on the server (where operators can see it) and throw a user-friendly error via SvelteKit's `error()` helper. The default error page renders with a 500 status. Users don't see "Stripe API error: invalid_request_error" — they see a sensible fallback.

**Why not return a fallback?** You _could_ return `{ tiers: PRICING_TIERS.map(t => ({ ...t, price_id: null })) }` and render the page with all CTAs disabled. That's a legitimate choice. The reason we `throw error()` instead: if Stripe is down, the page is **misinforming** users about what's for sale. Better to flag the problem than paint a broken UI. Your call depends on uptime expectations and how much you trust Stripe's SLA (very much, in practice).

---

## Step 3: The Page Component — `+page.svelte`

Now the UI. Create `src/routes/(marketing)/pricing/+page.svelte`:

```svelte
<!-- src/routes/(marketing)/pricing/+page.svelte -->
<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const currency = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});

	function formatAmount(cents: number | null | undefined) {
		if (cents == null) return '—';
		return currency.format(cents / 100);
	}
</script>

<svelte:head>
	<title>Pricing — Contactly</title>
	<meta name="description" content="Simple pricing. Pick the plan that fits." />
</svelte:head>

<section class="mx-auto max-w-6xl px-4 py-16">
	<header class="mb-12 text-center">
		<h1 class="mb-3 text-4xl font-bold text-gray-900">Simple, honest pricing</h1>
		<p class="text-gray-500">Pick the plan that fits. Cancel anytime.</p>
	</header>

	<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
		{#each data.tiers as tier (tier.id)}
			<article
				class="relative flex flex-col rounded-2xl border p-8 {tier.highlighted
					? 'border-blue-500 bg-white ring-2 ring-blue-500'
					: 'border-gray-200 bg-white'}"
			>
				{#if tier.badge}
					<span
						class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
					>
						{tier.badge}
					</span>
				{/if}

				<h2 class="text-lg font-semibold text-gray-900">{tier.name}</h2>
				<p class="mt-1 mb-6 text-sm text-gray-500">{tier.description}</p>

				<div class="mb-6">
					<span class="text-4xl font-bold text-gray-900">
						{formatAmount(tier.unit_amount)}
					</span>
					{#if tier.interval}
						<span class="ml-1 text-sm text-gray-500">/ {tier.interval}</span>
					{/if}
				</div>

				<ul class="mb-8 flex-1 space-y-2">
					{#each tier.features as feature (feature)}
						<li class="flex items-start text-sm text-gray-700">
							<span class="mr-2 text-blue-600">✓</span>
							<span>{feature}</span>
						</li>
					{/each}
				</ul>

				<form method="POST" action="/api/billing/checkout">
					<input type="hidden" name="lookup_key" value={tier.lookup_key} />
					<button
						type="submit"
						disabled={!tier.price_id}
						class="w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 {tier.highlighted
							? 'bg-blue-600 text-white hover:bg-blue-700'
							: 'bg-gray-900 text-white hover:bg-gray-800'}"
					>
						{tier.price_id ? 'Get started' : 'Coming soon'}
					</button>
				</form>
			</article>
		{/each}
	</div>
</section>
```

Let's walk through the interesting parts.

### `import type { PageServerData } from './$types'`

Just like the load function imported `PageServerLoad`, the page component imports `PageServerData` — the _return type_ of the load function. This gives `data` full autocomplete: `data.tiers[number].name`, `data.tiers[number].unit_amount`, etc.

### `let { data }: { data: PageServerData } = $props()`

The Svelte 5 runes way to read page props. No `export let data`. No `$app/stores`. The pattern is identical in layouts and pages: `let { ... } = $props()`.

### `Intl.NumberFormat`

```typescript
const currency = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0
});
```

`Intl.NumberFormat` is the standard way to format currencies. Better than `'$' + (cents / 100).toFixed(2)` because:

- It respects locale: `'en-US'` gives `$97`, `'de-DE'` gives `97,00 $`, `'ja-JP'` gives `¥97`.
- It handles currency symbols correctly (some currencies use suffixes, some prefixes).
- `maximumFractionDigits: 0` hides the `.00` on whole-dollar amounts — which matches the way pricing pages typically display round numbers. If your prices had cents ($97.50), you'd set `maximumFractionDigits: 2`.

For a multi-currency pricing page you'd build `currency` dynamically per tier (`tier.currency.toUpperCase()`). Today every Contactly price is in USD, so a single formatter instance is fine.

### `formatAmount(cents)`

```typescript
function formatAmount(cents: number | null | undefined) {
	if (cents == null) return '—';
	return currency.format(cents / 100);
}
```

`cents == null` (double equals) catches both `null` and `undefined`. If the load function returned `unit_amount: null` because Stripe was missing the price, we show an em dash instead of crashing. Small detail, correct behaviour.

### `<svelte:head>`

SEO matters on public pages. `<title>` is the tab label and the primary SEO signal. `<meta name="description">` shows up in Google snippets. Without SSR (see Principal Engineer Note 1), crawlers might not see either. With SSR, they're in the HTML on first response.

### The grid

```svelte
<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
```

Mobile-first: one column on small screens, three columns at the `md` breakpoint (768px) and up. `gap-6` adds 1.5rem between cards. Pricing cards stack cleanly on phones — critical because ~50% of landing-page traffic is mobile.

### The highlighted card

```svelte
class="... {tier.highlighted
	? 'border-blue-500 ring-2 ring-blue-500 bg-white'
	: 'border-gray-200 bg-white'}"
```

A conditional class expression embedded directly in the template. Svelte 5 supports the ternary-in-class-string pattern without `clsx`/`classnames` libraries. For a single boolean toggle, this is fine. For three or more conditional classes, pull it into a `$derived` expression or use `class:` directives.

The highlighted card gets a blue 2-pixel ring that visually "lifts" it above the others. Combined with the badge, the eye lands there first. Also verifiable with a squint test — pull back from the screen; if the highlighted card doesn't stand out, increase the contrast.

### The floating badge

```svelte
{#if tier.badge}
	<span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white ...">
		{tier.badge}
	</span>
{/if}
```

`absolute` positions it relative to the card's `relative` container. `-top-3` pulls it 0.75rem above the card's top edge. `left-1/2 -translate-x-1/2` is the classic "center an absolutely-positioned element" trick: move it to 50% of the parent's width, then shift it back by half its own width.

The `{#if tier.badge}` guard means cards without a badge have no empty `<span>` — useful for accessibility and for visual consistency.

### The features list

```svelte
<ul class="mb-8 flex-1 space-y-2">
	{#each tier.features as feature (feature)}
		<li class="flex items-start text-sm text-gray-700">
			<span class="mr-2 text-blue-600">✓</span>
			<span>{feature}</span>
		</li>
	{/each}
</ul>
```

`flex-1` on the `<ul>` makes it grow to fill available vertical space in the card. This is why the CTA button always sits at the bottom of the card — the list pushes everything below it downward. Cards with different feature counts still align their buttons.

The `{#each tier.features as feature (feature)}` uses the feature string itself as the key. For a static config-driven list this is fine (strings are unique within each tier). If features were editable at runtime, we'd want stable IDs instead.

### The CTA form

```svelte
<form method="POST" action="/api/billing/checkout">
	<input type="hidden" name="lookup_key" value={tier.lookup_key} />
	<button type="submit" disabled={!tier.price_id} ...>
		{tier.price_id ? 'Get started' : 'Coming soon'}
	</button>
</form>
```

Three decisions to note.

**Why a `<form>` and not a `<button on:click>` or an anchor?** Because this is a write action, not navigation. The user is telling the server "start a checkout for me". That's a POST. Using a form means:

- Works without JavaScript (progressive enhancement).
- `method="POST"` is explicit; no confusion about GET vs POST.
- CSRF protection via SvelteKit's form-action pipeline kicks in for free in Module 9.

**Why `name="lookup_key"` and not `name="price_id"`?** Because lookup keys are stable across Stripe environments; raw price IDs aren't. The `/api/billing/checkout` handler (Module 9) looks up the live price by key at request time — so if you later rotate the price (new amount, same lookup key), the checkout immediately reflects the new price without a deploy.

**Why `disabled={!tier.price_id}`?** If Stripe didn't return a price for this lookup key (archived, deleted, misconfigured), we don't want to send the user into a broken checkout. The button grays out. The label flips to "Coming soon". The user gets a clear "not available right now" signal instead of a server error page.

---

## Step 4: Run It

```bash
pnpm dev
```

Visit `http://localhost:5173/pricing`.

You should see:

- A centered page header: "Simple, honest pricing".
- Three cards side-by-side (or stacked on mobile).
- Monthly: `$97 / month`, white card, black "Get started" button.
- **Yearly: `$997 / year`, blue-ringed card, floating "Best value" badge, blue "Get started" button.**
- Lifetime: `$4,997` (no interval), white card, black "Get started" button.

Click any "Get started" button. You'll get a 404 for `/api/billing/checkout` — we haven't built it yet. That's fine; Module 9 covers it. The form submission is the only thing we're verifying here: it's a real POST, the `lookup_key` is in the body, the browser is honest about what it's sending.

### What if a price is missing?

To test graceful degradation, go into the Stripe dashboard, archive the Lifetime price. Reload `/pricing`. The Lifetime card should still render — description, features, everything — but with an em dash where the price was and a grayed-out "Coming soon" button. No crash, no error page. Unarchive the price when you're done.

---

## Common Mistakes

### Mistake 1: Using `$app/stores` to read `page.data`

Old SvelteKit tutorials and code samples reach for `import { page } from '$app/stores'` and do `$page.data.tiers`. In modern SvelteKit (2.12+) this is deprecated in favor of `$props()` for route-level data, and `$app/state` for non-data state. Our project banned `$app/stores` — stick with `let { data } = $props()`.

**Fix:** destructure `data` from `$props()` in the page component.

### Mistake 2: Forgetting `active: true`

If you archive and replace a price without passing `active: true` to `stripe.prices.list`, the response includes the archived price too. Your `Map` keyed by `lookup_key` might end up with the wrong price (the archived one) overwriting the new one, depending on response ordering.

**Fix:** always `active: true` on `prices.list` for the pricing page. Archived prices are graveyard data.

### Mistake 3: Returning cents instead of formatted strings

Tempting to do `formatAmount(tier.unit_amount)` on the server and ship a pre-formatted string to the client. Don't. The server's locale is wherever the server happens to run (often `en-US`, sometimes `C`, sometimes whatever the host sets). The user's locale is in their browser. Let `Intl.NumberFormat` format in the browser with `'en-US'` (or, eventually, `request.headers.get('accept-language')`).

**Fix:** return the raw integer cents from the server; format in the component.

### Mistake 4: Hardcoding the grid count to 3

`grid-cols-3` works today because we have three tiers. If marketing adds a fourth tier, you get a 4-card grid with weird spacing. A safer default: let the grid fill naturally: `lg:grid-cols-3 xl:grid-cols-4`, or use `auto-fit` with `minmax()`. For Contactly's scope, three tiers is a known constraint; we optimize for the common case. But know the tradeoff.

**Fix:** revisit when you add a fourth tier, not preemptively.

### Mistake 5: Putting the Stripe client in a client-side file

`src/lib/server/stripe.ts` lives in the `server/` subfolder for a reason: SvelteKit's bundler refuses to include files from `$lib/server/*` in client bundles. If you put the Stripe client in `$lib/stripe.ts` (no `server/`), a bundling error at best, or a leaked `STRIPE_SECRET_KEY` to the browser at worst.

**Fix:** always keep secret-key code in `$lib/server/`. Aliases and folder conventions enforce the safety.

### Mistake 6: Forgetting the page title

`<svelte:head><title>Pricing — Contactly</title></svelte:head>` feels minor but is a first-order SEO signal. Without it, browser tabs and Google both fall back to whatever the layout's title was (or no title at all, looking unprofessional).

**Fix:** every public page gets a unique `<title>` and meta description.

---

## Principal Engineer Notes

### 1. SSR vs CSR for pricing pages (SEO matters)

Our load function runs **on the server**. That means the HTML SvelteKit responds with on first request already contains the full pricing table. Three consequences:

- **Search engines see the content**: Googlebot renders JavaScript these days but still prefers (and ranks higher) pages where the content is in the server's initial HTML. Pricing pages earn direct organic traffic; you want them ranked.
- **First Contentful Paint is faster**: the user sees the prices before JavaScript downloads and executes. On a 3G connection that's a 1-2 second improvement, which materially affects bounce rate.
- **No flicker**: no "loading..." state, no skeleton, no card snapping into place mid-render. The page appears complete.

The tradeoff is every `/pricing` request costs you one Stripe API call. Stripe's rate limits (100 req/s in live mode) are generous; for a typical SaaS pricing page traffic pattern this never matters. If it did, you'd add a 60-second in-memory cache (or use Vercel's ISR) in front of the Stripe call. Don't optimize until you measure.

### 2. Currency formatting with `Intl.NumberFormat`

`Intl.NumberFormat` is a browser primitive (and Node primitive) you should reach for every time you display money. Beyond "it works":

- It's free — no library, no bundle cost.
- It's locale-aware — multi-currency / multi-locale pricing is one config-swap away.
- It handles edge cases: negative amounts, fractional currencies (JPY has no decimals; BHD has three), non-breaking spaces between symbol and number in certain locales.

The same goes for dates (`Intl.DateTimeFormat`), numbers generally (`Intl.NumberFormat` with `style: 'decimal'`), relative times (`Intl.RelativeTimeFormat`). The browser has been internationalizing for you for a decade; use it.

### 3. A/B testing price display

A pricing page is one of the highest-leverage A/B testing surfaces in a SaaS. Small changes — monthly-first vs annual-first, "$97" vs "$97/mo", "Best value" vs "Most popular" — can move conversion 10-30%.

The way to make this easy: every variable is in config (lesson 8.3), every variable has a name (the `PricingTier` interface), and the component reads config by name. To A/B test "Best value" vs "Most popular", you read the badge from a feature flag instead of a static string:

```typescript
badge: featureFlag('pricing_badge_copy', { a: 'Best value', b: 'Most popular' });
```

Because the config-to-component wiring is already declarative, plugging in a flag is a one-line change, not a component rewrite. This is the compounding value of the config-driven design from lesson 8.3: every iteration on pricing copy is cheap, and cheap iteration is how you actually A/B test to wins.

### 4. The CTA form as progressive enhancement

Our button is inside a `<form method="POST">`. Even if JavaScript fails to load (ad-blocker misfires, slow connection, corporate proxy stripping bundles), the user can click "Get started" and the browser posts the form like it's 1997. The `/api/billing/checkout` handler (Module 9) will be a plain POST endpoint that can redirect to Stripe Checkout on a non-JS response path.

This seems paranoid in 2026. It isn't. Payment pages are where you least want "oops, JS crashed". And the work to support no-JS is zero — you just use standard HTML. Most modern "JS-or-nothing" CTAs are self-inflicted fragility.

### 5. The shape of `data` is a contract

The load function returns `{ tiers }`. The component expects `data.tiers`. That's a contract. When you change the load function to return `{ tiers, featuredTier }` later, the component can destructure `featuredTier`. When you rename `tiers` to `plans`, the component needs updating in lockstep.

This is where `./$types` earns its keep: rename `tiers` in the load function and `PageServerData` auto-propagates the rename. The component gets a TS error pointing at the exact spot. You never ship a mismatch to prod.

Treat route-file types as the canonical contract between server and component. They're the cheapest, most reliable API you'll ever have — because you own both sides.

### 6. When to move to remote functions (Module 9 teaser)

In Module 9 you'll see SvelteKit's **remote functions** (via `$app/server`) for more complex server interactions (checkout creation, portal session creation). For simple "render a page with some fetched data" use-cases like this one, a `+page.server.ts` load function is perfect — simpler, SSR-native, cache-friendly. Know both patterns; use the lighter one when it suffices.

### 7. What if Stripe is down?

We `throw error(500, ...)`. That means the page is fully unavailable. In a production SaaS, you might want one of:

- A stale-while-revalidate cache: serve the last-known-good prices, even if Stripe is briefly down.
- A "contact sales" fallback: if prices are unavailable, show a "talk to us" card.
- A static marketing-only view (no live amounts) as ultimate fallback.

All of those are layers on top of what we built. The right choice depends on how critical pricing page uptime is to your business, and how much you trust Stripe's availability. (For most SaaS, Stripe's availability is higher than your own app's.)

---

## Summary

- Built `src/routes/(marketing)/pricing/+page.server.ts` — a typed SvelteKit load function that calls `stripe.prices.list({ lookup_keys, active: true, expand: ['data.product'] })`.
- Constructed a `Map<lookup_key, Stripe.Price>` for clean O(1) zipping with `PRICING_TIERS` from the config.
- Returned a superset `tiers` array (config fields + live Stripe fields) ready for the component to render.
- Built `src/routes/(marketing)/pricing/+page.svelte` using Svelte 5 runes (`let { data } = $props()`), with no stores and no `<slot />`.
- Rendered three Tailwind cards in a responsive grid, with a floating "Best value" badge on the highlighted tier.
- Used `Intl.NumberFormat` to format amounts locale-aware, with graceful fallback (em dash) when a price is missing.
- Made the CTA a real HTML form posting `lookup_key` to `/api/billing/checkout`, so the flow works with and without JavaScript.
- Covered error handling: Stripe down → `error(500)`; individual price missing → disabled CTA with "Coming soon" label.

## What's Next

The pricing page is live. Users can see the plans. But the "Get started" button 404s — we haven't built `/api/billing/checkout` yet.

Module 9 picks up exactly here. You'll create a POST endpoint at `/api/billing/checkout` that reads the `lookup_key` from the form body, resolves it to a live Stripe `price_id`, creates a Stripe Checkout Session via `stripe.checkout.sessions.create({...})`, and redirects the browser to Stripe's hosted checkout page. You'll also build the success and cancel return URLs, the webhook handler that listens for `checkout.session.completed`, and the logic that marks `profiles.billing_mode = 'active'` so the user gets upgraded access.

By the end of Module 9, a visitor can go from `/pricing` → Stripe-hosted checkout → paid subscription → authenticated dashboard access — with every edge case (failed payment, cancelled checkout, webhook retry) handled.
