<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDate } from '$utils/format';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();
</script>

<svelte:head>
	<title>Account — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="text-3xl font-bold tracking-tight">Account</h1>

	<div class="mt-8 space-y-6">
		<Card>
			{#snippet header()}
				<h2 class="text-lg font-semibold">Profile</h2>
			{/snippet}
			<dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
				<div>
					<dt class="text-slate-500 dark:text-slate-400">Email</dt>
					<dd class="font-medium">{data.user?.email}</dd>
				</div>
				<div>
					<dt class="text-slate-500 dark:text-slate-400">Name</dt>
					<dd class="font-medium">{data.user?.user_metadata?.full_name ?? '—'}</dd>
				</div>
			</dl>
			{#snippet footer()}
				<form method="POST" action="?/signout">
					<Button type="submit" variant="ghost" size="sm">
						{#snippet children()}Sign out{/snippet}
					</Button>
				</form>
			{/snippet}
		</Card>

		<Card>
			{#snippet header()}
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">Subscription</h2>
					{#if data.tier}
						<Badge variant="success">{#snippet children()}{data.tier}{/snippet}</Badge>
					{:else}
						<Badge variant="warning">{#snippet children()}Inactive{/snippet}</Badge>
					{/if}
				</div>
			{/snippet}

			{#if data.subscription}
				<dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-slate-500 dark:text-slate-400">Status</dt>
						<dd class="font-medium">{data.subscription.status}</dd>
					</div>
					<div>
						<dt class="text-slate-500 dark:text-slate-400">Renews</dt>
						<dd class="font-medium">
							{data.subscription.cancel_at_period_end ? 'Cancels on ' : 'Renews on '}
							{formatDate(data.subscription.current_period_end)}
						</dd>
					</div>
				</dl>
			{:else}
				<p class="text-sm text-slate-600 dark:text-slate-400">
					You don't have an active subscription. Subscribe to unlock the full course.
				</p>
			{/if}

			{#if form?.error}
				<p class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
					{form.error}
				</p>
			{/if}

			{#snippet footer()}
				<div class="flex flex-wrap gap-2">
					{#if data.hasStripeCustomer}
						<form method="POST" action="?/portal">
							<Button type="submit" variant="primary" size="sm">
								{#snippet children()}Open billing portal{/snippet}
							</Button>
						</form>
					{:else}
						<Button href="/pricing" variant="primary" size="sm">
							{#snippet children()}See pricing{/snippet}
						</Button>
					{/if}
				</div>
			{/snippet}
		</Card>
	</div>
</section>
