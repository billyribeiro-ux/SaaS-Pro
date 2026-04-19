<script lang="ts">
	const milestones = [
		{ module: 'Module 1', label: 'Project setup & Supabase foundations' },
		{ module: 'Module 3', label: 'Email + password + magic-link auth' },
		{ module: 'Module 4', label: 'Multi-tenant orgs with RLS-enforced isolation' },
		{ module: 'Module 9', label: 'Stripe Checkout, billing portal, free trials' },
		{ module: 'Module 12', label: 'CI/CD with GitHub Actions to Vercel + Supabase prod' }
	];
</script>

<svelte:head>
	<title>Contactly — built lesson by lesson</title>
	<meta
		name="description"
		content="Contactly is the multi-tenant SaaS you build through the SaaS-Pro course."
	/>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
	<p class="text-brand-600 text-sm font-semibold tracking-widest uppercase">SaaS-Pro</p>
	<h1 class="mt-3 text-5xl font-bold tracking-tight text-slate-900">Welcome to Contactly.</h1>
	<p class="mt-5 text-lg leading-relaxed text-slate-600">
		This is the very first commit of the project you're going to build, end to end, with SvelteKit,
		Supabase, and Stripe. By the time you finish the course, this homepage will be a real product.
	</p>

	<section class="mt-12">
		<h2 class="text-sm font-semibold tracking-wider text-slate-500 uppercase">What lands when</h2>
		<ol class="mt-4 space-y-3">
			{#each milestones as milestone (milestone.module)}
				<li class="flex gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
					<span
						class="text-brand-700 inline-flex h-7 w-20 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold ring-1 ring-slate-200 ring-inset"
					>
						{milestone.module}
					</span>
					<span class="text-sm text-slate-700">{milestone.label}</span>
				</li>
			{/each}
		</ol>
	</section>

	<footer class="mt-16 text-xs text-slate-400">
		Lesson 1.1 — SvelteKit project setup. Tag: <code
			class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
			>course/lesson-01-01-sveltekit-setup</code
		>
	</footer>
</main>
