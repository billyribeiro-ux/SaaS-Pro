<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import { formatDate } from '$utils/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const lastPage = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
</script>

<form method="GET" class="mb-4 flex items-center gap-2">
	<input
		type="text"
		name="type"
		value={data.type}
		placeholder="Filter by event type (e.g. customer.subscription.updated)"
		class="h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-800 dark:bg-slate-950"
	/>
	<button
		type="submit"
		class="h-9 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
	>
		Filter
	</button>
	<span class="ml-auto text-xs text-slate-500">{data.total.toLocaleString()} events</span>
</form>

<Card>
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800">
					<th class="py-2 pr-4">Event ID</th>
					<th class="py-2 pr-4">Type</th>
					<th class="py-2 pr-4">Received at</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100 dark:divide-slate-800">
				{#each data.events as ev (ev.id)}
					<tr>
						<td class="py-2 pr-4 font-mono text-xs">
							<a
								href={`https://dashboard.stripe.com/test/events/${ev.id}`}
								target="_blank"
								rel="noreferrer"
								class="text-brand-600 hover:underline"
							>
								{ev.id}
							</a>
						</td>
						<td class="py-2 pr-4 font-mono text-xs">{ev.type}</td>
						<td class="py-2 pr-4 text-xs text-slate-500">{formatDate(ev.received_at)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<div class="mt-4 flex items-center justify-between text-xs text-slate-500">
	<span>Page {data.page} of {lastPage}</span>
	<div class="flex gap-2">
		{#if data.page > 1}
			<a
				href={`?type=${encodeURIComponent(data.type)}&page=${data.page - 1}`}
				class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
			>
				Prev
			</a>
		{/if}
		{#if data.page < lastPage}
			<a
				href={`?type=${encodeURIComponent(data.type)}&page=${data.page + 1}`}
				class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
			>
				Next
			</a>
		{/if}
	</div>
</div>
