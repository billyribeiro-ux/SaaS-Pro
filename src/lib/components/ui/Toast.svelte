<script lang="ts" module>
	export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

	type ToastRecord = {
		id: number;
		message: string;
		variant: ToastVariant;
	};

	let toasts = $state<ToastRecord[]>([]);
	let nextId = 0;

	export function pushToast(message: string, variant: ToastVariant = 'info', durationMs = 4000): void {
		const id = ++nextId;
		toasts.push({ id, message, variant });
		setTimeout(() => {
			toasts = toasts.filter((t) => t.id !== id);
		}, durationMs);
	}
</script>

<script lang="ts">
	import { cn } from '$utils/cn';

	const variants: Record<ToastVariant, string> = {
		success: 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100',
		error: 'border-red-500 bg-red-50 text-red-900 dark:bg-red-950/60 dark:text-red-100',
		info: 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
		warning: 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100'
	};
</script>

<div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-full flex-col gap-2" aria-live="polite" aria-atomic="true">
	{#each toasts as toast (toast.id)}
		<div class={cn('pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg', variants[toast.variant])} role="status">
			{toast.message}
		</div>
	{/each}
</div>
