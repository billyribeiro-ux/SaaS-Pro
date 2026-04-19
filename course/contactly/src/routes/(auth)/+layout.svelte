<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	type Props = { children: Snippet };
	let { children }: Props = $props();
</script>

<!--
	Stripped-down "auth" shell. No top nav, no footer — auth pages should
	be a single focused task. Brand mark in the corner so users know
	where they are; everything else is the form.
-->
<div class="flex min-h-screen flex-col bg-slate-50">
	<header class="px-6 py-6">
		<a
			href={resolve('/')}
			class="inline-flex items-center gap-2 text-base font-bold text-slate-900"
		>
			<span
				class="bg-brand-600 inline-flex size-7 items-center justify-center rounded-md text-sm font-bold text-white"
				aria-hidden="true"
			>
				C
			</span>
			Contactly
		</a>
	</header>

	<main class="flex flex-1 items-start justify-center px-6 py-12 sm:items-center">
		<div class="w-full max-w-md">
			<div class="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
				{@render children()}
			</div>
		</div>
	</main>
</div>
