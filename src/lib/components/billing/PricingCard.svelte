<script lang="ts">
	import type { PricingTierConfig } from '$config/pricing.config';
	import type { PriceWithProduct } from '$types/billing.types';
	import { formatPrice } from '$utils/format';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Check from '$components/icons/Check.svelte';
	import Sparkles from '$components/icons/Sparkles.svelte';
	import { cn } from '$utils/cn';

	type Props = {
		tier: PricingTierConfig;
		price: PriceWithProduct | null;
		isAuthenticated: boolean;
		currentTierKey: string | null;
	};

	let { tier, price, isAuthenticated, currentTierKey }: Props = $props();

	let priceLabel = $derived(price ? formatPrice(price.unit_amount, price.currency) : '—');
	let isCurrent = $derived(currentTierKey === tier.key);
</script>

<div
	class={cn(
		'group relative flex flex-col rounded-2xl p-8 transition-all duration-300 ease-[var(--ease-out-expo)]',
		tier.highlighted
			? 'border border-brand-500/50 bg-white shadow-lg ring-1 ring-brand-500/20 dark:bg-slate-950'
			: 'border border-slate-200/80 bg-white hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950'
	)}
>
	{#if tier.highlighted}
		<!-- Soft brand glow behind the featured card. Absolutely positioned, pointer-none. -->
		<div
			class="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent"
			aria-hidden="true"
		></div>
		<div
			class="pointer-events-none absolute -inset-px -z-10 rounded-2xl bg-gradient-to-b from-brand-500/10 via-transparent to-transparent"
			aria-hidden="true"
		></div>
	{/if}

	<div class="flex items-center justify-between gap-2">
		<h3 class="text-sm font-semibold tracking-widest text-slate-500 uppercase dark:text-slate-400">
			{tier.name}
		</h3>
		{#if tier.highlighted}
			<Badge variant="pro">
				<Sparkles size="xs" class="text-white" />
				Best value
			</Badge>
		{/if}
		{#if isCurrent}
			<Badge variant="success">Current plan</Badge>
		{/if}
	</div>

	<div class="mt-4">
		<div class="flex items-baseline gap-2">
			<span
				class="font-display text-5xl font-semibold tracking-tight text-slate-900 dark:text-white"
			>
				{priceLabel}
			</span>
			<span class="text-sm text-slate-500 dark:text-slate-400">
				{tier.cadenceLabel}
			</span>
		</div>
		<p class="mt-3 text-sm text-slate-600 dark:text-slate-400">{tier.description}</p>
	</div>

	<ul
		class="mt-6 flex flex-1 flex-col gap-3 border-t border-slate-200/80 pt-6 text-sm dark:border-slate-800"
	>
		{#each tier.features as feature (feature)}
			<li class="flex items-start gap-2.5">
				<span
					class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				>
					<Check size={10} />
				</span>
				<span class="text-slate-700 dark:text-slate-300">{feature}</span>
			</li>
		{/each}
	</ul>

	<div class="mt-8">
		{#if isCurrent}
			<Button href="/account" variant="outline" size="md" class="w-full">
				Manage subscription
			</Button>
		{:else if !isAuthenticated}
			<Button
				href={`/register?lookup_key=${tier.lookupKey}`}
				variant={tier.highlighted ? 'primary' : 'outline'}
				size="md"
				class="w-full"
			>
				Get started
			</Button>
		{:else if price}
			<form method="POST" action="/pricing?/checkout" class="w-full">
				<input type="hidden" name="lookupKey" value={tier.lookupKey} />
				<Button
					type="submit"
					variant={tier.highlighted ? 'primary' : 'outline'}
					size="md"
					class="w-full"
				>
					Subscribe
				</Button>
			</form>
		{:else}
			<Button disabled variant="outline" size="md" class="w-full">Unavailable</Button>
		{/if}
	</div>
</div>
