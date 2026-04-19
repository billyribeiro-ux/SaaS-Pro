<script lang="ts">
	import { resolve } from '$app/paths';
	import DeleteConfirmModal from '$components/ui/DeleteConfirmModal.svelte';
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();

	let search = $state('');
	let deleteModal = $state({
		open: false,
		contactId: '',
		contactName: ''
	});

	let filteredContacts = $derived(
		search.trim() === ''
			? data.contacts
			: data.contacts.filter((contact) =>
					`${contact.first_name} ${contact.last_name} ${contact.email ?? ''} ${contact.company ?? ''}`
						.toLowerCase()
						.includes(search.toLowerCase())
				)
	);

	function openDeleteModal(id: string, name: string) {
		deleteModal = { open: true, contactId: id, contactName: name };
	}

	function closeDeleteModal() {
		deleteModal = { open: false, contactId: '', contactName: '' };
	}
</script>

<svelte:head>
	<title>Contacts - SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-5xl px-6 py-10">
	<header class="mb-6 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-widest text-slate-500 uppercase dark:text-slate-400">
				Contacts
			</p>
			<h1 class="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">People</h1>
			<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
				{data.contacts.length} total contact{data.contacts.length === 1 ? '' : 's'}
			</p>
		</div>
		<Button href="/contacts/new" size="sm">New contact</Button>
	</header>

	{#if form?.error}
		<div
			class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
		>
			{form.error}
		</div>
	{/if}

	{#if data.contacts.length === 0}
		<Card>
			<div class="text-center">
				<h2 class="text-lg font-semibold text-slate-900 dark:text-white">No contacts yet</h2>
				<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
					Create your first contact to start building your address book.
				</p>
				<div class="mt-5">
					<Button href="/contacts/new" size="sm">Create first contact</Button>
				</div>
			</div>
		</Card>
	{:else}
		<div class="mb-4">
			<input
				type="search"
				bind:value={search}
				placeholder="Search contacts..."
				class="h-10 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:outline-none dark:border-slate-800 dark:bg-slate-950"
			/>
		</div>

		<Card class="overflow-hidden p-0">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead
						class="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"
					>
						<tr class="text-left text-xs tracking-wider text-slate-500 uppercase">
							<th class="px-4 py-3 font-medium">Name</th>
							<th class="px-4 py-3 font-medium">Email</th>
							<th class="px-4 py-3 font-medium">Phone</th>
							<th class="px-4 py-3 font-medium">Company</th>
							<th class="px-4 py-3 text-right font-medium">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100 dark:divide-slate-800">
						{#each filteredContacts as contact (contact.id)}
							<tr class="hover:bg-slate-50/60 dark:hover:bg-slate-900/30">
								<td class="px-4 py-3 font-medium text-slate-900 dark:text-white">
									{contact.first_name}
									{contact.last_name}
								</td>
								<td class="px-4 py-3 text-slate-600 dark:text-slate-300">{contact.email ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600 dark:text-slate-300">{contact.phone ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600 dark:text-slate-300"
									>{contact.company ?? '—'}</td
								>
								<td class="px-4 py-3 text-right">
									<div class="inline-flex items-center gap-3">
										<a
											href={resolve(`/contacts/${contact.id}/edit`)}
											class="text-brand-600 hover:underline"
										>
											Edit
										</a>
										<button
											type="button"
											class="text-red-600 hover:underline"
											onclick={() =>
												openDeleteModal(contact.id, `${contact.first_name} ${contact.last_name}`)}
										>
											Delete
										</button>
									</div>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="5" class="px-4 py-8 text-center text-sm text-slate-500">
									No contacts match "{search}".
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
</section>

<DeleteConfirmModal
	bind:open={deleteModal.open}
	contactId={deleteModal.contactId}
	contactName={deleteModal.contactName}
	onClose={closeDeleteModal}
/>
