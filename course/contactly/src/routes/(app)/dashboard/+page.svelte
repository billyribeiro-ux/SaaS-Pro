<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Dashboard — Contactly</title>
</svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
		<p class="mt-2 text-sm text-slate-600" data-testid="dashboard-greeting">
			Signed in as <span class="font-medium text-slate-900">{data.user.email}</span>.
		</p>
	</header>

	<!--
		The real dashboard (contact list, activity feed, billing tile)
		lands progressively across Modules 4–6. For now this is the
		"you successfully signed in" landing — the simplest possible
		thing that proves the auth round-trip works end to end.
	-->
	<div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
		<h2 class="text-lg font-semibold text-slate-900">You're in.</h2>
		<p class="mt-2 text-sm text-slate-600">
			This is your private dashboard. The real one lands lesson-by-lesson — contacts in Module 4,
			billing in Module 5.
		</p>
	</div>
</div>
