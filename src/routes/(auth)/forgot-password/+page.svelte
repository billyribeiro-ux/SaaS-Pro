<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$components/ui/Button.svelte';
	import ArrowLeft from '$components/icons/ArrowLeft.svelte';
	import Check from '$components/icons/Check.svelte';
	import type { ActionData } from './$types';

	type Props = {
		form: ActionData;
	};

	let { form }: Props = $props();

	let submitting = $state(false);

	const inputClass =
		'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs placeholder-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-brand-400';
</script>

<svelte:head>
	<title>Reset password — SaaS-Pro</title>
</svelte:head>

<div
	class="rounded-2xl border border-slate-200/80 bg-white/80 p-8 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/80"
>
	<header class="text-center">
		<h1 class="font-display text-2xl font-semibold tracking-tight">Reset your password</h1>
		<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
			We'll email you a link to set a new one.
		</p>
	</header>

	{#if form?.sent}
		<div
			class="mt-6 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
		>
			<Check size="md" class="mt-0.5 text-emerald-600 dark:text-emerald-400" />
			<div>
				<p class="font-medium">Check your inbox.</p>
				<p class="mt-0.5">
					If an account exists for <strong>{form.email}</strong>, a reset link is on its way.
				</p>
			</div>
		</div>
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
			class="mt-6 flex flex-col gap-4"
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

			{#if form?.error}
				<p
					class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
				>
					{form.error}
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
				{submitting ? 'Sending…' : 'Send reset link'}
			</Button>
		</form>
	{/if}

	<a
		href={resolve('/login')}
		class="mt-6 flex items-center justify-center gap-1.5 text-sm text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
	>
		<ArrowLeft size="sm" />
		Back to sign in
	</a>
</div>
