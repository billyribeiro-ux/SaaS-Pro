<script lang="ts" module>
	export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
	export type ButtonSize = 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
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

	const base =
		'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 disabled:pointer-events-none';

	const sizes: Record<ButtonSize, string> = {
		sm: 'h-8 px-3 text-sm',
		md: 'h-10 px-4 text-sm',
		lg: 'h-12 px-6 text-base'
	};

	const variants: Record<ButtonVariant, string> = {
		primary: 'bg-brand-600 text-white hover:bg-brand-700',
		secondary: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300',
		ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
		outline: 'border border-slate-300 bg-transparent text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900',
		danger: 'bg-red-600 text-white hover:bg-red-700'
	};

	let classes = $derived(cn(base, sizes[size], variants[variant], className));
</script>

{#if href}
	<a {href} class={classes} {...rest as HTMLAnchorAttributes}>
		{#if loading}
			<span class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
		{/if}
		{@render children()}
	</a>
{:else}
	<button class={classes} {...rest as HTMLButtonAttributes}>
		{#if loading}
			<span class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
		{/if}
		{@render children()}
	</button>
{/if}
