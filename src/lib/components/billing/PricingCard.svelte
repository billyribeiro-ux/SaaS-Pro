<script lang="ts">
	import type { PricingTierConfig } from '$config/pricing.config';
	import type { PriceWithProduct } from '$types/billing.types';
	import { formatPrice } from '$utils/format';
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { cn } from '$utils/cn';

	type Props = {
		tier: PricingTierConfig;
		price: PriceWithProduct | null;
		isAuthenticated: boolean;
		currentTierKey: string | null;
	};

	let { tier, price, isAuthenticated, currentTierKey }: Props = $props();

	let priceLabel = $derived(
		price ? formatPrice(price.unit_amount, price.currency) : '—'
	);
	let isCurrent = $derived(currentTierKey === tier.key);
</script>

<Card class={cn('flex flex-col', tier.highlighted ? 'border-brand-500 shadow-lg ring-1 ring-brand-500' : '')}>
	{#snippet header()}
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-semibold">{tier.name}</h3>
			{#if tier.highlighted}
				<Badge variant="preview">{#snippet children()}Best value{/snippet}</Badge>
			{/if}
			{#if isCurrent}
				<Badge variant="success">{#snippet children()}Current plan{/snippet}</Badge>
			{/if}
		</div>
	{/snippet}

	<div class="flex flex-1 flex-col gap-4">
		<p class="text-sm text-slate-600 dark:text-slate-400">{tier.description}</p>
		<p class="text-4xl font-bold tracking-tight">
			{priceLabel}
			<span class="ml-1 text-sm font-normal text-slate-600 dark:text-slate-400">
				{tier.cadenceLabel}
			</span>
		</p>
		<ul class="flex flex-col gap-2 text-sm">
			{#each tier.features as feature (feature)}
				<li class="flex items-start gap-2">
					<span class="mt-0.5 text-emerald-600" aria-hidden="true">✓</span>
					<span>{feature}</span>
				</li>
			{/each}
		</ul>
	</div>

	{#snippet footer()}
		{#if isCurrent}
			<Button href="/account" variant="outline" size="md" class="w-full">
				{#snippet children()}Manage subscription{/snippet}
			</Button>
		{:else if !isAuthenticated}
			<Button href={`/register?lookup_key=${tier.lookupKey}`} variant={tier.highlighted ? 'primary' : 'outline'} size="md" class="w-full">
				{#snippet children()}Sign up & subscribe{/snippet}
			</Button>
		{:else if price}
			<form method="POST" action="/pricing?/checkout" class="w-full">
				<input type="hidden" name="lookupKey" value={tier.lookupKey} />
				<Button type="submit" variant={tier.highlighted ? 'primary' : 'outline'} size="md" class="w-full">
					{#snippet children()}Subscribe{/snippet}
				</Button>
			</form>
		{:else}
			<Button disabled variant="outline" size="md" class="w-full">
				{#snippet children()}Unavailable{/snippet}
			</Button>
		{/if}
	{/snippet}
</Card>
