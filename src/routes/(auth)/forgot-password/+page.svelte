<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$components/ui/Button.svelte';
	import Card from '$components/ui/Card.svelte';
	import type { ActionData } from './$types';

	type Props = {
		form: ActionData;
	};

	let { form }: Props = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Reset password — SaaS-Pro</title>
</svelte:head>

<Card>
	{#snippet header()}
		<h1 class="text-xl font-semibold">Reset your password</h1>
	{/snippet}

	{#if form?.sent}
		<p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
			If an account exists for <strong>{form.email}</strong>, a reset link is on its way.
		</p>
	{:else}
		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="flex flex-col gap-4"
		>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Email</span>
				<input
					type="email"
					name="email"
					required
					autocomplete="email"
					value={form?.email ?? ''}
					class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
				/>
			</label>

			{#if form?.error}
				<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
					{form.error}
				</p>
			{/if}

			<Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
				{#snippet children()}Send reset link{/snippet}
			</Button>
		</form>
	{/if}

	{#snippet footer()}
		<a href="/login" class="text-sm text-slate-600 hover:underline dark:text-slate-400">
			Back to sign in
		</a>
	{/snippet}
</Card>
