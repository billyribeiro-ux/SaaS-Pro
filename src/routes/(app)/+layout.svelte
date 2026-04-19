<script lang="ts">
	import type { Snippet } from 'svelte';

	// This layout is a pure pass-through — the (app) auth guard lives in
	// +layout.server.ts. We intentionally don't read `data` here; child routes
	// access it through their own $types.
	type Props = {
		children: Snippet;
	};

	let { children }: Props = $props();
</script>

{@render children()}
