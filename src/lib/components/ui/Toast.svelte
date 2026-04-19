<script lang="ts" module>
	export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

	type ToastRecord = {
		id: number;
		message: string;
		variant: ToastVariant;
	};

	// Module-level runes state — a tiny global store shared across every Toast
	// consumer. `$state` gives deep reactivity so push/splice both trigger the UI.
	const toasts = $state<ToastRecord[]>([]);
	let nextId = 0;

	export function pushToast(
		message: string,
		variant: ToastVariant = 'info',
		durationMs = 4000
	): void {
		const id = ++nextId;
		toasts.push({ id, message, variant });
		setTimeout(() => {
			const index = toasts.findIndex((t) => t.id === id);
			if (index !== -1) toasts.splice(index, 1);
		}, durationMs);
	}
</script>

<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import Check from '$components/icons/Check.svelte';
	import X from '$components/icons/X.svelte';
	import { cn } from '$utils/cn';

	/*
	 * Each variant carries its own accent stripe + icon so the toast reads at a glance.
	 * The outer container is pointer-events-none so clicks pass through; individual
	 * toasts re-enable pointer events for their dismiss button.
	 */
	const variants: Record<
		ToastVariant,
		{ accent: string; icon: string; container: string }
	> = {
		success: {
			accent: 'bg-emerald-500',
			icon: 'text-emerald-600 dark:text-emerald-400',
			container: 'border-emerald-200/70 dark:border-emerald-900/60'
		},
		error: {
			accent: 'bg-red-500',
			icon: 'text-red-600 dark:text-red-400',
			container: 'border-red-200/70 dark:border-red-900/60'
		},
		info: {
			accent: 'bg-brand-500',
			icon: 'text-brand-600 dark:text-brand-400',
			container: 'border-slate-200 dark:border-slate-800'
		},
		warning: {
			accent: 'bg-amber-500',
			icon: 'text-amber-600 dark:text-amber-400',
			container: 'border-amber-200/70 dark:border-amber-900/60'
		}
	};

	function dismiss(id: number) {
		const index = toasts.findIndex((t) => t.id === id);
		if (index !== -1) toasts.splice(index, 1);
	}
</script>

<div
	class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
	aria-live="polite"
	aria-atomic="true"
>
	{#each toasts as toast (toast.id)}
		<div
			class={cn(
				'pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-lg border bg-white px-4 py-3 pr-10 text-sm text-slate-900 shadow-lg',
				'dark:bg-slate-950 dark:text-slate-100',
				variants[toast.variant].container
			)}
			role="status"
			in:fly={{ x: 24, duration: 240 }}
			out:fly={{ x: 24, duration: 180 }}
			animate:flip={{ duration: 200 }}
		>
			<span
				class={cn('absolute inset-y-0 left-0 w-1', variants[toast.variant].accent)}
				aria-hidden="true"
			></span>
			<span class={cn('mt-0.5', variants[toast.variant].icon)} aria-hidden="true">
				{#if toast.variant === 'success'}
					<Check size="md" />
				{:else if toast.variant === 'error'}
					<X size="md" />
				{:else}
					<Check size="md" />
				{/if}
			</span>
			<p class="flex-1 leading-snug">{toast.message}</p>
			<button
				type="button"
				onclick={() => dismiss(toast.id)}
				aria-label="Dismiss notification"
				class="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
			>
				<X size="xs" />
			</button>
		</div>
	{/each}
</div>
