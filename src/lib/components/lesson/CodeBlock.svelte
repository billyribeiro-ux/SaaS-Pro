<script lang="ts">
	import Check from '$components/icons/Check.svelte';
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

<div
	class={cn(
		'group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm',
		'dark:border-slate-800',
		className
	)}
>
	<div class="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2">
		<div class="flex items-center gap-2">
			<div class="flex items-center gap-1.5" aria-hidden="true">
				<span class="size-2.5 rounded-full bg-red-500/70"></span>
				<span class="size-2.5 rounded-full bg-amber-500/70"></span>
				<span class="size-2.5 rounded-full bg-emerald-500/70"></span>
			</div>
			{#if language}
				<span class="font-mono text-xs text-slate-400">{language}</span>
			{/if}
		</div>
		<button
			type="button"
			onclick={copy}
			aria-label={copied ? 'Copied' : 'Copy code to clipboard'}
			class="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-xs font-medium text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-700"
		>
			{#if copied}
				<Check size="xs" class="text-emerald-400" />
				Copied
			{:else}
				Copy
			{/if}
		</button>
	</div>
	<pre class="overflow-x-auto p-4 text-sm leading-relaxed text-slate-100"><code>{code}</code></pre>
</div>
