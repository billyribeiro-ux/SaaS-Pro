<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	import Navbar from '$components/layout/Navbar.svelte';
	import Footer from '$components/layout/Footer.svelte';
	import Toast from '$components/ui/Toast.svelte';
	import type { LayoutData } from './$types';

	type Props = {
		data: LayoutData;
		children: Snippet;
	};

	let { data, children }: Props = $props();

	// New deploy detector. `kit.version.pollInterval` (svelte.config.js) makes
	// the client fetch `/_app/version.json` on a timer; when the version on
	// disk no longer matches the one this tab was loaded with, `updated.current`
	// flips to `true`. We then bypass SvelteKit's client router on the very
	// next navigation and do a real `location.href = ...` so the browser
	// re-downloads HTML+immutable assets that match the new deploy. Without
	// this, the open tab keeps requesting hashed JS/CSS from a build that
	// no longer exists on the edge and the user sees the `_app/immutable/...`
	// 404 storm. `willUnload` is excluded — those navigations are full reloads
	// already and we'd just be reassigning to the same URL.
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});
</script>

<div class="flex min-h-screen flex-col">
	<Navbar userEmail={data.user?.email ?? null} isAdmin={data.isAdmin ?? false} />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
	<Toast />
</div>
