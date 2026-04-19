<script lang="ts">
	import { enhance } from '$app/forms';
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Edit Contact - SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-3xl px-6 py-10">
	<header class="mb-6">
		<p class="text-xs font-semibold tracking-widest text-slate-500 uppercase dark:text-slate-400">
			Contacts
		</p>
		<h1 class="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
			Edit contact
		</h1>
		<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
			Update details for {data.contact.first_name}
			{data.contact.last_name}.
		</p>
	</header>

	<Card>
		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="space-y-4"
		>
			{#if form?.error}
				<div
					class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
				>
					{form.error}
				</div>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label
						for="first_name"
						class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
					>
						First name
					</label>
					<input
						id="first_name"
						name="first_name"
						required
						maxlength="100"
						value={data.contact.first_name}
						class="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:outline-none dark:border-slate-800 dark:bg-slate-950"
					/>
				</div>
				<div>
					<label
						for="last_name"
						class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
					>
						Last name
					</label>
					<input
						id="last_name"
						name="last_name"
						required
						maxlength="100"
						value={data.contact.last_name}
						class="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:outline-none dark:border-slate-800 dark:bg-slate-950"
					/>
				</div>
			</div>

			<div>
				<label
					for="email"
					class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
				>
					Email
				</label>
				<input
					id="email"
					name="email"
					type="email"
					maxlength="255"
					value={data.contact.email ?? ''}
					placeholder="name@company.com"
					class="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:outline-none dark:border-slate-800 dark:bg-slate-950"
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label
						for="phone"
						class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
					>
						Phone
					</label>
					<input
						id="phone"
						name="phone"
						type="tel"
						maxlength="50"
						value={data.contact.phone ?? ''}
						placeholder="+1 555 0100"
						class="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:outline-none dark:border-slate-800 dark:bg-slate-950"
					/>
				</div>
				<div>
					<label
						for="company"
						class="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
					>
						Company
					</label>
					<input
						id="company"
						name="company"
						maxlength="200"
						value={data.contact.company ?? ''}
						placeholder="Acme Corp"
						class="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:outline-none dark:border-slate-800 dark:bg-slate-950"
					/>
				</div>
			</div>

			<div class="flex items-center gap-2 pt-2">
				<Button type="submit" loading={submitting} size="sm">
					{submitting ? 'Saving...' : 'Save changes'}
				</Button>
				<Button href="/contacts" variant="outline" size="sm">Cancel</Button>
			</div>
		</form>
	</Card>
</section>
