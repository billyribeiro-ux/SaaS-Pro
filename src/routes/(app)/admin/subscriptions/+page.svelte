<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { formatDate, formatPrice } from '$utils/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUSES = ['', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'] as const;

	function variant(s: string) {
		if (s === 'active' || s === 'trialing') return 'pro' as const;
		if (s === 'past_due' || s === 'unpaid') return 'warning' as const;
		if (s === 'canceled') return 'danger' as const;
		return 'default' as const;
	}
</script>

<div class="mb-4 flex items-center gap-2">
	<form method="GET" class="flex items-center gap-2">
		<label for="sub-status-filter" class="text-xs uppercase tracking-wider text-slate-500">
			Status
		</label>
		<select
			id="sub-status-filter"
			name="status"
			value={data.status}
			class="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-800 dark:bg-slate-950"
			onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
		>
			{#each STATUSES as s (s)}
				<option value={s}>{s === '' ? 'all' : s}</option>
			{/each}
		</select>
	</form>
	<span class="ml-auto text-xs text-slate-500">{data.total.toLocaleString()} subscriptions</span>
</div>

<Card>
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800">
					<th class="py-2 pr-4">User</th>
					<th class="py-2 pr-4">Status</th>
					<th class="py-2 pr-4">Plan</th>
					<th class="py-2 pr-4">Period end</th>
					<th class="py-2 pr-4">Trial ends</th>
					<th class="py-2 pr-4 font-mono">Stripe</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100 dark:divide-slate-800">
				{#each data.subscriptions as sub (sub.id)}
					{@const price = sub.prices as { lookup_key: string | null; unit_amount: number | null; currency: string } | null}
					<tr>
						<td class="py-3 pr-4">
							<div class="font-medium">{sub.profile?.full_name ?? '—'}</div>
							<div class="text-xs text-slate-500">{sub.profile?.email ?? sub.user_id}</div>
						</td>
						<td class="py-3 pr-4">
							<Badge variant={variant(sub.status)}>{sub.status}</Badge>
							{#if sub.cancel_at_period_end}
								<div class="mt-1 text-xs text-amber-600">cancels at period end</div>
							{/if}
						</td>
						<td class="py-3 pr-4">
							{#if price}
								<div class="font-mono text-xs">{price.lookup_key ?? sub.price_id}</div>
								<div class="text-xs text-slate-500">
									{formatPrice(price.unit_amount, price.currency)}
								</div>
							{:else}
								<span class="font-mono text-xs">{sub.price_id ?? '—'}</span>
							{/if}
						</td>
						<td class="py-3 pr-4 text-xs">{formatDate(sub.current_period_end)}</td>
						<td class="py-3 pr-4 text-xs">{formatDate(sub.trial_end)}</td>
						<td class="py-3 pr-4 font-mono text-xs">
							<a
								href={`https://dashboard.stripe.com/test/subscriptions/${sub.id}`}
								target="_blank"
								rel="noreferrer"
								class="text-brand-600 hover:underline"
							>
								{sub.id}
							</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>
