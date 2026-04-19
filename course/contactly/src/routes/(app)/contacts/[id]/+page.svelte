<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let showDeleteModal = $state(false);
	let deleting = $state(false);

	const dateFormatter = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function formatDate(iso: string): string {
		return dateFormatter.format(new Date(iso));
	}
</script>

<svelte:head>
	<title>{data.contact.full_name} — Contactly</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<nav class="text-sm">
		<a href={resolve('/contacts')} class="text-brand-700 hover:text-brand-600 font-medium">
			← Back to contacts
		</a>
	</nav>

	{#if page.url.searchParams.get('saved')}
		<div
			class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
			role="status"
			data-testid="contact-saved-flash"
		>
			Contact saved.
		</div>
	{/if}

	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-slate-900" data-testid="contact-name">
				{data.contact.full_name}
			</h1>
			{#if data.contact.job_title || data.contact.company}
				<p class="mt-1 text-sm text-slate-600">
					{[data.contact.job_title, data.contact.company].filter(Boolean).join(' · ')}
				</p>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<Button
				href={resolve('/(app)/contacts/[id]/edit', { id: data.contact.id })}
				variant="secondary"
				data-testid="edit-contact-link"
			>
				Edit
			</Button>
			<Button
				variant="danger"
				type="button"
				onclick={() => (showDeleteModal = true)}
				data-testid="delete-contact-button"
			>
				Delete
			</Button>
		</div>
	</header>

	{#if form?.deleteError}
		<div
			class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
			role="alert"
			data-testid="delete-error"
		>
			{form.deleteError}
		</div>
	{/if}

	<dl class="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-2">
		<div>
			<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Email</dt>
			<dd class="mt-1 text-sm text-slate-900">
				{#if data.contact.email}
					<a class="text-brand-700 hover:text-brand-600" href={`mailto:${data.contact.email}`}>
						{data.contact.email}
					</a>
				{:else}
					<span class="text-slate-400">—</span>
				{/if}
			</dd>
		</div>

		<div>
			<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Phone</dt>
			<dd class="mt-1 text-sm text-slate-900">
				{#if data.contact.phone}
					<a class="text-brand-700 hover:text-brand-600" href={`tel:${data.contact.phone}`}>
						{data.contact.phone}
					</a>
				{:else}
					<span class="text-slate-400">—</span>
				{/if}
			</dd>
		</div>

		<div>
			<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Company</dt>
			<dd class="mt-1 text-sm text-slate-900">
				{data.contact.company ?? '—'}
			</dd>
		</div>

		<div>
			<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Job title</dt>
			<dd class="mt-1 text-sm text-slate-900">
				{data.contact.job_title ?? '—'}
			</dd>
		</div>
	</dl>

	{#if data.contact.notes}
		<section class="rounded-lg border border-slate-200 bg-white p-6">
			<h2 class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Notes</h2>
			<!-- whitespace-pre-line preserves user paragraph breaks
				 without enabling raw HTML. We never set innerHTML on
				 user-supplied text. -->
			<p class="mt-2 text-sm whitespace-pre-line text-slate-800">{data.contact.notes}</p>
		</section>
	{/if}

	<footer class="text-xs text-slate-500">
		Added {formatDate(data.contact.created_at)}
		{#if data.contact.updated_at !== data.contact.created_at}
			· last edited {formatDate(data.contact.updated_at)}
		{/if}
	</footer>
</div>

<Modal
	id="delete-contact"
	title="Delete this contact?"
	description="This permanently removes {data.contact
		.full_name} and any notes you've kept on them. This can't be undone."
	bind:open={showDeleteModal}
	testid="delete-contact-modal"
>
	<form
		method="POST"
		action="?/delete"
		use:enhance={() => {
			deleting = true;
			return async ({ update }) => {
				// `update()` resolves the action promise (running the
				// usual redirect/error/render flow). Whatever happens
				// next, we no longer need the modal open or the
				// "deleting…" state — the redirect closes the page,
				// or the failure renders an error banner above.
				await update();
				deleting = false;
				showDeleteModal = false;
			};
		}}
		class="flex flex-col gap-3"
	>
		<div class="flex justify-end gap-3 pt-2">
			<Button
				type="button"
				variant="ghost"
				onclick={() => (showDeleteModal = false)}
				disabled={deleting}
				data-testid="cancel-delete"
			>
				Cancel
			</Button>
			<Button
				type="submit"
				variant="danger"
				loading={deleting}
				disabled={deleting}
				data-testid="confirm-delete"
			>
				{deleting ? 'Deleting…' : 'Delete contact'}
			</Button>
		</div>
	</form>
</Modal>
