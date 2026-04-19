<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ProgressBar from '$components/layout/ProgressBar.svelte';
	import ArrowRight from '$components/icons/ArrowRight.svelte';
	import Check from '$components/icons/Check.svelte';
	import Sparkles from '$components/icons/Sparkles.svelte';
	import Zap from '$components/icons/Zap.svelte';
	import { formatDate } from '$utils/format';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();

	let percent = $derived(
		data.totalLessons > 0
			? Math.round((data.completedCount / data.totalLessons) * 100)
			: 0
	);

	/*
	 * Draw a progress ring using two SVG circles — background track + foreground arc.
	 * stroke-dasharray = full circumference; stroke-dashoffset = remainder.
	 */
	const ringRadius = 36;
	const ringCircumference = 2 * Math.PI * ringRadius;
	let ringOffset = $derived(ringCircumference * (1 - percent / 100));

	// Approximate time invested — 1 minute of lesson = 1 minute of time. Imperfect but
	// a reasonable proxy that avoids needing a separate time-tracking system.
	let minutesInvested = $derived(data.completedCount * 8); // average lesson length
	let hoursInvested = $derived(Math.round((minutesInvested / 60) * 10) / 10);

	let firstName = $derived(
		(data.user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ?? null
	);
</script>

<svelte:head>
	<title>Dashboard — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-6 py-10">
	<header class="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
				Dashboard
			</p>
			<h1 class="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
				{#if firstName}
					Welcome back, {firstName}.
				{:else}
					Welcome back.
				{/if}
			</h1>
			<p class="mt-2 text-slate-600 dark:text-slate-400">
				{#if data.nextLesson}
					Pick up where you left off.
				{:else if data.completedCount === data.totalLessons && data.totalLessons > 0}
					You've completed the whole curriculum. Legend.
				{:else}
					Ready when you are — let's build.
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if data.tier}
				<Badge variant={data.tier === 'lifetime' ? 'lifetime' : 'pro'}>
					<Sparkles size="xs" />
					{data.tier}
				</Badge>
			{:else}
				<Badge variant="warning">No plan</Badge>
			{/if}
		</div>
	</header>

	{#if data.checkoutStatus === 'success'}
		<div class="mb-6 flex items-start gap-3 rounded-lg border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
			<Check size="md" class="mt-0.5 text-emerald-600 dark:text-emerald-400" />
			<div>
				<p class="font-medium">Payment successful.</p>
				<p class="mt-0.5">Your access is being provisioned — refresh in a moment if the badge above doesn't update.</p>
			</div>
		</div>
	{/if}

	<!-- Top row: Resume card (spans 2) + Progress ring -->
	<div class="grid gap-4 md:grid-cols-3">
		<Card class="md:col-span-2">
			{#snippet header()}
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
						{data.nextLesson ? 'Resume learning' : 'Start learning'}
					</h2>
					<Zap size="sm" class="text-brand-500" />
				</div>
			{/snippet}
			{#if data.nextLesson}
				<p class="text-xs text-slate-500 dark:text-slate-400">{data.nextLesson.moduleTitle}</p>
				<h3 class="mt-1 font-display text-xl font-semibold tracking-tight">
					{data.nextLesson.lessonTitle}
				</h3>
				<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
					{data.completedCount} / {data.totalLessons} complete · {percent}% of the way through.
				</p>
				<div class="mt-5">
					<Button
						href={`/learn/${data.nextLesson.moduleSlug}/${data.nextLesson.lessonSlug}`}
						variant="primary"
						size="md"
					>
						Continue lesson
						<ArrowRight size="sm" />
					</Button>
				</div>
			{:else}
				<p class="text-sm text-slate-600 dark:text-slate-400">
					{#if data.completedCount === data.totalLessons && data.totalLessons > 0}
						Curriculum complete. Review, or jump into the bonus modules.
					{:else}
						Jump into the first lesson and start shipping.
					{/if}
				</p>
				<div class="mt-5">
					<Button href="/learn" variant="primary" size="md">
						Browse course
						<ArrowRight size="sm" />
					</Button>
				</div>
			{/if}
		</Card>

		<Card>
			{#snippet header()}
				<h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
					Overall progress
				</h2>
			{/snippet}
			<div class="flex items-center gap-5">
				<svg
					width="84"
					height="84"
					viewBox="0 0 84 84"
					class="-rotate-90"
					aria-hidden="true"
				>
					<circle
						cx="42"
						cy="42"
						r={ringRadius}
						stroke-width="6"
						fill="none"
						class="stroke-slate-200 dark:stroke-slate-800"
					/>
					<circle
						cx="42"
						cy="42"
						r={ringRadius}
						stroke-width="6"
						fill="none"
						stroke-linecap="round"
						stroke-dasharray={ringCircumference}
						stroke-dashoffset={ringOffset}
						class="stroke-brand-500 transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out-expo)]"
					/>
				</svg>
				<div>
					<p class="font-display text-3xl font-semibold tracking-tight">{percent}%</p>
					<p class="text-xs text-slate-500 dark:text-slate-400">
						{data.completedCount} of {data.totalLessons}
					</p>
				</div>
			</div>
		</Card>
	</div>

	<!-- Stats row -->
	<div class="mt-4 grid gap-4 sm:grid-cols-3">
		<Card>
			<div class="flex items-baseline justify-between">
				<span class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
					Lessons done
				</span>
				<Check size="sm" class="text-emerald-500" />
			</div>
			<p class="font-display mt-2 text-2xl font-semibold tracking-tight">{data.completedCount}</p>
			<ProgressBar value={data.completedCount} max={data.totalLessons} class="mt-3" />
		</Card>
		<Card>
			<div class="flex items-baseline justify-between">
				<span class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
					Time invested
				</span>
			</div>
			<p class="font-display mt-2 text-2xl font-semibold tracking-tight">
				{hoursInvested}h
			</p>
			<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Estimated, based on completions.</p>
		</Card>
		<Card>
			<div class="flex items-baseline justify-between">
				<span class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
					Current streak
				</span>
			</div>
			<p class="font-display mt-2 text-2xl font-semibold tracking-tight">
				{data.recent.length > 0 ? '1 day' : '—'}
			</p>
			<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
				{data.recent.length > 0 ? 'Keep it going.' : 'Complete a lesson to start.'}
			</p>
		</Card>
	</div>

	<!-- Recent activity + Subscription summary -->
	<div class="mt-4 grid gap-4 md:grid-cols-3">
		<Card class="md:col-span-2">
			{#snippet header()}
				<h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
					Recent activity
				</h2>
			{/snippet}
			{#if data.recent.length === 0}
				<p class="text-sm text-slate-600 dark:text-slate-400">
					Nothing yet — completed lessons will show up here.
				</p>
			{:else}
				<ul class="divide-y divide-slate-200/80 dark:divide-slate-800">
					{#each data.recent as item (`${item.moduleSlug}/${item.lessonSlug}`)}
						<li class="flex items-center justify-between gap-3 py-3 text-sm">
							<a
								href={`/learn/${item.moduleSlug}/${item.lessonSlug}`}
								class="group flex min-w-0 items-center gap-3"
							>
								<span
									class="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
									aria-hidden="true"
								>
									<Check size={12} />
								</span>
								<span class="min-w-0">
									<span class="block truncate font-medium text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">
										{item.lessonTitle}
									</span>
									<span class="block truncate text-xs text-slate-500 dark:text-slate-400">
										{item.moduleTitle}
									</span>
								</span>
							</a>
							<span class="shrink-0 font-mono text-xs text-slate-400 dark:text-slate-500">
								{item.updatedAt ? formatDate(item.updatedAt) : ''}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card>
			{#snippet header()}
				<h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
					Subscription
				</h2>
			{/snippet}
			<p class="text-sm text-slate-600 dark:text-slate-400">
				{#if data.tier}
					You're on the <strong class="text-slate-900 dark:text-white">{data.tier}</strong> plan. Manage billing from the account page.
				{:else}
					Subscribe to unlock the full curriculum. Free preview lessons remain open.
				{/if}
			</p>
			<div class="mt-4 flex flex-wrap gap-2">
				{#if data.tier}
					<Button href="/account" variant="outline" size="sm">Manage billing</Button>
				{:else}
					<Button href="/pricing" variant="primary" size="sm">See pricing</Button>
				{/if}
			</div>
		</Card>
	</div>
</section>
