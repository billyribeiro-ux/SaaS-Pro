<script lang="ts">
	import { page } from '$app/state';
	import { SITE } from '$config/site.config';
	import Button from '$components/ui/Button.svelte';
	import { cn } from '$utils/cn';

	type Props = {
		userEmail?: string | null;
	};

	let { userEmail = null }: Props = $props();

	type NavLink = { href: string; label: string; requiresAuth?: boolean };

	const links: readonly NavLink[] = [
		{ href: '/', label: 'Home' },
		{ href: '/pricing', label: 'Pricing' },
		{ href: '/learn', label: 'Course', requiresAuth: true }
	];

	let visibleLinks = $derived(
		links.filter((link) => !link.requiresAuth || Boolean(userEmail))
	);
</script>

<header class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
	<div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
		<div class="flex items-center gap-6">
			<a href="/" class="text-lg font-semibold tracking-tight">{SITE.name}</a>
			<nav class="hidden items-center gap-4 text-sm md:flex">
				{#each visibleLinks as link (link.href)}
					<a
						href={link.href}
						class={cn(
							'rounded-md px-3 py-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800',
							page.url.pathname === link.href
								? 'text-brand-700 dark:text-brand-300'
								: 'text-slate-700 dark:text-slate-300'
						)}
					>
						{link.label}
					</a>
				{/each}
			</nav>
		</div>
		<div class="flex items-center gap-3">
			{#if userEmail}
				<a href="/dashboard" class="text-sm text-slate-700 hover:underline dark:text-slate-300">
					{userEmail}
				</a>
				<form method="POST" action="/account?/signout">
					<Button type="submit" variant="ghost" size="sm">{#snippet children()}Sign out{/snippet}</Button>
				</form>
			{:else}
				<Button href="/login" variant="ghost" size="sm">{#snippet children()}Sign in{/snippet}</Button>
				<Button href="/register" variant="primary" size="sm">{#snippet children()}Get started{/snippet}</Button>
			{/if}
		</div>
	</div>
</header>
