<script lang="ts">
	import ArrowLeft from '$components/icons/ArrowLeft.svelte';
	import ArrowRight from '$components/icons/ArrowRight.svelte';
	import type { LessonNavLinks } from '$types/lesson.types';

	type Props = {
		links: LessonNavLinks;
	};

	let { links }: Props = $props();
</script>

<nav class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	{#if links.prev}
		{@const prev = links.prev}
		<a
			href={`/learn/${prev.moduleSlug}/${prev.lessonSlug}`}
			class="group flex flex-col gap-1 rounded-lg border border-slate-200/80 bg-white px-4 py-3 transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
		>
			<span class="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
				<ArrowLeft size="xs" class="transition-transform group-hover:-translate-x-0.5" />
				Previous
			</span>
			<span class="truncate text-sm font-medium text-slate-900 dark:text-white">
				{prev.title}
			</span>
		</a>
	{:else}
		<span></span>
	{/if}

	{#if links.next}
		{@const next = links.next}
		<a
			href={`/learn/${next.moduleSlug}/${next.lessonSlug}`}
			class="group flex flex-col items-end gap-1 rounded-lg border border-brand-200 bg-gradient-to-br from-brand-50 to-white px-4 py-3 transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:shadow-md dark:border-brand-900/60 dark:from-brand-950/60 dark:to-slate-950"
		>
			<span class="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-brand-700 dark:text-brand-300">
				Next
				<ArrowRight size="xs" class="transition-transform group-hover:translate-x-0.5" />
			</span>
			<span class="truncate text-sm font-medium text-slate-900 dark:text-white">
				{next.title}
			</span>
		</a>
	{:else}
		<span></span>
	{/if}
</nav>
