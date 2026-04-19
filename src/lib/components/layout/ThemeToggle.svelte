<script lang="ts">
	import Sun from '$components/icons/Sun.svelte';
	import Moon from '$components/icons/Moon.svelte';
	import Monitor from '$components/icons/Monitor.svelte';
	import { themeStore, type Theme } from '$lib/stores/theme.svelte';
	import { cn } from '$utils/cn';

	type Props = {
		class?: string;
		/**
		 * `compact` swaps the segmented control for a single button that cycles
		 * through Light → Dark → System. Use it where horizontal space is tight
		 * (e.g. inside a narrow mobile header). Defaults to false.
		 */
		compact?: boolean;
	};

	let { class: className, compact = false }: Props = $props();

	const options: ReadonlyArray<{ value: Theme; label: string; Icon: typeof Sun }> = [
		{ value: 'light', label: 'Light', Icon: Sun },
		{ value: 'system', label: 'System', Icon: Monitor },
		{ value: 'dark', label: 'Dark', Icon: Moon }
	];

	function cycle() {
		const order = ['light', 'dark', 'system'] as const;
		const i = order.indexOf(themeStore.theme);
		themeStore.setTheme(order[(i + 1) % order.length] as Theme);
	}

	let cycleLabel = $derived(`Theme: ${themeStore.theme}. Click to cycle.`);
	let CurrentIcon = $derived(
		themeStore.theme === 'system' ? Monitor : themeStore.theme === 'dark' ? Moon : Sun
	);
</script>

{#if compact}
	<button
		type="button"
		onclick={cycle}
		aria-label={cycleLabel}
		title={cycleLabel}
		class={cn(
			'inline-flex size-9 items-center justify-center rounded-md text-slate-700 transition-colors hover:bg-slate-100',
			'dark:text-slate-200 dark:hover:bg-slate-800',
			className
		)}
	>
		<CurrentIcon size="md" />
	</button>
{:else}
	<div
		role="radiogroup"
		aria-label="Color theme"
		class={cn(
			'inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-100/60 p-0.5',
			'dark:border-slate-800 dark:bg-slate-900/60',
			className
		)}
	>
		{#each options as opt (opt.value)}
			{@const active = themeStore.theme === opt.value}
			<button
				type="button"
				role="radio"
				aria-checked={active}
				aria-label={opt.label}
				title={opt.label}
				onclick={() => themeStore.setTheme(opt.value)}
				class={cn(
					'inline-flex size-7 items-center justify-center rounded-[5px] transition-colors',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
					active
						? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
						: 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
				)}
			>
				<opt.Icon size="sm" />
			</button>
		{/each}
	</div>
{/if}
