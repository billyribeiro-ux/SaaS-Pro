<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$components/ui/Button.svelte';
	import Card from '$components/ui/Card.svelte';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Sign in — SaaS-Pro</title>
</svelte:head>

<Card>
	{#snippet header()}
		<h1 class="text-xl font-semibold">Welcome back</h1>
	{/snippet}

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

		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Password</span>
			<input
				type="password"
				name="password"
				required
				autocomplete="current-password"
				minlength={8}
				class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
			/>
		</label>

		{#if form?.error}
			<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
				{form.error}
			</p>
		{/if}
		{#if data.errorHint === 'callback_failed'}
			<p class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
				Email confirmation link was invalid or expired. Try signing in or request a new one.
			</p>
		{/if}

		<Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
			{#snippet children()}Sign in{/snippet}
		</Button>
	</form>

	{#snippet footer()}
		<div class="flex items-center justify-between text-sm">
			<a href="/forgot-password" class="text-slate-600 hover:underline dark:text-slate-400">
				Forgot password?
			</a>
			<a href="/register" class="text-brand-600 hover:underline dark:text-brand-400">
				Create account
			</a>
		</div>
	{/snippet}
</Card>
