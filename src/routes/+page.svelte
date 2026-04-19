<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import { SITE } from '$config/site.config';
	import { CURRICULUM } from '$config/curriculum.config';

	const totalLessons = CURRICULUM.reduce((sum, mod) => sum + mod.lessons.length, 0);
</script>

<svelte:head>
	<title>{SITE.name} — Ship a production SaaS with SvelteKit, Supabase, and Stripe</title>
	<meta name="description" content={SITE.description} />
</svelte:head>

<section class="mx-auto max-w-4xl px-6 py-20 text-center">
	<h1 class="text-5xl font-bold tracking-tight sm:text-6xl">
		Ship a real SaaS.
		<br />
		End-to-end. No hand-waving.
	</h1>
	<p class="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
		{totalLessons} lessons across {CURRICULUM.length} modules. SvelteKit 2, Svelte 5 runes, TypeScript strict,
		Supabase, Stripe v22, Vercel, and a full CI/CD pipeline — as a production-grade engineer would build it.
	</p>
	<div class="mt-10 flex justify-center gap-4">
		<Button href="/pricing" variant="primary" size="lg">
			{#snippet children()}See pricing{/snippet}
		</Button>
		<Button href="/learn" variant="outline" size="lg">
			{#snippet children()}Browse curriculum{/snippet}
		</Button>
	</div>
</section>

<section class="mx-auto max-w-6xl px-6 py-12">
	<h2 class="text-2xl font-semibold">What you'll build</h2>
	<div class="mt-6 grid gap-6 md:grid-cols-3">
		<div class="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
			<h3 class="text-lg font-medium">Auth & access control</h3>
			<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
				Email/password auth, email confirmations, tier-based gates, protected routes, server-verified sessions.
			</p>
		</div>
		<div class="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
			<h3 class="text-lg font-medium">Stripe billing</h3>
			<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
				Dynamic pricing via lookup keys, Checkout sessions, Customer Portal, webhook-driven sync, trial handling.
			</p>
		</div>
		<div class="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
			<h3 class="text-lg font-medium">CI/CD & production</h3>
			<p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
				GitHub Actions, Playwright e2e, Supabase migrations to prod, Vercel deploys, observability.
			</p>
		</div>
	</div>
</section>
