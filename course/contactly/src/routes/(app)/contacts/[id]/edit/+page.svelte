<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import { contactWriteSchema } from '$lib/schemas/contacts';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const { form, errors, message, enhance, delayed, submitting } = superForm(data.form, {
		validators: zod4Client(contactWriteSchema),
		delayMs: 350,
		autoFocusOnError: 'detect'
	});
</script>

<svelte:head>
	<title>Edit {data.contact.full_name} — Contactly</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<header>
		<nav class="text-sm">
			<a
				href={resolve('/(app)/contacts/[id]', { id: data.contact.id })}
				class="text-brand-700 hover:text-brand-600 font-medium"
			>
				← Back to contact
			</a>
		</nav>
		<h1 class="mt-2 text-2xl font-bold text-slate-900">Edit contact</h1>
		<p class="mt-1 text-sm text-slate-600">Changes save when you submit the form.</p>
	</header>

	{#if $message}
		<div
			class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
			role="alert"
			data-testid="contact-form-error"
		>
			{typeof $message === 'string' ? $message : $message.text}
		</div>
	{/if}

	<form
		method="POST"
		use:enhance
		class="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
		data-testid="edit-contact-form"
	>
		<Field id="full_name" label="Full name" required error={$errors.full_name}>
			{#snippet control({ id, describedBy })}
				<Input
					{id}
					name="full_name"
					type="text"
					autocomplete="name"
					required
					bind:value={$form.full_name}
					invalid={!!$errors.full_name}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field id="email" label="Email" error={$errors.email}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="email"
						type="email"
						autocomplete="email"
						bind:value={$form.email}
						invalid={!!$errors.email}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field id="phone" label="Phone" error={$errors.phone}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="phone"
						type="tel"
						autocomplete="tel"
						bind:value={$form.phone}
						invalid={!!$errors.phone}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field id="company" label="Company" error={$errors.company}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="company"
						type="text"
						autocomplete="organization"
						bind:value={$form.company}
						invalid={!!$errors.company}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field id="job_title" label="Job title" error={$errors.job_title}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="job_title"
						type="text"
						autocomplete="organization-title"
						bind:value={$form.job_title}
						invalid={!!$errors.job_title}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
		</div>

		<Field id="notes" label="Notes" error={$errors.notes}>
			{#snippet control({ id, describedBy })}
				<Textarea
					{id}
					name="notes"
					rows={5}
					bind:value={$form.notes}
					invalid={!!$errors.notes}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<div class="flex items-center justify-end gap-3 pt-2">
			<Button
				href={resolve('/(app)/contacts/[id]', { id: data.contact.id })}
				variant="ghost"
				type="button"
			>
				Cancel
			</Button>
			<Button
				type="submit"
				variant="primary"
				loading={$delayed}
				disabled={$submitting}
				data-testid="save-contact"
			>
				{$delayed ? 'Saving…' : 'Save changes'}
			</Button>
		</div>
	</form>
</div>
