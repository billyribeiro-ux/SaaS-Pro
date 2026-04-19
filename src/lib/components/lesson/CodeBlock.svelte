<script lang="ts">
	import { cn } from '$utils/cn';

	type Props = {
		code: string;
		language?: string;
		class?: string;
	};

	let { code, language, class: className }: Props = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// Clipboard API unavailable (e.g. iframe without permission) — fail silently.
		}
	}
</script>

<div class={cn('relative overflow-hidden rounded-md border border-slate-200 bg-slate-950 dark:border-slate-800', className)}>
	{#if language}
		<div class="border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400">
			{language}
		</div>
	{/if}
	<button
		type="button"
		onclick={copy}
		class="absolute right-2 top-2 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 opacity-0 transition-opacity hover:bg-slate-700 focus-visible:opacity-100 group-hover:opacity-100"
		style:opacity={copied ? '1' : undefined}
	>
		{copied ? 'Copied' : 'Copy'}
	</button>
	<pre class="overflow-x-auto p-4 text-sm text-slate-100"><code>{code}</code></pre>
</div>
