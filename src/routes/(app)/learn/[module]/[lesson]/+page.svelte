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
	<meta name="description" content={data.lesson?.meta.description ?? data.lessonMeta.title} />
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
	<svelte:boundary>
		<LessonViewer
			lesson={data.lesson}
			navLinks={data.navLinks}
			completed={data.completed}
			renderedHtml={data.renderedHtml}
		/>

		{#snippet failed(error, reset)}
			<div class="mx-auto max-w-2xl px-6 py-16 text-center">
				<h1 class="text-2xl font-semibold">Something went wrong rendering this lesson</h1>
				<p class="mt-2 text-slate-600 dark:text-slate-400">
					{error instanceof Error ? error.message : 'Unknown error'}
				</p>
				<button
					type="button"
					onclick={reset}
					class="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
				>
					Try again
				</button>
			</div>
		{/snippet}
	</svelte:boundary>
{/if}
