<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	// Zod 4 client adapter (the default `zod`/`zodClient` adapters target
	// Zod 3 and use the legacy `_parse` API that Zod 4 dropped).
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import { signUpSchema } from '$lib/schemas/auth';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';

	let { data }: PageProps = $props();

	/**
	 * `superForm` returns reactive stores. We destructure the ones we use:
	 *
	 *   - $form        — current field values (two-way bound)
	 *   - $errors      — field-level errors keyed by field name
	 *   - $message     — form-root status message (used here for
	 *                    server-side errors that aren't field-specific)
	 *   - enhance      — `use:enhance` action (Superforms' own, NOT
	 *                    `$app/forms` enhance — the Superforms one
	 *                    handles field error propagation, message
	 *                    updates, and timer state)
	 *   - $delayed     — true after `delayMs` of submission (for the
	 *                    "sending…" state). Avoids spinner flash on fast
	 *                    responses.
	 *   - $submitting  — true for the entire submit window
	 *
	 * `validators: zodClient(signUpSchema)` enables client-side
	 * validation BEFORE submit using the same schema the server runs.
	 * That gives instant feedback (no round-trip) while keeping the
	 * server as the source of truth.
	 */
	// svelte-ignore state_referenced_locally
	// `superForm` is initialized once with the load's snapshot. Internal
	// stores then drive reactivity — capturing `data.form` once at init
	// is intentional, not a stale closure.
	const { form, errors, message, enhance, delayed, submitting } = superForm(data.form, {
		validators: zod4Client(signUpSchema),
		delayMs: 350,
		// `'detect'` = focus the first invalid field after a server
		// validation failure. Better UX than scrolling the user; one
		// less click to recovery.
		autoFocusOnError: 'detect'
	});
</script>

<svelte:head>
	<title>Sign up — Contactly</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">Create your account</h1>
		<p class="mt-2 text-sm text-slate-600">
			Already have one?
			<a href={resolve('/sign-in')} class="text-brand-700 hover:text-brand-600 font-medium"
				>Sign in</a
			>
		</p>
	</div>

	{#if $message}
		<!--
			Server-level error (e.g. unexpected Supabase failure) that
			doesn't belong to a single field. role="alert" announces it
			immediately to assistive tech.
		-->
		<div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			{$message}
		</div>
	{/if}

	<form method="POST" use:enhance class="space-y-4" data-testid="sign-up-form">
		<Field
			id="fullName"
			label="Full name"
			hint="Optional. We'll use this on your profile."
			error={$errors.fullName}
		>
			{#snippet control({ id, describedBy })}
				<Input
					{id}
					name="fullName"
					type="text"
					autocomplete="name"
					bind:value={$form.fullName}
					invalid={!!$errors.fullName}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<Field id="email" label="Email" required error={$errors.email}>
			{#snippet control({ id, describedBy })}
				<Input
					{id}
					name="email"
					type="email"
					autocomplete="email"
					required
					bind:value={$form.email}
					invalid={!!$errors.email}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<Field
			id="password"
			label="Password"
			required
			hint="At least 12 characters, with upper, lower, and a number."
			error={$errors.password}
		>
			{#snippet control({ id, describedBy })}
				<Input
					{id}
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength={12}
					bind:value={$form.password}
					invalid={!!$errors.password}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<Field id="confirmPassword" label="Confirm password" required error={$errors.confirmPassword}>
			{#snippet control({ id, describedBy })}
				<Input
					{id}
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					required
					bind:value={$form.confirmPassword}
					invalid={!!$errors.confirmPassword}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<Button
			type="submit"
			variant="primary"
			class="w-full"
			loading={$delayed}
			disabled={$submitting}
		>
			{$delayed ? 'Creating account…' : 'Create account'}
		</Button>
	</form>

	<p class="text-center text-xs text-slate-500">
		By creating an account you agree to our
		<a href={resolve('/terms')} class="underline hover:text-slate-700">Terms</a>
		and
		<a href={resolve('/privacy')} class="underline hover:text-slate-700">Privacy Policy</a>.
	</p>
</div>
