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
	import Button from '$lib/components/ui/Button.svelte';

	type Props = { user: User };
	let { user }: Props = $props();
</script>

<header class="border-b border-slate-200 bg-white">
	<nav
		class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
		aria-label="App navigation"
	>
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

		<div class="flex items-center gap-3">
			<span
				class="hidden max-w-[200px] truncate text-sm text-slate-600 sm:inline"
				title={user.email}
				data-testid="app-user-email"
			>
				{user.email}
			</span>

			<form method="POST" action="/sign-out" use:enhance>
				<Button type="submit" variant="ghost" size="sm" data-testid="sign-out-button">
					Sign out
				</Button>
			</form>
		</div>
	</nav>
</header>
