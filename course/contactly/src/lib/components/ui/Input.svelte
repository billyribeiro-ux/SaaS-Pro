<script lang="ts" module>
	import type { HTMLInputAttributes } from 'svelte/elements';

	export type InputProps = Omit<HTMLInputAttributes, 'class' | 'value'> & {
		class?: string;
		invalid?: boolean;
		value?: HTMLInputAttributes['value'];
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils/cn';

	// `value` is `$bindable` so callers can `bind:value={$form.email}` —
	// the Superforms-recommended pattern. No default fallback: Superforms
	// initializes `$form.field` to the schema's default (or undefined)
	// and we want that exact value to flow through unchanged. Specifying
	// a fallback like `''` makes Svelte 5 throw `props_invalid_value`
	// when the bound value's runtime type disagrees with the fallback's
	// (e.g. `undefined` from an optional field colliding with a `string`
	// default).
	let { class: className, invalid = false, value = $bindable(), ...rest }: InputProps = $props();

	// `invalid` paints the error border AND sets `aria-invalid`. Callers
	// pass it explicitly (`<Input invalid={!!$errors.email} ... />`) so
	// the visual state and a11y state can never get out of sync.
	const classes = $derived(
		cn(
			'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900',
			'placeholder:text-slate-400',
			'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
			'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
			invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20 text-red-900',
			className
		)
	);
</script>

<input {...rest} bind:value aria-invalid={invalid || undefined} class={classes} />
