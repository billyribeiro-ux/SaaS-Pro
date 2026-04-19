<script lang="ts" module>
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	export type TextareaProps = Omit<HTMLTextareaAttributes, 'class' | 'value'> & {
		class?: string;
		invalid?: boolean;
		value?: HTMLTextareaAttributes['value'];
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils/cn';

	// Mirrors the Input primitive — same $bindable pattern (no default
	// fallback) so optional Superforms fields that initialize to
	// `undefined` don't trip Svelte 5's props_invalid_value check.
	let { class: className, invalid = false, value = $bindable(), ...rest }: TextareaProps = $props();

	const classes = $derived(
		cn(
			'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900',
			'placeholder:text-slate-400',
			'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
			'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
			'min-h-[6rem] resize-y',
			invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20 text-red-900',
			className
		)
	);
</script>

<textarea {...rest} bind:value aria-invalid={invalid || undefined} class={classes}></textarea>
