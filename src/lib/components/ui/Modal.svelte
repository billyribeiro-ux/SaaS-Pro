<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$utils/cn';

	type Props = {
		open: boolean;
		onClose: () => void;
		title?: string;
		class?: string;
		children: Snippet;
		footer?: Snippet;
	};

	let { open = $bindable(), onClose, title, class: className, children, footer }: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) onClose();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? 'modal-title' : undefined}
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') handleBackdropClick(event as unknown as MouseEvent);
		}}
	>
		<div class={cn('w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900', className)}>
			{#if title}
				<div class="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
					<h2 id="modal-title" class="text-lg font-semibold">{title}</h2>
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
