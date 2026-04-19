<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$utils/cn';

	type Props = {
		class?: string;
		header?: Snippet;
		footer?: Snippet;
		children: Snippet;
	};

	let { class: className, header, footer, children }: Props = $props();
</script>

<div class={cn('rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900', className)}>
	{#if header}
		<div class="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
			{@render header()}
		</div>
	{/if}
	<div class="p-6">
		{@render children()}
	</div>
	{#if footer}
		<div class="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
			{@render footer()}
		</div>
	{/if}
</div>
