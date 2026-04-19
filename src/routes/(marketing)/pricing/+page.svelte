<script lang="ts">
	import PricingCard from '$components/billing/PricingCard.svelte';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>Pricing — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-6xl px-6 py-16">
	<header class="text-center">
		<h1 class="text-4xl font-bold tracking-tight">Simple, straight-forward pricing.</h1>
		<p class="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
			Pay monthly, save on yearly, or own it forever.
		</p>
	</header>

	<div class="mt-12 grid gap-6 md:grid-cols-3">
		{#each data.tiers as tier (tier.key)}
			<PricingCard
				{tier}
				price={data.pricing[tier.key]}
				isAuthenticated={Boolean(data.user)}
				currentTierKey={data.currentTier}
			/>
		{/each}
	</div>
</section>
