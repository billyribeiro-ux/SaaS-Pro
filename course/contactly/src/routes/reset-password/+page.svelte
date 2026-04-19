<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import { resetPasswordSchema } from '$lib/schemas/auth';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const { form, errors, message, enhance, delayed, submitting } = superForm(data.form, {
		validators: zod4Client(resetPasswordSchema),
		delayMs: 350,
		autoFocusOnError: 'detect'
	});
</script>

<svelte:head>
	<title>Choose a new password — Contactly</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-slate-50">
	<header class="px-6 py-6">
		<a
			href={resolve('/')}
			class="inline-flex items-center gap-2 text-base font-bold text-slate-900"
		>
			<span
				class="bg-brand-600 inline-flex size-7 items-center justify-center rounded-md text-sm font-bold text-white"
				aria-hidden="true"
			>
				C
			</span>
			Contactly
		</a>
	</header>

	<main class="flex flex-1 items-start justify-center px-6 py-12 sm:items-center">
		<div class="w-full max-w-md">
			<div
				class="space-y-6 rounded-2xl border border-slate-200/60 bg-white p-8 shadow-xl shadow-slate-200/50"
			>
				<div>
					<h1 class="text-2xl font-bold text-slate-900">Choose a new password</h1>
					<p class="mt-2 text-sm text-slate-600">
						At least 12 characters with upper, lower, and a number.
					</p>
				</div>

				{#if $message}
					<div
						class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
						role="alert"
					>
						{$message}
					</div>
				{/if}

				<form method="POST" use:enhance class="space-y-4" data-testid="reset-password-form">
					<Field id="rp-password" label="New password" required error={$errors.password}>
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

					<Field
						id="rp-confirmPassword"
						label="Confirm new password"
						required
						error={$errors.confirmPassword}
					>
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
						{$delayed ? 'Updating…' : 'Update password'}
					</Button>
				</form>
			</div>
		</div>
	</main>
</div>
