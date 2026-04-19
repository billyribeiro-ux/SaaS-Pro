<script lang="ts">
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Check your email — Contactly</title>
</svelte:head>

<div class="space-y-6 text-center">
	<div
		class="bg-brand-50 text-brand-600 mx-auto inline-flex size-12 items-center justify-center rounded-full"
		aria-hidden="true"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke-width="1.5"
			stroke="currentColor"
			class="size-6"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
			/>
		</svg>
	</div>

	<div>
		<h1 class="text-2xl font-bold text-slate-900">Check your email</h1>
		<p class="mt-2 text-sm leading-relaxed text-slate-600" data-testid="forgot-check-email-body">
			{#if data.email}
				If an account exists for
				<strong class="font-semibold text-slate-900">{data.email}</strong>, we sent a password reset
				link.
			{:else}
				If an account exists for that email, we sent a password reset link.
			{/if}
			Click the link to choose a new password. The link expires in an hour.
		</p>
	</div>

	<div class="space-y-2 text-xs text-slate-500">
		<p>
			Didn't get it? Check your spam folder, or
			<a href={resolve('/forgot-password')} class="text-brand-700 hover:text-brand-600 underline"
				>try again</a
			>.
		</p>
		<p class="pt-4">
			In local development, your email lands in
			<a
				href="http://localhost:64324"
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono underline">Inbucket</a
			>.
		</p>
	</div>

	<div class="border-t border-slate-200 pt-6">
		<Button href={resolve('/sign-in')} variant="secondary" size="sm">Back to sign in</Button>
	</div>
</div>
