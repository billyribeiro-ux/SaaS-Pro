<script lang="ts">
	import { slide } from 'svelte/transition';
	import PricingCard from '$components/billing/PricingCard.svelte';
	import Check from '$components/icons/Check.svelte';
	import ChevronDown from '$components/icons/ChevronDown.svelte';
	import { SITE } from '$config/site.config';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();

	const title = `Pricing — ${SITE.name}`;
	const description = 'Pay monthly, save on yearly, or own it forever.';
	const canonical = `${SITE.url}/pricing`;
	const ogImage = `${SITE.url}${SITE.defaultOgImage}`;

	/*
	 * Our tiers are Monthly / Yearly / Lifetime, so a binary monthly↔yearly toggle
	 * doesn't fit exactly — but the audience *expects* one. We treat the toggle as a
	 * recommended-cadence hint: flipping it emphasises that tier with full opacity,
	 * and the other dims slightly. The underlying prices never change.
	 */
	type Cadence = 'monthly' | 'yearly';
	let cadence = $state<Cadence>('yearly');

	const trustBadges = [
		'14-day free trial',
		'Cancel anytime',
		'Secure Stripe checkout',
		'Full source access'
	];

	const faq: { q: string; a: string }[] = [
		{
			q: 'Can I switch plans later?',
			a: 'Yes. Upgrade, downgrade, or cancel any time from the billing portal. Proration is handled automatically by Stripe.'
		},
		{
			q: 'Is there really no credit card required for the trial?',
			a: 'Correct. Module 9 teaches exactly how to implement that pattern — no card, no friction, with trial-abuse prevention built in.'
		},
		{
			q: 'Does lifetime mean lifetime?',
			a: "Yes — a one-time payment grants access to every current and future lesson, plus all bonus material. Plain and simple."
		},
		{
			q: 'Can I get an invoice / company purchase?',
			a: 'Yes. After checkout, the Stripe billing portal lets you update tax info and download invoices. Reach out if you need a custom quote.'
		}
	];
	let openFaq = $state<number | null>(0);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE.name} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={ogImage} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content={SITE.twitter} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<section class="relative overflow-hidden">
	<div class="pointer-events-none absolute inset-0 bg-grid mask-radial-fade" aria-hidden="true"></div>
	<div class="pointer-events-none absolute inset-0 bg-mesh opacity-50" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-6xl px-6 pb-16 pt-20">
		<header class="text-center">
			<p class="text-sm font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
				Pricing
			</p>
			<h1 class="font-display mt-3 text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl dark:text-white">
				Simple, straight-forward pricing.
			</h1>
			<p class="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
				Pay monthly, save on yearly, or own it forever.
			</p>

			<!-- Cadence toggle — an animated pill highlights the active side. -->
			<div class="mt-10 inline-flex">
				<div
					class="relative inline-flex items-center rounded-full border border-slate-200/80 bg-white/70 p-1 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-950/70"
					role="tablist"
				>
					{#each ['monthly', 'yearly'] as const as option (option)}
						{@const isActive = cadence === option}
						<button
							type="button"
							role="tab"
							aria-selected={isActive}
							onclick={() => (cadence = option)}
							class="relative z-10 rounded-full px-5 py-1.5 text-sm font-medium capitalize transition-colors duration-200 {isActive
								? 'text-white'
								: 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}"
						>
							{option}
							{#if option === 'yearly'}
								<span
									class="ml-1.5 inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[0.65rem] font-semibold text-emerald-700 dark:text-emerald-300"
								>
									Save 14%
								</span>
							{/if}
						</button>
					{/each}
					<span
						class="absolute inset-y-1 rounded-full bg-slate-900 transition-all duration-300 ease-[var(--ease-out-expo)] dark:bg-white/10 dark:ring-1 dark:ring-white/20"
						style:left={cadence === 'monthly' ? '0.25rem' : '50%'}
						style:width="calc(50% - 0.25rem)"
						aria-hidden="true"
					></span>
				</div>
			</div>
		</header>

		<div class="mt-14 grid gap-6 md:grid-cols-3">
			{#each data.tiers as tier (tier.key)}
				<div
					class="transition-opacity duration-300"
					style:opacity={cadence === 'yearly' && tier.key === 'monthly'
						? '0.65'
						: cadence === 'monthly' && tier.key === 'yearly'
							? '0.65'
							: '1'}
				>
					<PricingCard
						{tier}
						price={data.pricing[tier.key]}
						isAuthenticated={Boolean(data.user)}
						currentTierKey={data.currentTier}
					/>
				</div>
			{/each}
		</div>

		<ul class="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-600 dark:text-slate-400">
			{#each trustBadges as badge (badge)}
				<li class="inline-flex items-center gap-1.5">
					<Check size="sm" class="text-emerald-500" />
					<span>{badge}</span>
				</li>
			{/each}
		</ul>
	</div>
</section>

<!-- FAQ below pricing keeps the conversion surface single-viewport on laptops. -->
<section id="faq" class="mx-auto max-w-3xl px-6 py-20">
	<div class="text-center">
		<h2 class="font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
			Pricing FAQ
		</h2>
	</div>
	<div class="mt-10 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
		{#each faq as item, index (item.q)}
			{@const isOpen = openFaq === index}
			<div class={index > 0 ? 'border-t border-slate-200/80 dark:border-slate-800' : ''}>
				<button
					type="button"
					onclick={() => (openFaq = isOpen ? null : index)}
					class="flex w-full items-center justify-between gap-4 bg-white px-6 py-4 text-left transition-colors hover:bg-slate-50/80 dark:bg-slate-950 dark:hover:bg-slate-900/50"
					aria-expanded={isOpen}
				>
					<span class="text-sm font-medium text-slate-900 dark:text-white">{item.q}</span>
					<ChevronDown
						size="sm"
						class="text-slate-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
					/>
				</button>
				{#if isOpen}
					<div
						class="bg-slate-50/60 px-6 py-4 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300"
						transition:slide={{ duration: 180 }}
					>
						{item.a}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>
