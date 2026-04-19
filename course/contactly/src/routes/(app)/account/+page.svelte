<script lang="ts">
	/**
	 * Account page — four destructive-or-personal forms on one screen.
	 *
	 * Pattern: each section is its own <section> with its own
	 * Superforms instance bound to a named server action. The
	 * page-level success/error messages live next to the form they
	 * came from, NOT in a global flash region — that keeps cause and
	 * effect adjacent on screen, especially important for screen
	 * readers using region-by-region navigation.
	 */
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import type { PageProps } from './$types';
	import {
		changeEmailSchema,
		changePasswordSchema,
		deleteAccountSchema,
		updateProfileSchema
	} from '$lib/schemas/auth';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';

	let { data }: PageProps = $props();

	const memberSince = $derived(
		new Date(data.profile.created_at).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		})
	);

	// One Superforms instance per section. Destructured to get the
	// individual stores so we can use `$xxxForm` / `$xxxErrors` /
	// `$xxxMessage` in markup. Naming convention: prefix every store
	// with the section so the markup reads as `$upForm.fullName`,
	// `$ceErrors.email`, etc.
	// svelte-ignore state_referenced_locally
	const {
		form: upForm,
		errors: upErrors,
		message: upMessage,
		enhance: upEnhance,
		delayed: upDelayed,
		submitting: upSubmitting
	} = superForm(data.updateProfileForm, {
		id: 'update_profile',
		validators: zod4Client(updateProfileSchema),
		delayMs: 350,
		// `resetForm: false` keeps the saved values visible after the
		// success response — otherwise the field would clear, which
		// reads as "your name was deleted" to the user.
		resetForm: false
	});
	// svelte-ignore state_referenced_locally
	const {
		form: ceForm,
		errors: ceErrors,
		message: ceMessage,
		enhance: ceEnhance,
		delayed: ceDelayed,
		submitting: ceSubmitting
	} = superForm(data.changeEmailForm, {
		id: 'change_email',
		validators: zod4Client(changeEmailSchema),
		delayMs: 350,
		resetForm: true
	});
	// svelte-ignore state_referenced_locally
	const {
		form: cpForm,
		errors: cpErrors,
		message: cpMessage,
		enhance: cpEnhance,
		delayed: cpDelayed,
		submitting: cpSubmitting
	} = superForm(data.changePasswordForm, {
		id: 'change_password',
		validators: zod4Client(changePasswordSchema),
		delayMs: 350,
		resetForm: true
	});
	// svelte-ignore state_referenced_locally
	const {
		form: daForm,
		errors: daErrors,
		message: daMessage,
		enhance: daEnhance,
		delayed: daDelayed,
		submitting: daSubmitting
	} = superForm(data.deleteAccountForm, {
		id: 'delete_account',
		validators: zod4Client(deleteAccountSchema),
		delayMs: 350
	});
</script>

<svelte:head>
	<title>Account — Contactly</title>
