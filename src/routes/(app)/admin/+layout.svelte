<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { cn } from '$utils/cn';
	import Badge from '$components/ui/Badge.svelte';

	type Props = {
		children: Snippet;
	};

	let { children }: Props = $props();

	const tabs = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/subscriptions', label: 'Subscriptions' },
		{ href: '/admin/coupons', label: 'Coupons' },
		{ href: '/admin/webhooks', label: 'Webhooks' }
	] as const;

	function isActive(href: string): boolean {
		if (href === '/admin') return page.url.pathname === '/admin';
		return page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<title>Admin — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-6xl px-6 py-10">
	<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
				Operations
			</p>
			<h1 class="font-display mt-1 text-3xl font-semibold tracking-tight">Admin console</h1>
			<p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
				Inspect users, manage entitlements, run Stripe coupons, and watch webhook traffic.
			</p>
		</div>
		<Badge variant="warning">Restricted</Badge>
	</header>

	<nav class="mb-8 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				class={cn(
					'-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
					isActive(tab.href)
						? 'border-brand-500 text-slate-900 dark:text-white'
						: 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
				)}
			>
				{tab.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</section>
