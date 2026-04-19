<script lang="ts">
	import Badge from '$components/ui/Badge.svelte';
	import ArrowRight from '$components/icons/ArrowRight.svelte';
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
	<header class="mb-10">
		<p class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
			Course
		</p>
		<h1 class="font-display mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
			Curriculum
		</h1>
		<p class="mt-2 text-slate-600 dark:text-slate-400">
			{data.modules.length} modules. Start with the introduction, or jump to any free preview.
		</p>
	</header>

	<div class="space-y-3">
		{#each data.modules as module (module.slug)}
			{@const hasPreview = module.lessons.some((l) => l.preview)}
			<a
				href={`/learn/${module.slug}`}
				class="group flex items-center gap-5 rounded-xl border border-slate-200/80 bg-white p-5 transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950 dark:hover:border-brand-700"
			>
				<span class="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 font-mono text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
					{String(module.moduleNumber).padStart(2, '0')}
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h2 class="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-white">
							{module.title}
						</h2>
						{#if hasPreview}
							<Badge variant="preview">Free previews</Badge>
						{/if}
					</div>
					<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
						{module.lessons.length} lessons · {formatDuration(moduleDuration(module.lessons))}
					</p>
				</div>
				<ArrowRight
					size="md"
					class="shrink-0 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500"
				/>
			</a>
		{/each}
	</div>
</section>
