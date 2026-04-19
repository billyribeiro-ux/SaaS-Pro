<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDuration } from '$utils/format';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>{data.module.title} — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="text-3xl font-bold tracking-tight">{data.module.title}</h1>
	<p class="mt-2 text-slate-600 dark:text-slate-400">
		{data.module.lessons.length} lessons
	</p>

	<div class="mt-8 space-y-3">
		{#each data.module.lessons as lesson (lesson.slug)}
			<a href={`/learn/${data.module.slug}/${lesson.slug}`} class="block">
				<Card class="transition-colors hover:border-brand-300">
					<div class="flex items-center justify-between">
						<div>
							<h2 class="font-medium">{lesson.title}</h2>
							<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">{formatDuration(lesson.duration)}</p>
						</div>
						{#if lesson.preview}
							<Badge variant="preview">{#snippet children()}Free{/snippet}</Badge>
						{/if}
					</div>
				</Card>
			</a>
		{/each}
	</div>
</section>
