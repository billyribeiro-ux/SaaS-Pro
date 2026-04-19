<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ProgressBar from '$components/layout/ProgressBar.svelte';
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>Dashboard — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-6 py-10">
	<header class="mb-8">
		<h1 class="text-3xl font-bold tracking-tight">Welcome back{data.user?.user_metadata?.full_name ? `, ${data.user.user_metadata.full_name}` : ''}.</h1>
		<p class="mt-2 text-slate-600 dark:text-slate-400">Pick up where you left off, or start the course.</p>
	</header>

	{#if data.checkoutStatus === 'success'}
		<div class="mb-6 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
			Payment successful. Your access is being provisioned — refresh in a moment if the badge below doesn't update.
		</div>
	{/if}

	<div class="grid gap-6 md:grid-cols-2">
		<Card>
			{#snippet header()}
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">Subscription</h2>
					{#if data.tier}
						<Badge variant="success">{#snippet children()}{data.tier}{/snippet}</Badge>
					{:else}
						<Badge variant="warning">{#snippet children()}No plan{/snippet}</Badge>
					{/if}
				</div>
			{/snippet}
			<p class="text-sm text-slate-600 dark:text-slate-400">
				{#if data.tier}
					You're on the {data.tier} plan. Manage billing from your account page.
				{:else}
					Subscribe to unlock the full curriculum. Free preview lessons remain open.
				{/if}
			</p>
			<div class="mt-4 flex gap-2">
				{#if data.tier}
					<Button href="/account" variant="outline" size="sm">
						{#snippet children()}Manage billing{/snippet}
					</Button>
				{:else}
					<Button href="/pricing" variant="primary" size="sm">
						{#snippet children()}See pricing{/snippet}
					</Button>
				{/if}
				<Button href="/learn" variant="ghost" size="sm">
					{#snippet children()}Go to course{/snippet}
				</Button>
			</div>
		</Card>

		<Card>
			{#snippet header()}
				<h2 class="text-lg font-semibold">Progress</h2>
			{/snippet}
			<p class="mb-3 text-sm text-slate-600 dark:text-slate-400">
				{data.completedCount} of {data.totalLessons} lessons completed.
			</p>
			<ProgressBar value={data.completedCount} max={data.totalLessons} showLabel />
			<div class="mt-4">
				<Button href="/learn" variant="primary" size="sm">
					{#snippet children()}Continue course{/snippet}
				</Button>
			</div>
		</Card>
	</div>
</section>
