<script lang="ts">
	import { resolve } from '$app/paths';
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

	// "Showing X–Y of Z" copy. Computed from page+pageSize+count so we
	// don't hard-code the math in two places.
	const range = $derived.by(() => {
		const count = data.contactCount ?? 0;
		if (count === 0) return null;
		const start = (data.page - 1) * data.pageSize + 1;
		const end = Math.min(start + data.contacts.length - 1, count);
		return { start, end, count };
	});

	// Lesson 8.5 — fail-closed contact cap.
	// `capStatus === null` ⇒ tier is unlimited (Pro/Business) and
	// there's nothing to render. Any other shape gets surfaced as a
	// banner above the table so the wall is visible BEFORE the user
	// clicks "New contact".
	const capBlocked = $derived(data.capStatus !== null && !data.capStatus.allowed);
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
	{#if capBlocked}
		<Button
			href={resolve('/pricing')}
			data-testid="upgrade-cta"
			title="Starter plan limit reached — upgrade to add more"
		>
			Upgrade to add more
		</Button>
	{:else}
		<Button href={resolve('/contacts/new')} data-testid="new-contact-link">New contact</Button>
	{/if}
</header>

{#if data.capStatus !== null && !data.capStatus.allowed && data.capStatus.reason === 'cap_reached'}
	<aside
		class="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
		role="alert"
		data-testid="contacts-cap-banner"
	>
		<p class="font-semibold">You've reached your Starter plan limit.</p>
		<p class="mt-1">
			Your workspace is using
			<span class="font-semibold">{data.capStatus.used}</span>
			of {data.capStatus.limit} included contacts. Upgrade to Pro for unlimited contacts.
		</p>
	</aside>
{:else if data.capStatus !== null && !data.capStatus.allowed && data.capStatus.reason === 'unknown'}
	<aside
		class="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
		role="alert"
		data-testid="contacts-cap-unknown"
	>
		Could not verify your plan limits right now. Adding new contacts is paused until we can — try
		refreshing.
	</aside>
{/if}

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
	<div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
		class="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"
		data-testid="contacts-empty"
	>
		{#if data.query.length === 0}
			<h2 class="text-lg font-semibold text-slate-900">Your workspace is empty</h2>
			<p class="mt-1 text-sm text-slate-600">Add your first contact to start building your CRM.</p>
			<div class="mt-4">
				<Button href={resolve('/contacts/new')}>New contact</Button>
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
	<!--
		Pagination as two GET forms. SvelteKit handles `<form method="GET">`
		exactly like a link (it serializes the inputs into the query
		string and navigates), so this is fully SSR-friendly while
		dodging the no-navigation-without-resolve lint that fires on
		anchors with computed hrefs. The hidden inputs preserve the
		current ?q= so paging through search results stays in scope.
	-->
	<nav
		class="mt-6 flex items-center justify-between"
		aria-label="Pagination"
		data-testid="contacts-pager"
	>
		<form method="GET" action={resolve('/(app)/contacts')}>
			{#if data.query.length > 0}
				<input type="hidden" name="q" value={data.query} />
			{/if}
			<input type="hidden" name="page" value={String(data.page - 1)} />
			<button
				type="submit"
				disabled={data.page <= 1}
				class="text-brand-700 hover:text-brand-600 text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-400"
			>
				← Previous
			</button>
		</form>
		<span class="text-sm text-slate-600">
			Page {data.page} of {data.totalPages}
		</span>
		<form method="GET" action={resolve('/(app)/contacts')}>
			{#if data.query.length > 0}
				<input type="hidden" name="q" value={data.query} />
			{/if}
			<input type="hidden" name="page" value={String(data.page + 1)} />
			<button
				type="submit"
				disabled={data.page >= data.totalPages}
				class="text-brand-700 hover:text-brand-600 text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-400"
			>
				Next →
			</button>
		</form>
	</nav>
{/if}
