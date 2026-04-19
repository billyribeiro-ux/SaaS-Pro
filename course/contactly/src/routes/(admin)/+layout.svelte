<script lang="ts">
	/**
	 * (admin) shell — minimal, deliberately understated layout for
	 * platform-admin tooling (Module 10.3, augmented in 11.3 with
	 * the deploy-identity strip).
	 *
	 * Why no AppNav? Admin tooling is a different mental mode than
	 * the customer-facing app shell, and the routes inside this
	 * group should never be confused with user-owned data. A
	 * stripped-back chrome makes that boundary visible at a glance,
	 * and the `noindex` meta in the head guarantees we never
	 * accidentally feed an admin page to a search engine or
	 * preview-link unfurler.
	 */
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';

	type Props = { children: Snippet; data: LayoutData };
	let { children, data }: Props = $props();

	const ENV_STYLES: Record<string, string> = {
		production: 'border-rose-200 bg-rose-50 text-rose-800',
		preview: 'border-amber-200 bg-amber-50 text-amber-800',
		development: 'border-slate-200 bg-slate-100 text-slate-700'
	};

	const envStyle = $derived(
		ENV_STYLES[data.deploy.environment] ?? 'border-slate-200 bg-slate-100 text-slate-700'
	);
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
	<title>Admin — Contactly</title>
</svelte:head>

<div class="min-h-screen bg-slate-100 text-slate-900">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
			<div class="flex items-baseline gap-3">
				<a href={resolve('/admin')} class="text-base font-semibold text-slate-900">
					Contactly admin
				</a>
				<span
					class={`rounded-full border px-2 py-0.5 text-xs font-medium ${envStyle}`}
					data-testid="admin-deploy-environment"
				>
					{data.deploy.environment}
				</span>
				<span
					class="font-mono text-xs text-slate-500"
					title={data.deploy.commit ?? 'no git sha available'}
					data-testid="admin-deploy-release"
				>
					{data.deploy.release}
				</span>
			</div>
			<a href={resolve('/')} class="text-sm text-slate-600 hover:text-slate-900">Back to app</a>
		</div>
	</header>
	<main class="mx-auto w-full max-w-6xl px-6 py-8">
		{@render children()}
	</main>
</div>
