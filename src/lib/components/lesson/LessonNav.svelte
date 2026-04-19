<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import type { LessonNavLinks } from '$types/lesson.types';

	type Props = {
		links: LessonNavLinks;
	};

	let { links }: Props = $props();
</script>

<nav class="flex items-center justify-between border-t border-slate-200 pt-6 dark:border-slate-800">
	{#if links.prev}
		{@const prev = links.prev}
		<Button href={`/learn/${prev.moduleSlug}/${prev.lessonSlug}`} variant="outline" size="md">
			{#snippet children()}
				<span aria-hidden="true">←</span>
				<span class="max-w-[14rem] truncate">{prev.title}</span>
			{/snippet}
		</Button>
	{:else}
		<span></span>
	{/if}

	{#if links.next}
		{@const next = links.next}
		<Button href={`/learn/${next.moduleSlug}/${next.lessonSlug}`} variant="primary" size="md">
			{#snippet children()}
				<span class="max-w-[14rem] truncate">{next.title}</span>
				<span aria-hidden="true">→</span>
			{/snippet}
		</Button>
	{:else}
		<span></span>
	{/if}
</nav>
