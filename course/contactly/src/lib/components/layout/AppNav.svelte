<script lang="ts">
	/**
	 * App-shell navigation.
	 *
	 * Renders the brand mark, the user's email, and a sign-out button
	 * for authenticated layouts. Mirrors `MarketingNav.svelte` so the
	 * two surfaces feel consistent (same height, same brand block,
	 * same spacing) while keeping their internals separate — they
	 * answer different questions ("Who are you?" vs "What can you
	 * do?") and will diverge as Modules 4–6 add a primary nav,
	 * search, and a user menu.
	 *
	 * The sign-out button is a real `<form action="/sign-out">`, NOT
	 * an `<a>` or a JS click handler:
	 *   - Form actions are CSRF-safe because Supabase's auth cookie
	 *     is SameSite=Lax — cross-origin POSTs can't carry it.
	 *   - It still works with JavaScript disabled.
	 *   - `use:enhance` from `$app/forms` lets us upgrade to a fetch
	 *     submission when JS is on, which avoids the full page reload
	 *     while still running the same server action.
	 */
	import type { User } from '@supabase/supabase-js';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { cn } from '$lib/utils/cn';
	import Button from '$lib/components/ui/Button.svelte';
	import PlanBadge from '$lib/components/billing/PlanBadge.svelte';
	import type { EntitlementSnapshot } from '$lib/server/billing/entitlements';

	type Props = { user: User; entitlements: EntitlementSnapshot };
	let { user, entitlements }: Props = $props();

	// Primary nav. Highlight an item when the current path *starts*
	// with its href so deep links (e.g. /contacts/123) keep the
	// "Contacts" tab active. Listed in render order — easy to reorder
	// without touching markup.
	type PrimaryLink = { label: string; href: '/dashboard' | '/contacts'; testid: string };
	const primaryLinks: PrimaryLink[] = [
		{ label: 'Dashboard', href: '/dashboard', testid: 'nav-dashboard' },
		{ label: 'Contacts', href: '/contacts', testid: 'nav-contacts' }
	];
</script>

<header class="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
	<nav
		class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
		aria-label="App navigation"
	>
		<div class="flex items-center gap-8">
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

			<ul class="hidden items-center gap-1 sm:flex">
				{#each primaryLinks as link (link.href)}
					{@const isActive =
						link.href === '/dashboard'
							? page.url.pathname === resolve('/dashboard')
							: page.url.pathname === resolve(link.href) ||
								page.url.pathname.startsWith(resolve(link.href) + '/')}
					<li>
						<a
							href={resolve(link.href)}
							data-testid={link.testid}
							aria-current={isActive ? 'page' : undefined}
							class={cn(
								'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
								isActive
									? 'bg-brand-50 text-brand-700'
									: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
							)}
						>
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<div class="flex items-center gap-3">
			<!--
				Plan badge is also a link to /account so a user noticing
				"Trial" / "Past due" can act on it in one click. Keeping
				the link in the same target as the email link means there
				is exactly one billing/profile entry point in the nav.
			-->
			<a
				href={resolve('/account')}
				class="hidden sm:inline"
				aria-label="Open account &mdash; current plan: {entitlements.badgeLabel}"
				data-testid="app-plan-badge-link"
			>
				<PlanBadge {entitlements} size="sm" />
			</a>

			<a
				href={resolve('/account')}
				class="hidden max-w-[200px] truncate text-sm text-slate-600 hover:text-slate-900 sm:inline"
				title={user.email}
				data-testid="app-user-email"
			>
				{user.email}
			</a>

			<form method="POST" action="/sign-out" use:enhance>
				<Button type="submit" variant="ghost" size="sm" data-testid="sign-out-button">
					Sign out
				</Button>
			</form>
		</div>
	</nav>
</header>
