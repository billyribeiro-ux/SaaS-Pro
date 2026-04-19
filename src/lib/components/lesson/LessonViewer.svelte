<script lang="ts">
	import type { LessonContent, LessonNavLinks } from '$types/lesson.types';
	import { formatDuration } from '$utils/format';
	import Badge from '$components/ui/Badge.svelte';
	import LessonNav from './LessonNav.svelte';
	import LessonComplete from './LessonComplete.svelte';

	type Props = {
		lesson: LessonContent;
		navLinks: LessonNavLinks;
		completed: boolean;
		renderedHtml: string;
	};

	let { lesson, navLinks, completed, renderedHtml }: Props = $props();
</script>

<article class="mx-auto w-full max-w-3xl px-6 py-10">
	<header class="mb-8">
		<div class="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
			<span>Module {lesson.meta.module}</span>
			<span aria-hidden="true">·</span>
			<span>{formatDuration(lesson.meta.duration)}</span>
			{#if lesson.meta.preview}
				<span aria-hidden="true">·</span>
				<Badge variant="preview">{#snippet children()}Free preview{/snippet}</Badge>
			{/if}
		</div>
		<h1 class="text-3xl font-bold tracking-tight">{lesson.meta.title}</h1>
		<p class="mt-2 text-slate-600 dark:text-slate-400">{lesson.meta.description}</p>
	</header>

	<!-- Rendered server-side from the markdown body. Content is authored by us, so {@html} is safe. -->
	<div class="prose prose-slate max-w-none dark:prose-invert">
		{@html renderedHtml}
	</div>

	<div class="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
		<LessonComplete {completed} moduleSlug={lesson.meta.moduleSlug} lessonSlug={lesson.meta.lessonSlug} />
	</div>

	<div class="mt-10">
		<LessonNav links={navLinks} />
	</div>
</article>