</svelte:head>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight text-slate-900">Account</h1>
		<p class="mt-2 text-sm text-slate-600">Manage your profile, sign-in, and account.</p>
	</header>

	<!-- ============================ Profile ============================ -->
	<section
		class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
		aria-labelledby="profile-heading"
	>
		<h2 id="profile-heading" class="text-lg font-semibold text-slate-900">Profile</h2>

		<dl class="mt-4 divide-y divide-slate-200" data-testid="account-profile">
			<div class="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Email</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="profile-email">
					{data.profile.email}
				</dd>
			</div>
			<div class="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Member since</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="profile-member-since">
					{memberSince}
				</dd>
			</div>
		</dl>

		{#if $upMessage}
			<div
				class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
				role="status"
			>
				{$upMessage}
			</div>
		{/if}

		<form method="POST" action="?/update_profile" use:upEnhance class="mt-4 space-y-4">
			<Field id="up-fullName" label="Full name" error={$upErrors.fullName}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="fullName"
						type="text"
						autocomplete="name"
						bind:value={$upForm.fullName}
						invalid={!!$upErrors.fullName}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
			<Button type="submit" variant="primary" loading={$upDelayed} disabled={$upSubmitting}>
				{$upDelayed ? 'Saving…' : 'Save profile'}
			</Button>
		</form>
	</section>

	<!-- ============================ Email ============================ -->
	<section
		class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
		aria-labelledby="email-heading"
	>
		<h2 id="email-heading" class="text-lg font-semibold text-slate-900">Change email</h2>
		<p class="mt-1 text-sm text-slate-600">
			You'll get a confirmation link at the new address. The change takes effect when you click it.
		</p>

		{#if $ceMessage}
			<div
				class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
				role="status"
			>
				{$ceMessage}
			</div>
		{/if}

		<form method="POST" action="?/change_email" use:ceEnhance class="mt-4 space-y-4">
			<Field id="ce-email" label="New email" required error={$ceErrors.email}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="email"
						type="email"
						autocomplete="email"
						required
						bind:value={$ceForm.email}
						invalid={!!$ceErrors.email}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
			<Button type="submit" variant="primary" loading={$ceDelayed} disabled={$ceSubmitting}>
				{$ceDelayed ? 'Sending…' : 'Send confirmation'}
			</Button>
		</form>
	</section>

	<!-- ========================== Password ============================ -->
	<section
		class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
		aria-labelledby="password-heading"
	>
		<h2 id="password-heading" class="text-lg font-semibold text-slate-900">Change password</h2>
		<p class="mt-1 text-sm text-slate-600">
			At least 12 characters with upper, lower, and a number.
		</p>

		{#if $cpMessage}
			<div
				class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
				role="status"
			>
				{$cpMessage}
			</div>
		{/if}

		<form method="POST" action="?/change_password" use:cpEnhance class="mt-4 space-y-4">
			<Field id="cp-password" label="New password" required error={$cpErrors.password}>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="password"
						type="password"
						autocomplete="new-password"
						required
						minlength={12}
						bind:value={$cpForm.password}
						invalid={!!$cpErrors.password}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
			<Field
				id="cp-confirmPassword"
				label="Confirm new password"
				required
				error={$cpErrors.confirmPassword}
			>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="confirmPassword"
						type="password"
						autocomplete="new-password"
						required
						bind:value={$cpForm.confirmPassword}
						invalid={!!$cpErrors.confirmPassword}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
			<Button type="submit" variant="primary" loading={$cpDelayed} disabled={$cpSubmitting}>
				{$cpDelayed ? 'Updating…' : 'Update password'}
			</Button>
		</form>
	</section>

	<!-- ========================== Danger zone ========================= -->
	<section
		class="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm"
		aria-labelledby="delete-heading"
	>
		<h2 id="delete-heading" class="text-lg font-semibold text-red-900">Delete account</h2>
		<p class="mt-1 text-sm text-red-800">
			Permanently delete your Contactly account and all associated data. This cannot be undone.
		</p>

		{#if $daMessage}
			<div
				class="mt-4 rounded-md border border-red-300 bg-white p-3 text-sm text-red-800"
				role="alert"
			>
				{$daMessage}
			</div>
		{/if}

		<form method="POST" action="?/delete_account" use:daEnhance class="mt-4 space-y-4">
			<Field
				id="da-confirmation"
				label="Type DELETE to confirm"
				required
				hint="Locale-independent. Capital letters."
				error={$daErrors.confirmation}
			>
				{#snippet control({ id, describedBy })}
					<Input
						{id}
						name="confirmation"
						type="text"
						autocomplete="off"
						required
						bind:value={$daForm.confirmation}
						invalid={!!$daErrors.confirmation}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
			<Button
				type="submit"
				variant="danger"
				loading={$daDelayed}
				disabled={$daSubmitting}
				data-testid="delete-account-button"
			>
				{$daDelayed ? 'Deleting…' : 'Delete my account'}
			</Button>
		</form>
	</section>
</div>
