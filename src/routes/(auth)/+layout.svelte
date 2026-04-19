<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sparkles from '$components/icons/Sparkles.svelte';
	import { SITE } from '$config/site.config';

	type Props = {
		children: Snippet;
	};

	let { children }: Props = $props();
</script>

<!--
	A single decorative wrapper for every auth surface. Puts a soft gradient + grid
	behind the form card so a lone input doesn't sit on bare white space. The children
	are positioned above with `relative`, ensuring they render over the decorative layer.
-->
<div class="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden px-6 py-12">
	<div class="pointer-events-none absolute inset-0 bg-grid mask-radial-fade" aria-hidden="true"></div>
	<div class="pointer-events-none absolute inset-0 bg-mesh opacity-60" aria-hidden="true"></div>

	<div class="relative z-10 w-full max-w-md">
		<a href="/" class="mb-6 flex items-center justify-center gap-2 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300">
			<span
				class="grid size-7 place-items-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm ring-1 ring-inset ring-white/10"
				aria-hidden="true"
			>
				<Sparkles size="sm" class="text-white" />
			</span>
			<span>{SITE.name}</span>
		</a>
		{@render children()}
	</div>
</div>
