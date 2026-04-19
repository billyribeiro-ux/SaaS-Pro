<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sidebar from '$components/layout/Sidebar.svelte';
	import type { LayoutData } from './$types';

	type Props = {
		data: LayoutData;
		children: Snippet;
	};

	let { data, children }: Props = $props();
</script>

<!--
	Two-column learn shell: a sticky sidebar (hidden on mobile) and a fluid content
	column. The sidebar height is viewport-minus-navbar so it can scroll independently
	on long curricula without dragging the main column with it.
-->
<div class="relative flex min-h-[calc(100vh-4rem)]">
	<div
		class="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 sm:top-16 sm:h-[calc(100vh-4rem)] md:block"
	>
		<Sidebar progress={data.progress} hasSubscription={data.hasSubscription} />
	</div>
	<div class="flex-1 overflow-x-hidden">
		{@render children()}
	</div>
</div>
