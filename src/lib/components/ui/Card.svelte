<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$utils/cn';

	type Props = {
		class?: string;
		/**
		 * When true, the card lifts on hover with a shadow transition. Great for clickable cards.
		 */
		interactive?: boolean;
		header?: Snippet;
		footer?: Snippet;
		children: Snippet;
	};

	let { class: className, interactive = false, header, footer, children }: Props = $props();
</script>

<div
	class={cn(
		'rounded-xl border bg-white shadow-xs',
		'border-slate-200/80 dark:border-slate-800 dark:bg-slate-950',
		interactive &&
			'transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:hover:border-slate-700',
		className
	)}
>
	{#if header}
		<div class="border-b border-slate-200/80 px-6 py-4 dark:border-slate-800">
			{@render header()}
		</div>
	{/if}
	<div class="p-6">
		{@render children()}
	</div>
	{#if footer}
		<div class="border-t border-slate-200/80 px-6 py-4 dark:border-slate-800">
			{@render footer()}
		</div>
	{/if}
</div>
