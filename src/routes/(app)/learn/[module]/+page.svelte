<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge from '$components/ui/Badge.svelte';
	import ArrowLeft from '$components/icons/ArrowLeft.svelte';
	import ArrowRight from '$components/icons/ArrowRight.svelte';
	import { formatDuration } from '$utils/format';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();

	let totalDuration = $derived(data.module.lessons.reduce((sum, l) => sum + l.duration, 0));
</script>

<svelte:head>
	<title>{data.module.title} — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-3xl px-6 py-10">
	<a
		href={resolve('/learn')}
		class="inline-flex items-center gap-1 text-sm text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
	>
		<ArrowLeft size="sm" />
		All modules
	</a>

	<header class="mt-6">
		<p
			class="font-mono text-xs font-medium tracking-widest text-slate-500 uppercase dark:text-slate-400"
		>
			Module {String(data.module.moduleNumber).padStart(2, '0')}
		</p>
		<h1
			class="font-display mt-2 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
		>
			{data.module.title}
		</h1>
		<p class="mt-3 text-slate-600 dark:text-slate-400">
			{data.module.lessons.length} lessons · {formatDuration(totalDuration)}
		</p>
	</header>

	<ol class="mt-10 space-y-2">
		{#each data.module.lessons as lesson, index (lesson.slug)}
			<li>
				<a
					href={resolve(`/learn/${data.module.slug}/${lesson.slug}`)}
					class="group flex items-center gap-4 rounded-lg border border-slate-200/80 bg-white px-4 py-3.5 transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:hover:border-brand-700"
				>
					<span class="font-mono text-xs text-slate-400 dark:text-slate-500">
						{String(index + 1).padStart(2, '0')}
					</span>
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-sm font-medium text-slate-900 dark:text-white">
							{lesson.title}
						</h2>
						<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
							{formatDuration(lesson.duration)}
						</p>
					</div>
					{#if lesson.preview}
						<Badge variant="preview">Free</Badge>
					{/if}
					<ArrowRight
						size="sm"
						class="shrink-0 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500"
					/>
				</a>
			</li>
		{/each}
	</ol>
</section>
