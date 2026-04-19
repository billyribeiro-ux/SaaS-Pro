<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
	export type ButtonSize = 'sm' | 'md' | 'lg';

	type CommonProps = {
		variant?: ButtonVariant;
		size?: ButtonSize;
		loading?: boolean;
		class?: string;
		children: Snippet;
	};

	export type ButtonProps =
		| (CommonProps & { href?: undefined } & Omit<HTMLButtonAttributes, 'class' | 'children'>)
		| (CommonProps & { href: string } & Omit<HTMLAnchorAttributes, 'class' | 'children'>);
</script>

<script lang="ts">
	import { cn } from '$lib/utils/cn';

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		class: className,
		children,
		...rest
	}: ButtonProps = $props();

	const base =
		'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
		'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 ' +
		'focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]';

	const variants: Record<ButtonVariant, string> = {
		primary:
			'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow focus-visible:ring-brand-600',
		secondary:
			'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 ' +
			'focus-visible:ring-brand-600',
		ghost:
			'bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 ' +
			'focus-visible:ring-brand-600',
		danger:
			'bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow focus-visible:ring-red-600'
	};

	const sizes: Record<ButtonSize, string> = {
		sm: 'h-8 px-3 text-sm',
		md: 'h-10 px-4 text-sm',
		lg: 'h-12 px-6 text-base'
	};

	const classes = $derived(cn(base, variants[variant], sizes[size], className));
</script>

{#if 'href' in rest && rest.href !== undefined}
	<!--
		Render as an anchor when an href is passed. Lets <Button href="/sign-in">
		work as a styled link without each caller wrapping in <a>.
	-->
	<a {...rest} class={classes} aria-busy={loading || undefined}>
		{@render children()}
	</a>
{:else}
	<button
		{...rest}
		type={rest.type ?? 'button'}
		class={classes}
		disabled={loading || rest.disabled}
		aria-busy={loading || undefined}
	>
		{#if loading}
			<!--
				Inline spinner. Inline rather than imported so a Button
				with loading=true has no layout dependencies. role="status"
				+ aria-hidden on the SVG keeps screen readers focused on the
				button's accessible name (the children) rather than the icon.
			-->
			<svg
				class="size-4 animate-spin"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
			</svg>
		{/if}
		{@render children()}
	</button>
{/if}
