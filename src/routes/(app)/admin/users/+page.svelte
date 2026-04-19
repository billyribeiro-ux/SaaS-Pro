<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Card from '$components/ui/Card.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import { formatDate } from '$utils/format';
	import { PRICING_LOOKUP_KEYS } from '$config/pricing.config';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const lastPage = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	let openGrant = $state<string | null>(null);
	let busy = $state(false);

	function statusVariant(s: string) {
		if (s === 'active' || s === 'trialing') return 'pro' as const;
		if (s === 'past_due' || s === 'unpaid') return 'warning' as const;
		return 'default' as const;
	}
</script>

{#if form?.success}
	<div class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
		Action <span class="font-mono">{form.action}</span> applied.
	</div>
{:else if form && 'error' in form && form.error}
	<div class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
		{form.error}
	</div>
{/if}

<form method="GET" class="mb-4 flex items-center gap-2">
	<input
		type="search"
		name="q"
		value={data.q}
		placeholder="Search email or name…"
		class="h-10 w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:border-slate-800 dark:bg-slate-950"
	/>
	<Button type="submit" variant="outline" size="sm">Search</Button>
	<span class="ml-auto text-xs text-slate-500">
		{data.total.toLocaleString()} users
	</span>
</form>

<Card>
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800">
					<th class="py-2 pr-4 font-medium">User</th>
					<th class="py-2 pr-4 font-medium">Role</th>
					<th class="py-2 pr-4 font-medium">Subscription</th>
					<th class="py-2 pr-4 font-medium">Entitlements</th>
					<th class="py-2 pr-4 font-medium">Joined</th>
					<th class="py-2 pr-4 font-medium text-right">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100 dark:divide-slate-800">
				{#each data.users as user (user.id)}
					<tr>
						<td class="py-3 pr-4">
							<div class="font-medium">{user.full_name ?? '—'}</div>
							<div class="text-xs text-slate-500">{user.email}</div>
						</td>
						<td class="py-3 pr-4">
							{#if user.role === 'admin'}
								<Badge variant="lifetime">admin</Badge>
							{:else}
								<Badge>user</Badge>
							{/if}
						</td>
						<td class="py-3 pr-4">
							{#if user.subscriptions.length === 0}
								<span class="text-xs text-slate-500">none</span>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each user.subscriptions as s, i (i)}
										<Badge variant={statusVariant(s.status)}>{s.status}</Badge>
									{/each}
								</div>
							{/if}
						</td>
						<td class="py-3 pr-4">
							{#if user.entitlements.length === 0}
								<span class="text-xs text-slate-500">—</span>
							{:else}
								<ul class="space-y-1">
									{#each user.entitlements as ent (ent.id)}
										<li class="flex items-center gap-2 text-xs">
											<Badge variant="info">{ent.tier}</Badge>
											<span class="truncate text-slate-500" title={ent.reason}>{ent.reason}</span>
											<form method="POST" action="?/revoke" use:enhance={() => {
												busy = true;
												return async ({ update }) => {
													await update();
													busy = false;
												};
											}}>
												<input type="hidden" name="userId" value={user.id} />
												<input type="hidden" name="entitlementId" value={ent.id} />
												<button type="submit" disabled={busy} class="text-red-600 hover:underline">
													revoke
												</button>
											</form>
										</li>
									{/each}
								</ul>
							{/if}
						</td>
						<td class="py-3 pr-4 text-xs text-slate-500">{formatDate(user.created_at)}</td>
						<td class="py-3 pr-4 text-right">
							<div class="flex justify-end gap-2">
								<form method="POST" action="?/setRole" use:enhance={() => {
									busy = true;
									return async ({ update }) => {
										await update();
										busy = false;
									};
								}}>
									<input type="hidden" name="userId" value={user.id} />
									<input
										type="hidden"
										name="role"
										value={user.role === 'admin' ? 'user' : 'admin'}
									/>
									<button
										type="submit"
										disabled={busy}
										class="text-xs font-medium text-slate-700 hover:underline dark:text-slate-200"
									>
										{user.role === 'admin' ? 'Demote' : 'Make admin'}
									</button>
								</form>
								<button
									type="button"
									class="text-xs font-medium text-brand-600 hover:underline"
									onclick={() => (openGrant = openGrant === user.id ? null : user.id)}
								>
									{openGrant === user.id ? 'Cancel' : 'Grant access'}
								</button>
							</div>

							{#if openGrant === user.id}
								<form
									method="POST"
									action="?/grant"
									use:enhance={() => {
										busy = true;
										return async ({ update }) => {
											await update();
											busy = false;
											openGrant = null;
										};
									}}
									class="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-800 dark:bg-slate-900"
								>
									<input type="hidden" name="userId" value={user.id} />
									<label class="text-xs">
										Tier
										<select
											name="tier"
											class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
										>
											<option value={PRICING_LOOKUP_KEYS.monthly}>Monthly</option>
											<option value={PRICING_LOOKUP_KEYS.yearly}>Yearly</option>
											<option value={PRICING_LOOKUP_KEYS.lifetime}>Lifetime</option>
										</select>
									</label>
									<label class="text-xs">
										Reason
										<input
											name="reason"
											required
											placeholder="e.g. instructor comp, beta tester"
											class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
										/>
									</label>
									<label class="text-xs">
										Expires (optional)
										<input
											type="date"
											name="expiresAt"
											class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
										/>
									</label>
									<Button type="submit" size="sm" loading={busy}>Grant</Button>
								</form>
							{/if}
						</td>
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
				href={`?${new URLSearchParams({ ...Object.fromEntries(page.url.searchParams), page: String(data.page - 1) })}`}
				class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
			>
				Prev
			</a>
		{/if}
		{#if data.page < lastPage}
			<a
				href={`?${new URLSearchParams({ ...Object.fromEntries(page.url.searchParams), page: String(data.page + 1) })}`}
				class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
			>
				Next
			</a>
		{/if}
	</div>
</div>
