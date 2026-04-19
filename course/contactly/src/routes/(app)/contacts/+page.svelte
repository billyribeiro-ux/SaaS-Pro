<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Contacts — Contactly</title>
</svelte:head>

<header class="flex items-end justify-between gap-4">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">Contacts</h1>
		<p class="mt-1 text-sm text-slate-600" data-testid="contacts-count">
			{#if data.contactCount === null}
				Workspace: <span class="font-medium">{data.organization.name}</span>
			{:else if data.contactCount === 0}
				No contacts yet in <span class="font-medium">{data.organization.name}</span>.
			{:else}
				{data.contactCount}
				{data.contactCount === 1 ? 'contact' : 'contacts'}
				in <span class="font-medium">{data.organization.name}</span>.
			{/if}
		</p>
	</div>
	<Button href={resolve('/contacts/new')} data-testid="new-contact-link">New contact</Button>
</header>

<section class="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
	<p class="text-sm text-slate-600">
		The full list view ships in lesson 4.5. For now, head to
		<a href={resolve('/contacts/new')} class="text-brand-700 hover:text-brand-600 font-medium">
			New contact
		</a>
		to add one.
	</p>
</section>
