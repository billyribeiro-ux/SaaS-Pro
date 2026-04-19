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
	<title>Create account — SaaS-Pro</title>
</svelte:head>

<Card>
	{#snippet header()}
		<h1 class="text-xl font-semibold">Create your account</h1>
		{#if data.lookupKey}
			<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
				You'll be routed to checkout after confirming your email.
			</p>
		{/if}
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
			<span class="font-medium">Full name</span>
			<input
				type="text"
				name="fullName"
				required
				autocomplete="name"
				value={form?.fullName ?? ''}
				class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
			/>
		</label>

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
				minlength={8}
				autocomplete="new-password"
				class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
			/>
		</label>

		{#if form?.error}
			<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
				{form.error}
			</p>
		{/if}

		<Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
			{#snippet children()}Create account{/snippet}
		</Button>
	</form>

	{#snippet footer()}
		<p class="text-sm">
			Already have an account?
			<a href="/login" class="text-brand-600 hover:underline dark:text-brand-400">Sign in</a>
		</p>
	{/snippet}
</Card>
