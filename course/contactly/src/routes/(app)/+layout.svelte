<script lang="ts">
	/**
	 * (app) layout — placeholder.
	 *
	 * The full version (auth guard, app shell, sign-out button, primary
	 * nav) lands in Lesson 3.3. We render the bare minimum here so the
	 * post-sign-in redirect from Lesson 3.2 has a real layout to
	 * inherit and we don't ship a layoutless dashboard.
	 */
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	type Props = { children: Snippet };
	let { children }: Props = $props();
</script>

<div class="flex min-h-screen flex-col bg-slate-50">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
			<a
				href={resolve('/dashboard')}
				class="flex items-center gap-2 text-base font-bold text-slate-900"
			>
				<span
					class="bg-brand-600 inline-flex size-7 items-center justify-center rounded-md text-sm font-bold text-white"
					aria-hidden="true"
				>
					C
				</span>
				Contactly
			</a>
			<!-- Sign-out, primary nav, user menu, etc. land in Lesson 3.4. -->
		</div>
	</header>
	<main class="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
		{@render children()}
	</main>
</div>
