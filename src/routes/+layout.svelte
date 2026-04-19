<script lang="ts">
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import Navbar from '$components/layout/Navbar.svelte';
	import Footer from '$components/layout/Footer.svelte';
	import Toast from '$components/ui/Toast.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import type { LayoutData } from './$types';

	type Props = {
		data: LayoutData;
		children: Snippet;
	};

	let { data, children }: Props = $props();

	// The DOM was already themed by the inline script in app.html. This call
	// hydrates our reactive store so the toggle UI reflects the persisted choice
	// and starts the OS-pref listener when the user is in "system" mode.
	onMount(() => themeStore.init());
</script>

<div class="flex min-h-screen flex-col">
	<Navbar userEmail={data.user?.email ?? null} isAdmin={data.isAdmin ?? false} />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
	<Toast />
</div>
