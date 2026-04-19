<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import Navbar from '$components/layout/Navbar.svelte';
	import Footer from '$components/layout/Footer.svelte';
	import Toast from '$components/ui/Toast.svelte';
	import type { LayoutData } from './$types';

	type Props = {
		data: LayoutData;
		children: Snippet;
	};

	let { data, children }: Props = $props();
</script>

<div class="flex min-h-screen flex-col">
	<Navbar userEmail={data.user?.email ?? null} />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
	<Toast />
</div>
