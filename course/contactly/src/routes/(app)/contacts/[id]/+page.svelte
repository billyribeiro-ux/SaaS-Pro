<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	<header>
		<h1 class="text-2xl font-bold text-slate-900" data-testid="contact-name">
			{data.contact.full_name}
		</h1>
		{#if data.contact.job_title || data.contact.company}
			<p class="mt-1 text-sm text-slate-600">
				{[data.contact.job_title, data.contact.company].filter(Boolean).join(' · ')}
			</p>
		{/if}
		<!-- Edit/delete action buttons land in lessons 4.6 / 4.7. -->
	</header>

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
