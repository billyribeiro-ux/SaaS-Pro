<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$components/ui/Button.svelte';
	import Google from '$components/icons/Google.svelte';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();

	let submitting = $state(false);
	let showPassword = $state(false);

	const inputClass =
		'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs placeholder-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-brand-400';
</script>

<svelte:head>
	<title>Create account — SaaS-Pro</title>
</svelte:head>

<div class="rounded-2xl border border-slate-200/80 bg-white/80 p-8 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
	<header class="text-center">
		<h1 class="font-display text-2xl font-semibold tracking-tight">Create your account</h1>
		<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
			{#if data.lookupKey}
				You'll be routed to checkout after confirming your email.
			{:else}
				Start with a 14-day free trial — no card required.
			{/if}
		</p>
	</header>

	<form method="POST" action="/auth/google" class="mt-6">
		<Button type="submit" variant="outline" size="md" class="w-full font-medium">
			<Google size={16} />
			Sign up with Google
		</Button>
	</form>

	<div class="my-6 flex items-center gap-3">
		<span class="h-px flex-1 bg-slate-200 dark:bg-slate-800"></span>
		<span class="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">or</span>
		<span class="h-px flex-1 bg-slate-200 dark:bg-slate-800"></span>
	</div>

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
		<div class="flex flex-col gap-1.5">
			<label for="fullName" class="text-sm font-medium text-slate-800 dark:text-slate-200">
				Full name
			</label>
			<input
				id="fullName"
				type="text"
				name="fullName"
				required
				autocomplete="name"
				placeholder="Ada Lovelace"
				value={form?.fullName ?? ''}
				class={inputClass}
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<label for="email" class="text-sm font-medium text-slate-800 dark:text-slate-200">
				Email
			</label>
			<input
				id="email"
				type="email"
				name="email"
				required
				autocomplete="email"
				placeholder="you@work.com"
				value={form?.email ?? ''}
				class={inputClass}
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<label for="password" class="text-sm font-medium text-slate-800 dark:text-slate-200">
				Password
			</label>
			<div class="relative">
				<input
					id="password"
					type={showPassword ? 'text' : 'password'}
					name="password"
					required
					minlength={8}
					autocomplete="new-password"
					placeholder="At least 8 characters"
					class="w-full pr-16 {inputClass}"
				/>
				<button
					type="button"
					onclick={() => (showPassword = !showPassword)}
					aria-pressed={showPassword}
					class="absolute inset-y-0 right-2 my-1 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
				>
					{showPassword ? 'Hide' : 'Show'}
				</button>
			</div>
			<p class="mt-1 text-xs text-slate-500 dark:text-slate-500">
				Minimum 8 characters. Use a passphrase you can remember.
			</p>
		</div>

		{#if form?.error}
			<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
				{form.error}
			</p>
		{/if}

		<Button type="submit" variant="primary" size="md" loading={submitting} disabled={submitting} class="w-full">
			{submitting ? 'Creating account…' : 'Create account'}
		</Button>
	</form>

	<p class="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
		Already have an account?
		<a href="/login" class="font-medium text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300">
			Sign in
		</a>
	</p>
</div>
