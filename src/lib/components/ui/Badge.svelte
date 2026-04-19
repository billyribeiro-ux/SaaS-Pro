<script lang="ts" module>
	export type BadgeVariant =
		| 'default'
		| 'success'
		| 'warning'
		| 'danger'
		| 'info'
		| 'preview'
		| 'pro'
		| 'lifetime';
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

	/*
	 * Badges are tonal — low chroma background + strong text colour. The `preview`, `pro`,
	 * and `lifetime` variants read as tier chips; the rest are semantic status markers.
	 */
	const variants: Record<BadgeVariant, string> = {
		default:
			'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800/70 dark:text-slate-200 dark:ring-slate-700',
		success:
			'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/60',
		warning:
			'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60',
		danger:
			'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200/70 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/60',
		info: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/60',
		preview:
			'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/70 dark:bg-brand-950/50 dark:text-brand-200 dark:ring-brand-900/60',
		pro: 'bg-gradient-to-r from-brand-600 to-brand-500 text-white ring-1 ring-inset ring-white/10 shadow-xs',
		lifetime:
			'bg-gradient-to-r from-amber-500 to-orange-500 text-white ring-1 ring-inset ring-white/15 shadow-xs'
	};
</script>

<span
	class={cn(
		'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium tracking-tight',
		variants[variant],
		className
	)}
>
	{@render children()}
</span>
