<script lang="ts">
	import LessonViewer from '$components/lesson/LessonViewer.svelte';
	import UpgradePrompt from '$components/billing/UpgradePrompt.svelte';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>{data.lessonMeta.title} — SaaS-Pro</title>
</svelte:head>

{#if data.gated}
	<div class="px-6 py-16">
		<UpgradePrompt lessonTitle={data.lessonMeta.title} />
	</div>
{:else if !data.lesson}
	<div class="mx-auto max-w-2xl px-6 py-16 text-center">
		<h1 class="text-2xl font-semibold">Coming soon</h1>
		<p class="mt-2 text-slate-600 dark:text-slate-400">
			This lesson is on the roadmap but hasn't been published yet. Check back soon.
		</p>
	</div>
{:else}
	<LessonViewer
		lesson={data.lesson}
		navLinks={data.navLinks}
		completed={data.completed}
		renderedHtml={data.renderedHtml}
	/>
{/if}
