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

<div class="flex min-h-[calc(100vh-8rem)]">
	<Sidebar progress={data.progress} hasSubscription={data.hasSubscription} />
	<div class="flex-1 overflow-y-auto">
		{@render children()}
	</div>
</div>
