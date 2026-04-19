<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cn } from '$utils/cn';
	import X from '$components/icons/X.svelte';

	type Props = {
		open: boolean;
		onClose: () => void;
		title?: string;
		class?: string;
		children: Snippet;
		footer?: Snippet;
	};

	let {
		open = $bindable(),
		onClose,
		title,
		class: className,
		children,
		footer
	}: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) onClose();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!--
		The backdrop is a presentational overlay — clicking it dismisses the dialog,
		but it is NOT the dialog itself. The inner panel carries role="dialog" and
		owns focus; that's what assistive tech announces. Keyboard dismissal is
		handled globally via svelte:window Escape.
	-->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="presentation"
		transition:fade={{ duration: 180 }}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'modal-title' : undefined}
			tabindex="-1"
			class={cn(
				'relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl',
				'dark:border-slate-800 dark:bg-slate-950',
				className
			)}
			transition:scale={{ duration: 220, start: 0.96, opacity: 0 }}
		>
			{#if title}
				<div class="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
					<h2 id="modal-title" class="text-base font-semibold tracking-tight">{title}</h2>
					<button
						type="button"
						onclick={onClose}
						aria-label="Close dialog"
						class="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
					>
						<X size="sm" />
					</button>
				</div>
			{/if}
			<div class="px-6 py-4">
				{@render children()}
			</div>
			{#if footer}
				<div class="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
