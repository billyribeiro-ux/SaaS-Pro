<script lang="ts">
	import type { PageData } from './$types';

	type Props = {
		data: PageData;
	};

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>Supabase debug — SaaS-Pro</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12">
	<p class="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
		Development only
	</p>
	<h1 class="font-display mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
		Supabase connection
	</h1>
	<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
		Uses <code class="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">locals.supabase</code>
		and reads from <code class="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">products</code> (public
		RLS).
	</p>

	<section class="mt-8 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
		<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Auth session</h2>
		{#if data.user}
			<p class="text-sm text-slate-700 dark:text-slate-300">
				Signed in as <span class="font-mono text-xs">{data.user.email ?? data.user.id}</span>
			</p>
		{:else}
			<p class="text-sm text-slate-600 dark:text-slate-400">Not signed in (anonymous anon key only).</p>
		{/if}
	</section>

	<section class="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
		<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Database</h2>
		{#if data.dbOk}
			<p class="text-sm text-emerald-700 dark:text-emerald-400">Query succeeded.</p>
		{:else}
			<p class="text-sm text-red-600 dark:text-red-400">
				Query failed{data.dbError ? `: ${data.dbError}` : ''}
			</p>
		{/if}

		{#if data.products.length > 0}
			<ul class="divide-y divide-slate-200 text-sm dark:divide-slate-800">
				{#each data.products as row (row.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-xs text-slate-800 dark:text-slate-200">
						<span class="truncate">{row.name}</span>
						<span class="text-slate-500">{row.id}</span>
					</li>
				{/each}
			</ul>
		{:else if data.dbOk}
			<p class="text-sm text-slate-600 dark:text-slate-400">
				No rows in <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">products</code> yet. Run migrations
				(<code class="rounded bg-slate-100 px-1 dark:bg-slate-800">pnpm run db:push</code>) or sync from Stripe.
			</p>
		{/if}
	</section>
</div>
