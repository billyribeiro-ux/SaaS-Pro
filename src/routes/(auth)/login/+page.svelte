<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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

	// Shared input classes — consolidating keeps focus styling consistent.
	const inputClass =
		'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs placeholder-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-brand-400';
</script>

<svelte:head>
	<title>Sign in — SaaS-Pro</title>
</svelte:head>

<div
	class="rounded-2xl border border-slate-200/80 bg-white/80 p-8 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/80"
>
	<header class="text-center">
		<h1 class="font-display text-2xl font-semibold tracking-tight">Welcome back</h1>
		<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">Sign in to continue building.</p>
	</header>

	<!-- Google OAuth button first, matching conventional OAuth flow ordering. -->
	<form method="POST" action="/auth/google" class="mt-6">
		<Button type="submit" variant="outline" size="md" class="w-full font-medium">
			<Google size={16} />
			Continue with Google
		</Button>
	</form>

	<div class="my-6 flex items-center gap-3">
		<span class="h-px flex-1 bg-slate-200 dark:bg-slate-800"></span>
		<span class="text-xs tracking-wider text-slate-500 uppercase dark:text-slate-400"> or </span>
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
			<div class="flex items-center justify-between">
				<label for="password" class="text-sm font-medium text-slate-800 dark:text-slate-200">
					Password
				</label>
				<a
					href={resolve('/forgot-password')}
					class="text-xs text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
				>
					Forgot?
				</a>
			</div>
			<div class="relative">
				<input
					id="password"
					type={showPassword ? 'text' : 'password'}
					name="password"
					required
					autocomplete="current-password"
					minlength={8}
					placeholder="••••••••"
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
		</div>

		{#if form?.error}
			<p
				class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
			>
				{form.error}
			</p>
		{/if}
		{#if data.errorHint === 'callback_failed'}
			<p
				class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
			>
				Email confirmation link was invalid or expired. Try signing in or request a new one.
			</p>
		{/if}

		<Button
			type="submit"
			variant="primary"
			size="md"
			loading={submitting}
			disabled={submitting}
			class="w-full"
		>
			{submitting ? 'Signing in…' : 'Sign in'}
		</Button>
	</form>

	<p class="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
		New here?
		<a
			href={resolve('/register')}
			class="font-medium text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
		>
			Create an account
		</a>
	</p>
</div>
