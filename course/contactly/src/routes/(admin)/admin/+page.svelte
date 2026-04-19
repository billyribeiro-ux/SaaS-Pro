<script lang="ts">
	/**
	 * Admin home — directory of platform-admin tools.
	 *
	 * Currently a single-card layout for /admin/webhooks. Future
	 * lessons (replay, search, etc.) extend this list rather than
	 * adding a separate dashboard, so the admin first-page-load
	 * always shows everything available without nesting.
	 */
	import { resolve } from '$app/paths';
</script>

<header class="mb-6">
	<h1 class="text-xl font-semibold text-slate-900">Tools</h1>
	<p class="text-sm text-slate-600">
		Internal-only operator surfaces. Every page here is gated by
		<code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs">profiles.is_platform_admin</code>.
	</p>
</header>

<ul class="grid gap-4 sm:grid-cols-2">
	<li class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
		<a href={resolve('/admin/webhooks')} class="block">
			<h2 class="text-base font-semibold text-slate-900">Webhook health</h2>
			<p class="mt-1 text-sm text-slate-600">
				Backlog of unprocessed Stripe webhook events with the per-type breakdown.
			</p>
		</a>
	</li>
</ul>
