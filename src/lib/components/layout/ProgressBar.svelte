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
	<div class="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
		<div
			class="h-full rounded-full bg-brand-600 transition-all"
			style:width="{percent}%"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
		></div>
	</div>
	{#if showLabel}
		<div class="mt-1 text-xs text-slate-600 dark:text-slate-400">
			{Math.round(percent)}%
		</div>
	{/if}
</div>
