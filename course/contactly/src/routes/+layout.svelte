<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { invalidate } from '$app/navigation';
	import type { LayoutData } from './$types';

	type Props = { data: LayoutData; children: Snippet };
	let { data, children }: Props = $props();

	/**
	 * Re-run every load that read from `+layout.ts` whenever the
	 * Supabase browser client's view of the session changes:
	 *
	 *   - SIGNED_IN  — the user just logged in
	 *   - SIGNED_OUT — the user just logged out
	 *   - TOKEN_REFRESHED — the access JWT was refreshed
	 *
	 * Calling `invalidate('supabase:auth')` flips the dependency we
	 * registered in `+layout.ts` (`depends('supabase:auth')`), and
	 * SvelteKit re-runs the load — which re-builds the Supabase client
	 * with the new cookies and re-runs every child load that depends
	 * on session/user. The UI updates without a page reload.
	 *
	 * `$effect` runs in the browser only (it's a no-op during SSR),
	 * which is exactly what we want: `onAuthStateChange` only exists
	 * on the browser client, and calling `invalidate` on the server
	 * during the initial render would be meaningless.
	 *
	 * The cleanup function unsubscribes when the layout is destroyed
	 * (effectively never, since this is the root layout, but principle
	 * matters — avoid the listener-leak pattern even when it's free).
	 */
	$effect(() => {
		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((event) => {
			if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
				invalidate('supabase:auth');
			}
		});

		return () => subscription.unsubscribe();
	});
</script>

{@render children()}
