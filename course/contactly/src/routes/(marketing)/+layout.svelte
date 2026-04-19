<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import MarketingNav from '$lib/components/layout/MarketingNav.svelte';

	type Props = { data: LayoutData; children: Snippet };
	let { data, children }: Props = $props();
</script>

<div class="flex min-h-screen flex-col">
	<MarketingNav user={data.user} />
	<div class="flex-1">
		{@render children()}
	</div>
</div>
