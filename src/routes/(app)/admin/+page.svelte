<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDate } from '$utils/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const cards = $derived([
		{
			label: 'Total users',
			value: data.stats.totalUsers,
			hint: `${data.stats.totalAdmins} admins`
		},
		{
			label: 'Active subs',
			value: data.stats.activeSubs,
			hint: `${data.stats.trialingSubs} trialing`
		},
		{ label: 'Canceled subs', value: data.stats.canceledSubs, hint: 'lifetime total' },
		{
			label: 'Comp entitlements',
			value: data.stats.activeEntitlements,
			hint: 'unrevoked, unexpired'
		},
		{ label: 'Webhook events', value: data.stats.webhookEvents, hint: 'idempotency ledger' }
	]);
</script>

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
	{#each cards as card (card.label)}
		<Card>
			<div class="text-xs font-medium tracking-wider text-slate-500 uppercase dark:text-slate-400">
				{card.label}
			</div>
			<div class="font-display mt-1 text-2xl font-semibold">{card.value.toLocaleString()}</div>
			<div class="mt-1 text-xs text-slate-500 dark:text-slate-400">{card.hint}</div>
		</Card>
	{/each}
</div>

<div class="mt-8 grid gap-6 lg:grid-cols-2">
	<Card>
		<h2 class="mb-3 text-sm font-semibold tracking-wider text-slate-500 uppercase">Recent users</h2>
		{#if data.recentUsers.length === 0}
			<p class="text-sm text-slate-500">No users yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 dark:divide-slate-800">
				{#each data.recentUsers as user (user.id)}
					<li class="flex items-center justify-between py-2">
						<div class="min-w-0">
							<div class="truncate text-sm font-medium">
								{user.full_name ?? user.email}
							</div>
							<div class="truncate text-xs text-slate-500">{user.email}</div>
						</div>
						<div class="flex items-center gap-2">
							{#if user.role === 'admin'}
								<Badge variant="lifetime">admin</Badge>
							{/if}
							<span class="text-xs text-slate-500">{formatDate(user.created_at)}</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card>
		<h2 class="mb-3 text-sm font-semibold tracking-wider text-slate-500 uppercase">
			Recent subscriptions
		</h2>
		{#if data.recentSubs.length === 0}
			<p class="text-sm text-slate-500">No subscriptions yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 dark:divide-slate-800">
				{#each data.recentSubs as sub (sub.id)}
					<li class="flex items-center justify-between py-2 text-sm">
						<div class="min-w-0">
							<div class="truncate font-mono text-xs">{sub.id}</div>
							<div class="text-xs text-slate-500">{sub.price_id ?? '—'}</div>
						</div>
						<div class="flex items-center gap-2">
							<Badge variant={sub.status === 'active' ? 'pro' : 'warning'}>{sub.status}</Badge>
							<span class="text-xs text-slate-500">{formatDate(sub.current_period_end)}</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card>
		<h2 class="mb-3 text-sm font-semibold tracking-wider text-slate-500 uppercase">
			Webhook ledger
		</h2>
		{#if data.recentWebhooks.length === 0}
			<p class="text-sm text-slate-500">No Stripe events received yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 font-mono text-xs dark:divide-slate-800">
				{#each data.recentWebhooks as ev (ev.id)}
					<li class="flex items-center justify-between py-2">
						<span class="truncate">{ev.type}</span>
						<span class="text-slate-500">{formatDate(ev.received_at)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card>
		<h2 class="mb-3 text-sm font-semibold tracking-wider text-slate-500 uppercase">Audit log</h2>
		{#if data.recentAudit.length === 0}
			<p class="text-sm text-slate-500">No admin actions logged yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 text-xs dark:divide-slate-800">
				{#each data.recentAudit as entry (entry.id)}
					<li class="flex items-center justify-between py-2">
						<span class="font-mono">{entry.action}</span>
						<span class="text-slate-500">{formatDate(entry.created_at)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>
