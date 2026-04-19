<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Local state for the search input. Initialized from the URL so a
	// page refresh keeps the typed query visible. The actual filter
	// happens via the GET form below — submitting reloads the page
	// with the new ?q=, which re-runs the load function.
	// svelte-ignore state_referenced_locally
	let searchValue = $state(data.query);

	// Helper: build a URL preserving every param except the one(s) we
	// override. Used by the pagination links below.
	//
	// We use a plain Array of [key, value] pairs instead of
	// `URLSearchParams` because the svelte/prefer-svelte-reactivity
	// lint rule doesn't want us holding a mutable URLSearchParams in
	// component scope (it isn't reactive). For a one-shot URL build
	// the manual encoding is just as cheap.
	function pageHref(targetPage: number): string {
		const params: Array<[string, string]> = [];
		for (const [key, value] of page.url.searchParams) {
			if (key === 'page') continue;
			params.push([key, value]);
		}
		if (targetPage > 1) params.push(['page', String(targetPage)]);
		const qs = params
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join('&');
		const base = resolve('/(app)/contacts');
		return qs.length > 0 ? `${base}?${qs}` : base;
	}

	// "Showing X–Y of Z" copy. Computed from page+pageSize+count so we
	// don't hard-code the math in two places.
	const range = $derived.by(() => {
		const count = data.contactCount ?? 0;
		if (count === 0) return null;
		const start = (data.page - 1) * data.pageSize + 1;
		const end = Math.min(start + data.contacts.length - 1, count);
		return { start, end, count };
	});
</script>

<svelte:head>
	<title>Contacts — Contactly</title>
</svelte:head>

<header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">Contacts</h1>
		<p class="mt-1 text-sm text-slate-600" data-testid="contacts-count">
			{#if data.loadError}
				Could not load your contacts right now.
			{:else if data.contactCount === 0 && data.query.length === 0}
				No contacts yet in <span class="font-medium">{data.organization.name}</span>.
			{:else if data.contactCount === 0}
				No contacts match <span class="font-medium">"{data.query}"</span>.
			{:else if range}
				Showing {range.start}–{range.end} of {range.count}
				{range.count === 1 ? 'contact' : 'contacts'} in
				<span class="font-medium">{data.organization.name}</span>.
			{/if}
		</p>
	</div>
	<Button href={resolve('/contacts/new')} data-testid="new-contact-link">New contact</Button>
</header>

<form method="GET" class="mt-6 flex items-center gap-2" data-testid="contacts-search">
	<label for="contacts-q" class="sr-only">Search contacts</label>
	<Input
		id="contacts-q"
		name="q"
		type="search"
		placeholder="Search by name, company, or email"
		bind:value={searchValue}
		class="max-w-md"
	/>
	<Button type="submit" variant="secondary">Search</Button>
	{#if data.query.length > 0}
		<Button href={resolve('/contacts')} variant="ghost">Clear</Button>
	{/if}
</form>

{#if data.contacts.length > 0}
	<div class="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
		<table class="min-w-full divide-y divide-slate-200" data-testid="contacts-table">
			<thead class="bg-slate-50">
				<tr>
					<th
						scope="col"
						class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase"
					>
						Name
					</th>
					<th
						scope="col"
						class="hidden px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase sm:table-cell"
					>
						Company
					</th>
					<th
						scope="col"
						class="hidden px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase md:table-cell"
					>
						Email
					</th>
					<th
						scope="col"
						class="hidden px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase md:table-cell"
					>
						Phone
					</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.contacts as contact (contact.id)}
					<tr class="hover:bg-slate-50">
						<td class="px-4 py-3">
							<a
								href={resolve('/(app)/contacts/[id]', { id: contact.id })}
								class="text-brand-700 hover:text-brand-600 font-medium"
								data-testid="contact-link"
							>
								{contact.full_name}
							</a>
							{#if contact.job_title}
								<div class="text-xs text-slate-500">{contact.job_title}</div>
							{/if}
						</td>
						<td class="hidden px-4 py-3 text-sm text-slate-700 sm:table-cell">
							{contact.company ?? '—'}
						</td>
						<td class="hidden px-4 py-3 text-sm text-slate-700 md:table-cell">
							{contact.email ?? '—'}
						</td>
						<td class="hidden px-4 py-3 text-sm text-slate-700 md:table-cell">
							{contact.phone ?? '—'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if !data.loadError}
	<section
		class="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center"
		data-testid="contacts-empty"
	>
		{#if data.query.length === 0}
			<h2 class="text-lg font-semibold text-slate-900">Your workspace is empty</h2>
			<p class="mt-1 text-sm text-slate-600">Add your first contact to start building your CRM.</p>
			<div class="mt-4">
				<Button href={resolve('/(app)/contacts/new')}>New contact</Button>
			</div>
		{:else}
			<h2 class="text-lg font-semibold text-slate-900">No matches</h2>
			<p class="mt-1 text-sm text-slate-600">
				Try a different search, or
				<a href={resolve('/contacts')} class="text-brand-700 hover:text-brand-600 font-medium">
					clear the filter
				</a>.
			</p>
		{/if}
	</section>
{/if}

{#if data.totalPages > 1}
	<nav
		class="mt-6 flex items-center justify-between"
		aria-label="Pagination"
		data-testid="contacts-pager"
	>
		<!-- pageHref builds the URL via resolve() internally; the lint
			 rule can't see through the function call so we acknowledge
			 it here. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a
			href={pageHref(data.page - 1)}
			class="text-sm font-medium {data.page <= 1
				? 'pointer-events-none text-slate-400'
				: 'text-brand-700 hover:text-brand-600'}"
			aria-disabled={data.page <= 1 ? 'true' : undefined}
		>
			← Previous
		</a>
		<span class="text-sm text-slate-600">
			Page {data.page} of {data.totalPages}
		</span>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a
			href={pageHref(data.page + 1)}
			class="text-sm font-medium {data.page >= data.totalPages
				? 'pointer-events-none text-slate-400'
				: 'text-brand-700 hover:text-brand-600'}"
			aria-disabled={data.page >= data.totalPages ? 'true' : undefined}
		>
			Next →
		</a>
	</nav>
{/if}
