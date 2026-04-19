<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { scrollY } from 'svelte/reactivity/window';
	import { SITE } from '$config/site.config';
	import Button from '$components/ui/Button.svelte';
	import Menu from '$components/icons/Menu.svelte';
	import X from '$components/icons/X.svelte';
	import Sparkles from '$components/icons/Sparkles.svelte';
	import { cn } from '$utils/cn';
	import { resolvePathname } from '$utils/routes';

	type Props = {
		userEmail?: string | null;
		isAdmin?: boolean;
	};

	let { userEmail = null, isAdmin = false }: Props = $props();

	// `Pathname` (from `$app/types`) is the literal union of every valid app
	// pathname that `resolve()` accepts — tying the nav config to the router
	// catches typos at compile time, not runtime.
	type NavLink = { href: Pathname; label: string; requiresAuth?: boolean; adminOnly?: boolean };

	const links: readonly NavLink[] = [
		{ href: '/', label: 'Home' },
		{ href: '/pricing', label: 'Pricing' },
		{ href: '/contacts', label: 'Contacts', requiresAuth: true },
		{ href: '/learn', label: 'Course', requiresAuth: true },
		{ href: '/admin', label: 'Admin', requiresAuth: true, adminOnly: true }
	];

	let visibleLinks = $derived(
		links.filter((link) => {
			if (link.requiresAuth && !userEmail) return false;
			if (link.adminOnly && !isAdmin) return false;
			return true;
		})
	);

	// Scroll-aware shell — use the built-in reactive window primitive so this
	// remains declarative (no manual listeners needed).
	let scrolled = $derived((scrollY.current ?? 0) > 8);
	let mobileOpen = $state(false);
</script>

<header
	class={cn(
		'sticky top-0 z-40 w-full transition-[background-color,border-color,backdrop-filter] duration-200 ease-[var(--ease-out-expo)]',
		scrolled
			? 'border-b border-slate-200/80 bg-white/75 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/75'
			: 'border-b border-transparent bg-transparent'
	)}
>
	<div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
		<div class="flex items-center gap-8">
			<a
				href={resolve('/')}
				class="group flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight"
			>
				<span
					class="grid size-7 place-items-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm ring-1 ring-white/10 ring-inset"
					aria-hidden="true"
				>
					<Sparkles size="sm" class="text-white" />
				</span>
				<span>{SITE.name}</span>
			</a>
			<nav class="hidden items-center gap-1 text-sm md:flex">
				<!--
				  `resolvePathname` is a thin, type-safe wrapper around `resolve()`
				  — needed because `resolve()`'s generic argument type distributes
				  over `Pathname` unions, which TS can't narrow inside `{#each}`.
				  The rule only recognises direct `resolve()` calls, so we suppress
				  it for this navigation block.
				-->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				{#each visibleLinks as link (link.href)}
					{@const active = page.url.pathname === link.href}
					<a
						href={resolvePathname(link.href)}
						class={cn(
							'relative rounded-md px-3 py-1.5 transition-colors',
							active
								? 'text-slate-900 dark:text-white'
								: 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
						)}
					>
						{link.label}
						{#if active}
							<span
								class="absolute inset-x-3 -bottom-[1px] h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent"
								aria-hidden="true"
							></span>
						{/if}
					</a>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</nav>
		</div>
		<div class="flex items-center gap-2">
			{#if userEmail}
				<a
					href={resolve('/dashboard')}
					class="hidden max-w-[14rem] truncate text-sm text-slate-600 hover:text-slate-900 sm:inline-block dark:text-slate-400 dark:hover:text-white"
				>
					{userEmail}
				</a>
				<form method="POST" action="/account?/signout">
					<Button type="submit" variant="ghost" size="sm">Sign out</Button>
				</form>
			{:else}
				<Button href={resolve('/login')} variant="ghost" size="sm" class="hidden sm:inline-flex">
					Sign in
				</Button>
				<Button href={resolve('/register')} variant="primary" size="sm">Get started</Button>
			{/if}
			<button
				type="button"
				onclick={() => (mobileOpen = !mobileOpen)}
				aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={mobileOpen}
				class="inline-flex size-9 items-center justify-center rounded-md text-slate-700 transition-colors hover:bg-slate-100 md:hidden dark:text-slate-200 dark:hover:bg-slate-800"
			>
				{#if mobileOpen}
					<X size="lg" />
				{:else}
					<Menu size="lg" />
				{/if}
			</button>
		</div>
	</div>

	{#if mobileOpen}
		<div
			class="border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/95"
		>
			<nav class="flex flex-col gap-1">
				<!-- See note above on `resolvePathname` and the lint rule. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				{#each visibleLinks as link (link.href)}
					{@const active = page.url.pathname === link.href}
					<a
						href={resolvePathname(link.href)}
						onclick={() => (mobileOpen = false)}
						class={cn(
							'rounded-md px-3 py-2 text-sm transition-colors',
							active
								? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
								: 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
						)}
					>
						{link.label}
					</a>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if !userEmail}
					<a
						href={resolve('/login')}
						onclick={() => (mobileOpen = false)}
						class="mt-1 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
					>
						Sign in
					</a>
				{/if}
			</nav>
		</div>
	{/if}
</header>
