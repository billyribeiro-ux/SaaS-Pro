<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDuration } from '$utils/format';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();

	function moduleDuration(lessons: readonly { duration: number }[]): number {
		return lessons.reduce((sum, l) => sum + l.duration, 0);
	}
</script>

<svelte:head>
	<title>Course overview — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-4xl px-6 py-10">
	<h1 class="text-3xl font-bold tracking-tight">Course overview</h1>
	<p class="mt-2 text-slate-600 dark:text-slate-400">
		{data.modules.length} modules. Start with the introduction, or jump to any free preview lesson.
	</p>

	<div class="mt-8 space-y-4">
		{#each data.modules as module (module.slug)}
			<a href={`/learn/${module.slug}`} class="block">
				<Card class="transition-colors hover:border-brand-300">
					<div class="flex items-start justify-between">
						<div>
							<h2 class="text-lg font-semibold">{module.title}</h2>
							<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
								{module.lessons.length} lessons · {formatDuration(moduleDuration(module.lessons))}
							</p>
						</div>
						{#if module.lessons.some((l) => l.preview)}
							<Badge variant="preview">{#snippet children()}Free previews{/snippet}</Badge>
						{/if}
					</div>
				</Card>
			</a>
		{/each}
	</div>
</section>
