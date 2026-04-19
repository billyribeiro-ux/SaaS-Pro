<script lang="ts">
	import type { User } from '@supabase/supabase-js';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';

	type Props = { user: User | null };
	let { user }: Props = $props();
</script>

<header class="border-b border-slate-200 bg-white">
	<nav class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6" aria-label="Primary">
		<a href={resolve('/')} class="flex items-center gap-2 text-lg font-bold text-slate-900">
			<span
				class="bg-brand-600 inline-flex size-7 items-center justify-center rounded-md text-sm font-bold text-white"
				aria-hidden="true"
			>
				C
			</span>
			Contactly
		</a>

		<div class="flex items-center gap-3">
			{#if user}
				<span class="hidden text-sm text-slate-600 sm:inline" data-testid="nav-user-email">
					{user.email}
				</span>
				<Button href="/dashboard" variant="primary" size="sm">Dashboard</Button>
			{:else}
				<Button href="/sign-in" variant="ghost" size="sm">Sign in</Button>
				<Button href="/sign-up" variant="primary" size="sm">Sign up</Button>
			{/if}
		</div>
	</nav>
</header>
