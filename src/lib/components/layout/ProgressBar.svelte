<script lang="ts">
	import { cn } from '$utils/cn';

	type Props = {
		value: number;
		max?: number;
		class?: string;
		showLabel?: boolean;
	};

	let { value, max = 100, class: className, showLabel = false }: Props = $props();

	let percent = $derived(max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);
</script>

<div class={cn('w-full', className)}>
	<div class="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
		<div
			class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 shadow-[0_0_8px_-2px_oklch(0.62_0.2_268_/_0.6)] transition-[width] duration-500 ease-[var(--ease-out-expo)]"
			style:width="{percent}%"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
		></div>
	</div>
	{#if showLabel}
		<div class="mt-1.5 flex items-center justify-between text-xs">
			<span class="text-slate-600 dark:text-slate-400">
				{value} of {max} complete
			</span>
			<span class="font-mono font-medium text-slate-900 dark:text-slate-100">
				{Math.round(percent)}%
			</span>
		</div>
	{/if}
</div>
