<script lang="ts">
	// Stub. Lesson 3.2 (User Login) replaces this with the real
	// password + magic-link sign-in form. Exists now so cross-links
	// from the sign-up page (`/sign-in`) and marketing nav resolve
	// against SvelteKit's typed-route table.
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
</script>

<svelte:head>
	<title>Sign in — Contactly</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">Sign in</h1>
		<p class="mt-2 text-sm text-slate-600">
			This page lands in <strong>Lesson 3.2 — User Login</strong>. For now, head back to the
			marketing site or try the sign-up flow.
		</p>
	</div>

	<div class="flex flex-col gap-2">
		<Button href={resolve('/sign-up')} variant="primary" class="w-full">
			Create an account instead
		</Button>
		<Button href={resolve('/')} variant="ghost" class="w-full">Back home</Button>
	</div>
</div>
