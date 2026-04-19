<script lang="ts" module>
	import type { HTMLLabelAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type LabelProps = Omit<HTMLLabelAttributes, 'class' | 'children'> & {
		class?: string;
		required?: boolean;
		children: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils/cn';

	let { class: className, required = false, children, ...rest }: LabelProps = $props();
</script>

<label {...rest} class={cn('block text-sm font-medium text-slate-700', className)}>
	{@render children()}
	{#if required}
		<!--
			Visible asterisk for sighted users; aria-hidden because the
			screen reader gets the same information from the input's
			`required` attribute (HTML constraints API).
		-->
		<span aria-hidden="true" class="ml-0.5 text-red-500">*</span>
	{/if}
</label>
