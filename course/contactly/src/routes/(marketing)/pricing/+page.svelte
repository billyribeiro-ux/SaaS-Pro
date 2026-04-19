<script lang="ts" module>
	/** FAQ copy. Kept in the module script (compile-time constant) so a
	 * fresh array isn't allocated on every render. */
	const faqs = [
		{
			q: 'Is there really a free tier?',
			a: 'Yes. Starter is free forever, with no credit card required. You can store up to 25 contacts in your personal workspace and use every core feature.'
		},
		{
			q: 'Do paid plans include a free trial?',
			a: 'Both Pro and Business include a 14-day free trial. You can cancel during the trial without being charged. You can only start one trial per account.'
		},
		{
			q: 'How do you handle taxes?',
			a: "Stripe Tax computes the exact sales tax / VAT / GST for your billing address at checkout. The headline price is pre-tax — what you'll pay shows on the checkout page before you confirm."
		},
		{
			q: 'What happens to my data if I cancel?',
			a: "Your account and contacts stay readable for 30 days after cancellation in case you change your mind. After 30 days they're permanently deleted. You can export your contacts as CSV at any time, on any plan."
		}
	] as const;

	const intervalOptions = ['monthly', 'yearly'] as const satisfies readonly ['monthly', 'yearly'];
</script>

<script lang="ts">
	/**
	 * /pricing — public, four-card plan ladder.
	 *
	 * Presentation only. Every dollar amount, every formatted string,
	 * every "starter is implicit" rule lives in
	 * `$lib/billing/catalog.ts`. The template below is intentionally
	 * dumb — given a `PricingCard[]` it renders the grid, and that's
	 * the entire contract.
	 *
	 * STATE
	 * -----
	 * One client-side state: the interval toggle. Defaulting to
	 * `yearly` because the ADR-007 yearly discount is the message we
	 * want above the fold; visitors flip to `monthly` if they want
	 * the smaller commitment. The toggle is purely cosmetic — the
	 * Stripe price ID for Checkout (Module 9) is read from the
	 * already-selected `CatalogPrice` on click, not from a form
	 * field, so a JS-disabled visitor still sees a valid set of
	 * prices (the yearly column).
	 *
	 * NO HYDRATION-MISMATCH RISK
	 * --------------------------
	 * `formatCurrency` ran on the server in `+page.server.ts`'s
	 * `buildPricingCatalog`, so the cards arrive with `formatted`
	 * strings already locked. The client doesn't reformat anything;
	 * it just toggles which `CatalogPrice` is visible.
	 */
	import type { PageData } from './$types';
	import { resolve } from '$app/paths';
	import type { BillingInterval } from '$lib/billing/lookup-keys';
	import type { PricingCard, CatalogPrice } from '$lib/billing/catalog';
	import Button from '$lib/components/ui/Button.svelte';
	import { cn } from '$lib/utils/cn';

	let { data }: { data: PageData } = $props();

	// Yearly first — see the rationale in the file-level comment above.
	let interval: BillingInterval = $state('yearly');

	const cards: PricingCard[] = $derived(data.cards);

	function priceFor(card: PricingCard): CatalogPrice | null {
		return interval === 'monthly' ? card.prices.monthly : card.prices.yearly;
	}

	const ctaLabel = $derived(data.user ? 'Go to dashboard' : "Sign up — it's free");
	const ctaHref = $derived(data.user ? resolve('/dashboard') : resolve('/sign-up'));
</script>

<svelte:head>
	<title>Pricing — Contactly</title>
	<meta
		name="description"
		content="Contactly pricing — Starter is free, Pro is $19/mo or $190/yr, Business is $49/mo or $490/yr. 14-day free trial on every paid plan."
	/>
</svelte:head>

