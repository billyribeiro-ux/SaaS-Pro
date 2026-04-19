<script lang="ts" module>
	export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
	export type ButtonSize = 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Loader from '$components/icons/Loader.svelte';
	import { cn } from '$utils/cn';

	type BaseProps = {
		variant?: ButtonVariant;
		size?: ButtonSize;
		loading?: boolean;
		children: Snippet;
	};

	type Props = BaseProps &
		(
			| ({ href: string } & Omit<HTMLAnchorAttributes, 'children' | 'size'>)
			| ({ href?: undefined } & Omit<HTMLButtonAttributes, 'children' | 'size'>)
		);

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		href,
		children,
		class: className,
		...rest
	}: Props = $props();

	const base = [
		'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
		'rounded-md font-medium tracking-tight',
		'transition-[transform,background-color,color,box-shadow,border-color] duration-200 ease-[var(--ease-out-expo)]',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2',
		'focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950',
		'active:translate-y-px',
		'disabled:pointer-events-none disabled:opacity-50'
	].join(' ');

	const sizes: Record<ButtonSize, string> = {
		sm: 'h-8 px-3 text-xs',
		md: 'h-10 px-4 text-sm',
		lg: 'h-12 px-6 text-[0.95rem]'
	};

	/*
	 * Primary uses a subtle gradient + 1px inset highlight on top for depth — Linear/Vercel
	 * call this treatment "glass edge". Secondary is the inverse for contrast. Ghost is
	 * airy, Outline is bordered, Danger carries red. All survive dark mode.
	 */
	const variants: Record<ButtonVariant, string> = {
		primary: cn(
			'bg-brand-600 text-white shadow-sm',
			'hover:bg-brand-700 hover:shadow-md',
			'bg-gradient-to-b from-brand-500 to-brand-700',
			'dark:from-brand-500 dark:to-brand-700'
		),
		secondary: cn(
			'bg-slate-900 text-white shadow-sm hover:bg-slate-800',
			'dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100'
		),
		ghost: cn(
			'bg-transparent text-slate-700 hover:bg-slate-100',
			'dark:text-slate-200 dark:hover:bg-slate-800'
		),
		outline: cn(
			'border border-slate-300 bg-white text-slate-900 shadow-xs',
			'hover:border-slate-400 hover:bg-slate-50',
			'dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100',
			'dark:hover:border-slate-700 dark:hover:bg-slate-900'
		),
		danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700'
	};

	let classes = $derived(cn(base, sizes[size], variants[variant], className));
	// `rest` is the union of anchor/button attrs — neither necessarily has a
	// `disabled` key at the type level — so we read it through a shape-widened
	// cast rather than the fragile `'disabled' in rest ? rest.disabled` pattern.
	let isDisabled = $derived(loading || Boolean((rest as { disabled?: boolean }).disabled));
</script>

{#if href}
	<a {href} class={classes} aria-busy={loading || undefined} {...rest as HTMLAnchorAttributes}>
		{#if loading}
			<Loader size={size === 'lg' ? 16 : 14} aria-label="Loading" />
		{/if}
		{@render children()}
	</a>
{:else}
	<button
		class={classes}
		disabled={isDisabled}
		aria-busy={loading || undefined}
		{...rest as HTMLButtonAttributes}
	>
		{#if loading}
			<Loader size={size === 'lg' ? 16 : 14} aria-label="Loading" />
		{/if}
		{@render children()}
	</button>
{/if}
