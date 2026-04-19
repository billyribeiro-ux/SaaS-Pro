<script lang="ts">
	/**
	 * (app) shell — every authenticated route renders inside this.
	 *
	 * The auth guard lives in `+layout.server.ts` (Lesson 3.3); by the
	 * time this component mounts, `data.user` is guaranteed to be a
	 * real signed-in user (TypeScript's `User | null` is conservative,
	 * but the layout-server's redirect short-circuits the null branch
	 * before we ever render — the `if` below is a defensive sanity
	 * check the type checker also requires).
	 */
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import AppNav from '$lib/components/layout/AppNav.svelte';

	type Props = { data: LayoutData; children: Snippet };
	let { data, children }: Props = $props();
</script>

<div class="flex min-h-screen flex-col bg-slate-50">
	{#if data.user}
		<AppNav user={data.user} />
	{/if}
	<main class="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
		{@render children()}
	</main>
</div>