<main class="mx-auto max-w-6xl px-6 py-16">
	<header class="mx-auto max-w-2xl text-center">
		<p class="text-brand-600 text-sm font-semibold tracking-widest uppercase">Pricing</p>
		<h1 class="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
			Simple plans. Honest math.
		</h1>
		<p class="mt-5 text-lg leading-relaxed text-slate-600">
			Start free. Upgrade when you need more contacts or shared workspaces. Yearly billing saves you
			17%.
		</p>
	</header>

	{#if data.loadError}
		<div
			class="mx-auto mt-8 max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900"
			role="status"
			data-testid="pricing-load-error"
		>
			Live prices are temporarily unavailable. The plan ladder below is current; the dollar
			headlines will reappear shortly.
		</div>
	{/if}

	<div class="mt-10 flex justify-center">
		{@render intervalToggle()}
	</div>

	<section
		class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
		aria-label="Available plans"
		data-testid="pricing-grid"
	>
		{#each cards as card (card.tier)}
			{@render planCard(card)}
		{/each}
	</section>

	<section class="mx-auto mt-20 max-w-3xl">
		<h2 class="text-center text-2xl font-bold tracking-tight text-slate-900">
			Frequently asked questions
		</h2>
		<dl class="mt-8 space-y-6">
			{#each faqs as item (item.q)}
				<div class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
					<dt class="text-base font-semibold text-slate-900">{item.q}</dt>
					<dd class="mt-2 text-sm leading-relaxed text-slate-600">{item.a}</dd>
				</div>
			{/each}
		</dl>
	</section>
</main>

{#snippet intervalToggle()}
	<div
		class="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm"
		role="tablist"
		aria-label="Billing interval"
		data-testid="pricing-interval-toggle"
	>
		{#each intervalOptions as option (option)}
			<!--
				Native <button> with `role=tab` so the toggle is a real
				focusable control; aria-selected drives the active style
				without relying on a `data-` selector. The `onclick`
				handler mutates `interval` directly — Svelte 5's $state
				rune turns that into a reactive update and every $derived
				price recomputes on the same tick.
			-->
			<button
				type="button"
				role="tab"
				aria-selected={interval === option}
				data-testid={`pricing-interval-${option}`}
				class={cn(
					'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
					interval === option
						? 'bg-brand-600 text-white shadow'
						: 'text-slate-600 hover:text-slate-900'
				)}
				onclick={() => (interval = option)}
			>
				{option === 'monthly' ? 'Monthly' : 'Yearly'}
				{#if option === 'yearly'}
					<span
						class={cn(
							'ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
							interval === 'yearly' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'
						)}
					>
						Save 17%
					</span>
				{/if}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet planCard(card: PricingCard)}
	{@const price = priceFor(card)}
	<article
		class={cn(
			'flex flex-col rounded-xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md',
			card.recommended ? 'border-brand-300 ring-brand-200 ring-2' : 'border-slate-200'
		)}
		data-testid={`pricing-card-${card.tier}`}
		data-tier={card.tier}
	>
		<header>
			<div class="flex items-center justify-between">
				<h3 class="text-lg font-semibold text-slate-900">{card.name}</h3>
				{#if card.recommended}
					<span
						class="bg-brand-100 text-brand-700 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
						data-testid="pricing-recommended-badge"
					>
						Most popular
					</span>
				{/if}
			</div>
			<p class="mt-1 text-sm text-slate-600">{card.tagline}</p>
		</header>

		<div class="mt-6 min-h-[68px]">
			{#if card.tier === 'starter'}
				<p class="text-4xl font-bold tracking-tight text-slate-900">Free</p>
				<p class="mt-1 text-sm text-slate-500">Forever. No credit card required.</p>
			{:else if price}
				<p class="text-4xl font-bold tracking-tight text-slate-900" data-testid="pricing-headline">
					{price.formatted}
				</p>
				{#if price.monthlyEquivalentCents !== null}
					<p class="mt-1 text-sm text-slate-500">
						Billed annually — that's
						<span class="font-medium text-slate-700">
							${(price.monthlyEquivalentCents / 100).toFixed(2)}/mo
						</span>
					</p>
				{:else}
					<p class="mt-1 text-sm text-slate-500">Billed monthly. Cancel any time.</p>
				{/if}
			{:else}
				<p class="text-4xl font-bold tracking-tight text-slate-400">—</p>
				<p class="mt-1 text-sm text-slate-500">Coming soon.</p>
			{/if}
		</div>

		<ul class="mt-6 space-y-3 text-sm text-slate-700" data-testid="pricing-features">
			{#each card.features as feature (feature)}
				<li class="flex items-start gap-2">
					<svg
						class="mt-0.5 size-4 shrink-0 text-emerald-500"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
							clip-rule="evenodd"
						/>
					</svg>
					<span>{feature}</span>
				</li>
			{/each}
		</ul>

		<div class="mt-8">
			<Button
				href={ctaHref}
				variant={card.recommended ? 'primary' : 'secondary'}
				size="md"
				class="w-full"
				data-testid={`pricing-cta-${card.tier}`}
			>
				{ctaLabel}
			</Button>
		</div>
	</article>
{/snippet}
