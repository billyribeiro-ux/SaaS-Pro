<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import { forgotPasswordSchema } from '$lib/schemas/auth';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const { form, errors, message, enhance, delayed, submitting } = superForm(data.form, {
		validators: zod4Client(forgotPasswordSchema),
		delayMs: 350,
		autoFocusOnError: 'detect'
	});
</script>

<svelte:head>
	<title>Forgot password — Contactly</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">Forgot your password?</h1>
		<p class="mt-2 text-sm text-slate-600">
			Enter your email and we'll send you a link to reset it.
		</p>
	</div>

	{#if $message}
		<div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			{$message}
		</div>
	{/if}

	<form method="POST" use:enhance class="space-y-4" data-testid="forgot-password-form">
		<Field id="fp-email" label="Email" required error={$errors.email}>
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

		<Button
			type="submit"
			variant="primary"
			class="w-full"
			loading={$delayed}
			disabled={$submitting}
		>
			{$delayed ? 'Sending…' : 'Send reset link'}
		</Button>
	</form>

	<p class="text-center text-sm text-slate-600">
		Remembered it?
		<a href={resolve('/sign-in')} class="text-brand-700 hover:text-brand-600 font-medium"
			>Back to sign in</a
		>
	</p>
</div>
