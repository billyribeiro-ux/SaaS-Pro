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

	// Pre-flight cap state (loaded server-side). We disable Save and
	// show the upgrade banner BEFORE the user types if they've already
	// hit the wall — far better UX than letting them fill out the
	// form, hit submit, and only then learn they're out of room.
	const capBlocked = $derived(data.capStatus !== null && !data.capStatus.allowed);
	const capWarn = $derived(
		data.capStatus !== null &&
			data.capStatus.allowed &&
			data.capStatus.limit !== null &&
			data.capStatus.limit > 0 &&
			(data.capStatus.remaining ?? 0) <= Math.max(1, Math.floor(data.capStatus.limit * 0.1))
	);

	const messageObj = $derived(
		typeof $message === 'object' && $message !== null
			? ($message as { type?: string; text?: string; code?: string })
			: null
	);
	const isCapMessage = $derived(messageObj?.code === 'cap_reached');
</script>

<svelte:head>
	<title>New contact — Contactly</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<header>
		<nav class="text-sm">
			<a href={resolve('/contacts')} class="text-brand-700 hover:text-brand-600 font-medium">
				← Back to contacts
			</a>
		</nav>
		<h1 class="mt-2 text-2xl font-bold text-slate-900">New contact</h1>
		<p class="mt-1 text-sm text-slate-600">Only the full name is required.</p>
	</header>

	{#if capBlocked && data.capStatus && !data.capStatus.allowed && data.capStatus.reason === 'cap_reached'}
		<div
			class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
			role="alert"
			data-testid="contact-cap-banner"
		>
			<p class="font-semibold">You've reached your Starter plan limit.</p>
			<p class="mt-1">
				Your workspace is using {data.capStatus.used} of {data.capStatus.limit} included contacts. Upgrade
				to Pro for unlimited contacts and to keep adding people.
			</p>
			<div class="mt-3">
				<Button href={resolve('/pricing')} variant="primary">Upgrade to Pro</Button>
			</div>
		</div>
	{:else if capWarn && data.capStatus && data.capStatus.allowed && data.capStatus.limit !== null}
		<div
			class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
			role="status"
			data-testid="contact-cap-warning"
		>
			You have <span class="font-semibold">{data.capStatus.remaining}</span>
			of {data.capStatus.limit} contacts remaining on Starter.
			<a href={resolve('/pricing')} class="underline hover:no-underline">Upgrade for unlimited</a>.
		</div>
	{/if}

	{#if $message}
		<div
			class={isCapMessage
				? 'rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900'
				: 'rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800'}
			role="alert"
			data-testid={isCapMessage ? 'contact-cap-banner' : 'contact-form-error'}
		>
			<p>{typeof $message === 'string' ? $message : ($message.text ?? 'Something went wrong.')}</p>
			{#if isCapMessage}
				<div class="mt-3">
					<Button href={resolve('/pricing')} variant="primary">Upgrade to Pro</Button>
				</div>
			{/if}
		</div>
	{/if}

	<form
		method="POST"
		use:enhance
		class="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
		data-testid="new-contact-form"
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

		<Field id="notes" label="Notes" hint="Anything you want to remember." error={$errors.notes}>
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
			<Button href={resolve('/contacts')} variant="ghost" type="button">Cancel</Button>
			<Button
				type="submit"
				variant="primary"
				loading={$delayed}
				disabled={$submitting || capBlocked}
				data-testid="save-contact"
			>
				{$delayed ? 'Saving…' : 'Save contact'}
			</Button>
		</div>
	</form>
</div>
