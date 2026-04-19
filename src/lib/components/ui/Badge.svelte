<script lang="ts" module>
	export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'preview';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$utils/cn';

	type Props = {
		variant?: BadgeVariant;
		class?: string;
		children: Snippet;
	};

	let { variant = 'default', class: className, children }: Props = $props();

	const variants: Record<BadgeVariant, string> = {
		default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
		success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
		warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
		danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
		info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
		preview: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
	};
</script>

<span class={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', variants[variant], className)}>
	{@render children()}
</span>
