<script lang="ts">
	import type { PageProps } from './$types';
	import Button from '$lib/components/ui/Button.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Sign-in problem — Contactly</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
	<div class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
		<div
			class="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600"
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
					d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
				/>
			</svg>
		</div>

		<h1 class="mt-6 text-center text-2xl font-bold text-slate-900">Link can't be used</h1>
		<p class="mt-2 text-center text-sm text-slate-600" data-testid="auth-error-message">
			{data.message}
		</p>

		<div class="mt-6 flex flex-col gap-2">
			<Button href="/sign-in" variant="primary" class="w-full">Back to sign in</Button>
			<Button href="/sign-up" variant="ghost" class="w-full">Create a new account</Button>
		</div>
	</div>
</div>
