<script lang="ts">
	import Button from '$components/ui/Button.svelte';

	type Props = {
		lessonTitle?: string;
	};

	let { lessonTitle }: Props = $props();
</script>

<div class="mx-auto w-full max-w-xl rounded-lg border border-brand-200 bg-brand-50 p-8 text-center shadow-sm dark:border-brand-900 dark:bg-brand-950/40">
	<h2 class="text-2xl font-semibold">This lesson is for subscribers</h2>
	<p class="mt-2 text-slate-700 dark:text-slate-300">
		{#if lessonTitle}
			Unlock <strong>{lessonTitle}</strong> and the full SaaS-Pro curriculum.
		{:else}
			Unlock the full SaaS-Pro curriculum.
		{/if}
	</p>
	<p class="mt-4 text-sm text-slate-600 dark:text-slate-400">
		73 lessons. 14 modules. Everything you need to ship a real SaaS.
	</p>
	<div class="mt-6 flex justify-center gap-3">
		<Button href="/pricing" variant="primary" size="lg">
			{#snippet children()}See pricing{/snippet}
		</Button>
		<Button href="/learn" variant="outline" size="lg">
			{#snippet children()}Back to course{/snippet}
		</Button>
	</div>
</div>
