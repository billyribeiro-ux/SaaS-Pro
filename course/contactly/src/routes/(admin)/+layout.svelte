<script lang="ts">
	/**
	 * (admin) shell — minimal, deliberately understated layout for
	 * platform-admin tooling (Module 10.3).
	 *
	 * Why no AppNav? Admin tooling is a different mental mode than
	 * the customer-facing app shell, and the routes inside this
	 * group should never be confused with user-owned data. A
	 * stripped-back chrome makes that boundary visible at a glance,
	 * and the `noindex` meta in the head guarantees we never
	 * accidentally feed an admin page to a search engine or
	 * preview-link unfurler.
	 */
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	type Props = { children: Snippet };
	let { children }: Props = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
	<title>Admin — Contactly</title>
</svelte:head>

<div class="min-h-screen bg-slate-100 text-slate-900">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
			<div class="flex items-baseline gap-3">
				<a href={resolve('/admin')} class="text-base font-semibold text-slate-900">
					Contactly admin
				</a>
				<span
					class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
				>
					internal
				</span>
			</div>
			<a href={resolve('/')} class="text-sm text-slate-600 hover:text-slate-900">Back to app</a>
		</div>
	</header>
	<main class="mx-auto w-full max-w-6xl px-6 py-8">
		{@render children()}
	</main>
</div>
