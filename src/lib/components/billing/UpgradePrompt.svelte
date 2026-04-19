<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import Lock from '$components/icons/Lock.svelte';
	import ArrowRight from '$components/icons/ArrowRight.svelte';

	type Props = {
		lessonTitle?: string;
	};

	let { lessonTitle }: Props = $props();
</script>

<div class="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-brand-200/60 bg-gradient-to-b from-brand-50 to-white p-10 text-center shadow-sm dark:border-brand-900/60 dark:from-brand-950/40 dark:to-slate-950">
	<span
		class="mx-auto grid size-12 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md ring-1 ring-inset ring-white/10"
		aria-hidden="true"
	>
		<Lock size="lg" />
	</span>
	<h2 class="font-display mt-5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
		This lesson is for subscribers
	</h2>
	<p class="mx-auto mt-2 max-w-md text-slate-600 dark:text-slate-400">
		{#if lessonTitle}
			Unlock <strong class="text-slate-900 dark:text-white">{lessonTitle}</strong> and the full SaaS-Pro curriculum.
		{:else}
			Unlock the full SaaS-Pro curriculum.
		{/if}
	</p>
	<p class="mt-3 text-sm text-slate-500 dark:text-slate-500">
		73+ lessons. 14 modules. Everything you need to ship a real SaaS.
	</p>
	<div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
		<Button href="/pricing" variant="primary" size="lg">
			See pricing
			<ArrowRight size="sm" />
		</Button>
		<Button href="/learn" variant="outline" size="lg">Back to course</Button>
	</div>
</div>
