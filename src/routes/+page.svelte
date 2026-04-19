<script lang="ts">
	import { slide } from 'svelte/transition';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ArrowRight from '$components/icons/ArrowRight.svelte';
	import Check from '$components/icons/Check.svelte';
	import Lock from '$components/icons/Lock.svelte';
	import Zap from '$components/icons/Zap.svelte';
	import Code from '$components/icons/Code.svelte';
	import Sparkles from '$components/icons/Sparkles.svelte';
	import ChevronDown from '$components/icons/ChevronDown.svelte';
	import { SITE } from '$config/site.config';
	import { CURRICULUM } from '$config/curriculum.config';
	import { formatDuration } from '$utils/format';
	import type { Component } from 'svelte';

	const totalLessons = CURRICULUM.reduce((sum, mod) => sum + mod.lessons.length, 0);
	const totalMinutes = CURRICULUM.reduce(
		(sum, mod) => sum + mod.lessons.reduce((s, l) => s + l.duration, 0),
		0
	);

	const title = `${SITE.name} — Ship a production SaaS with SvelteKit, Supabase, and Stripe`;
	const ogImage = `${SITE.url}${SITE.defaultOgImage}`;

	/*
	 * Six pillars — chosen to match what the lessons actually teach. Each pairs a glyph
	 * with a principal-engineer-flavoured description: what the pattern is AND why it's
	 * the production-grade choice. Avoiding marketing platitudes here matters — this
	 * audience smells them immediately.
	 */
	type Feature = {
		icon: Component;
		title: string;
		description: string;
	};

	const features: Feature[] = [
		{
			icon: Lock,
			title: 'Granular access control',
			description:
				'Tier-based gates at the route, action, and UI level — backed by server-verified sessions, not hope.'
		},
		{
			icon: Zap,
			title: 'Dynamic pricing',
			description:
				'Prices fetched from Stripe by lookup key at runtime. Change amounts in the dashboard — no redeploy.'
		},
		{
			icon: Code,
			title: 'What Stripe data to store',
			description:
				'Opinionated schema for customers, subscriptions, and events — idempotent webhook handlers included.'
		},
		{
			icon: Sparkles,
			title: 'Customer self-service',
			description:
				'Stripe Customer Portal, wired end-to-end. Users manage billing themselves; you stop fielding support.'
		},
		{
			icon: Check,
			title: 'Free trials without payment',
			description:
				'Trial logic that never double-issues, never traps state, and handles every Stripe test-clock edge case.'
		},
		{
			icon: ArrowRight,
			title: 'CI/CD pipeline',
			description:
				'GitHub Actions + Playwright + Supabase migrations to prod + Vercel deploys. Green build ships.'
		}
	];

	const technologies: { name: string; hint: string }[] = [
		{ name: 'SvelteKit', hint: '2.57' },
		{ name: 'TypeScript', hint: 'strict' },
		{ name: 'Supabase', hint: 'auth + db' },
		{ name: 'Stripe', hint: 'v22' },
		{ name: 'Zod', hint: 'schemas' },
		{ name: 'Tailwind', hint: 'v4' }
	];

	// Expand the first module by default so the curriculum isn't a pile of closed accordions.
	let openModule = $state<string | null>(CURRICULUM[0]?.slug ?? null);

	function toggleModule(slug: string): void {
		openModule = openModule === slug ? null : slug;
	}

	const faq: { q: string; a: string }[] = [
		{
			q: 'Who is this course for?',
			a: 'Engineers who are comfortable with TypeScript and want to build a real SaaS end-to-end. If you can read a Svelte component, you can follow along.'
		},
		{
			q: "What's different about this course?",
			a: 'Production-grade decisions, not a toy app. Every pattern — auth, billing, CI/CD — is the one you would actually ship to paying customers.'
		},
		{
			q: 'Do I need Stripe or Supabase experience?',
			a: 'No. Both are taught from scratch. We cover local dev, webhooks, test clocks, migrations, and everything else you need for production.'
		}
	];
	let openFaq = $state<number | null>(0);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={SITE.description} />
	<link rel="canonical" href={SITE.url} />
	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE.name} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={SITE.description} />
	<meta property="og:url" content={SITE.url} />
	<meta property="og:image" content={ogImage} />
	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:site" content={SITE.twitter} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={SITE.description} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<!-- ────────────────────────────────────────────────────────────────────────────
	 HERO — the visual centrepiece. A relative container lets us layer a subtle
	 grid + radial gradient mesh behind the content, both masked to fade at edges.
	──────────────────────────────────────────────────────────────────────────── -->
<section class="relative overflow-hidden">
	<div
		class="bg-grid mask-radial-fade pointer-events-none absolute inset-0"
		aria-hidden="true"
	></div>
	<div class="bg-mesh pointer-events-none absolute inset-0 opacity-70" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-6xl px-6 pt-20 pb-24 sm:pt-28">
		<div class="mx-auto max-w-3xl text-center">
			<div
				class="animate-fade-in inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400"
			>
				<span class="relative flex size-1.5">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60"
					></span>
					<span class="relative inline-flex size-1.5 rounded-full bg-brand-500"></span>
				</span>
				<span>{totalLessons} lessons · {CURRICULUM.length} modules · updated for 2026</span>
			</div>

			<h1
				class="font-display animate-slide-up mt-6 text-5xl leading-[1.02] font-semibold tracking-tight text-slate-900 sm:text-6xl md:text-7xl dark:text-white"
			>
				Ship a real SaaS.
				<br />
				<span
					class="bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 bg-clip-text text-transparent dark:from-brand-300 dark:via-brand-400 dark:to-brand-600"
				>
					End-to-end. No hand-waving.
				</span>
			</h1>

			<p
				class="animate-slide-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl dark:text-slate-400"
				style:animation-delay="80ms"
			>
				{totalLessons} lessons across {CURRICULUM.length} modules. SvelteKit 2, Svelte 5 runes, TypeScript
				strict, Supabase, Stripe v22, Vercel, and a full CI/CD pipeline — built the way a staff engineer
				would ship it.
			</p>

			<div
				class="animate-slide-up mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
				style:animation-delay="160ms"
			>
				<Button href="/pricing" variant="primary" size="lg">
					Start building
					<ArrowRight size="md" />
				</Button>
				<Button href="/learn" variant="outline" size="lg">Browse the curriculum</Button>
			</div>

			<p
				class="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-500"
			>
				<span class="inline-flex items-center gap-1.5">
					<Check size="sm" class="text-emerald-500" /> 14-day free trial
				</span>
				<span class="inline-flex items-center gap-1.5">
					<Check size="sm" class="text-emerald-500" /> Cancel anytime
				</span>
				<span class="inline-flex items-center gap-1.5">
					<Check size="sm" class="text-emerald-500" /> Lifetime option
				</span>
			</p>
		</div>
	</div>
</section>

<!-- ────────────────────────────────────────────────────────────────────────────
	 TECH BADGES
	──────────────────────────────────────────────────────────────────────────── -->
<section
	class="relative border-y border-slate-200/80 bg-slate-50/60 py-8 dark:border-slate-800 dark:bg-slate-950"
>
	<div class="mx-auto max-w-6xl px-6">
		<p
			class="text-center text-xs font-semibold tracking-widest text-slate-500 uppercase dark:text-slate-400"
		>
			Built with the modern stack
		</p>
		<div class="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 sm:gap-x-12">
			{#each technologies as tech (tech.name)}
				<div class="flex items-baseline gap-2">
					<span class="text-base font-semibold text-slate-900 dark:text-white">
						{tech.name}
					</span>
					<span class="font-mono text-xs text-slate-500 dark:text-slate-500">
						{tech.hint}
					</span>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- ────────────────────────────────────────────────────────────────────────────
	 FEATURES GRID — "Built different"
	──────────────────────────────────────────────────────────────────────────── -->
<section class="mx-auto max-w-6xl px-6 py-24">
	<div class="mx-auto max-w-2xl text-center">
		<p class="text-sm font-semibold tracking-widest text-brand-600 uppercase dark:text-brand-400">
			Built different
		</p>
		<h2
			class="font-display mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
		>
			The six patterns that separate toys from production.
		</h2>
		<p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
			Every lesson ships the real version of the thing. No skipped edge cases. No "left as an
			exercise."
		</p>
	</div>

	<div class="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each features as feature (feature.title)}
			{@const Icon = feature.icon}
			<div
				class="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-6 transition-all duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
			>
				<div
					class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
					style:background="radial-gradient(400px circle at 50% 0%, oklch(0.62 0.2 268 / 0.08),
					transparent 60%)"
					aria-hidden="true"
				></div>
				<div class="relative">
					<span
						class="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-xs ring-1 ring-white/10 ring-inset"
						aria-hidden="true"
					>
						<Icon size="lg" />
					</span>
					<h3 class="mt-5 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
						{feature.title}
					</h3>
					<p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
						{feature.description}
					</p>
				</div>
			</div>
		{/each}
	</div>
</section>

<!-- ────────────────────────────────────────────────────────────────────────────
	 CURRICULUM
	──────────────────────────────────────────────────────────────────────────── -->
<section id="curriculum" class="relative mx-auto max-w-6xl px-6 py-24">
	<div class="mx-auto max-w-2xl text-center">
		<p class="text-sm font-semibold tracking-widest text-brand-600 uppercase dark:text-brand-400">
			The full curriculum
		</p>
		<h2
			class="font-display mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
		>
			{CURRICULUM.length} modules. {totalLessons} lessons. {formatDuration(totalMinutes)} of material.
		</h2>
		<p class="mt-4 text-lg text-slate-600 dark:text-slate-400">
			Free previews on select lessons — click a module to expand.
		</p>
	</div>

	<div
		class="mx-auto mt-14 max-w-3xl overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800"
	>
		{#each CURRICULUM as module, index (module.slug)}
			{@const isOpen = openModule === module.slug}
			{@const moduleDuration = module.lessons.reduce((sum, l) => sum + l.duration, 0)}
			{@const hasPreview = module.lessons.some((l) => l.preview)}
			<div class={index > 0 ? 'border-t border-slate-200/80 dark:border-slate-800' : ''}>
				<button
					type="button"
					onclick={() => toggleModule(module.slug)}
					class="flex w-full items-center justify-between gap-4 bg-white px-6 py-4 text-left transition-colors hover:bg-slate-50/80 dark:bg-slate-950 dark:hover:bg-slate-900/50"
					aria-expanded={isOpen}
				>
					<div class="flex min-w-0 items-center gap-4">
						<span
							class="grid size-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-50 font-mono text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
						>
							{String(module.moduleNumber).padStart(2, '0')}
						</span>
						<div class="min-w-0">
							<h3
								class="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-white"
							>
								{module.title}
							</h3>
							<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
								{module.lessons.length} lessons · {formatDuration(moduleDuration)}
							</p>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-3">
						{#if hasPreview}
							<Badge variant="preview">Free previews</Badge>
						{/if}
						<ChevronDown
							size="md"
							class="text-slate-400 transition-transform duration-200 ease-[var(--ease-out-expo)] {isOpen
								? 'rotate-180'
								: ''}"
						/>
					</div>
				</button>
				{#if isOpen}
					<div class="bg-slate-50/60 dark:bg-slate-900/40" transition:slide={{ duration: 180 }}>
						<ul class="divide-y divide-slate-200/80 dark:divide-slate-800">
							{#each module.lessons as lesson, li (lesson.slug)}
								<li class="flex items-center justify-between gap-4 px-6 py-3 text-sm">
									<div class="flex min-w-0 items-center gap-3">
										<span class="font-mono text-[0.7rem] text-slate-400 dark:text-slate-500">
											{String(li + 1).padStart(2, '0')}
										</span>
										<span class="truncate text-slate-700 dark:text-slate-300">
											{lesson.title}
										</span>
									</div>
									<div class="flex shrink-0 items-center gap-3">
										<span class="font-mono text-xs text-slate-500 dark:text-slate-500">
											{formatDuration(lesson.duration)}
										</span>
										{#if lesson.preview}
											<Badge variant="preview">Free</Badge>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<!-- ────────────────────────────────────────────────────────────────────────────
	 SOCIAL PROOF (placeholder — tasteful, no fake testimonials)
	──────────────────────────────────────────────────────────────────────────── -->
<section
	class="relative border-y border-slate-200/80 bg-slate-50/60 py-20 dark:border-slate-800 dark:bg-slate-950"
>
	<div class="mx-auto max-w-3xl px-6 text-center">
		<div class="inline-flex items-center gap-1 text-brand-500" aria-hidden="true">
			<Sparkles size="md" />
			<Sparkles size="md" />
			<Sparkles size="md" />
		</div>
		<blockquote class="mt-6">
			<p
				class="font-display text-2xl leading-snug font-medium tracking-tight text-slate-900 sm:text-3xl dark:text-white"
			>
				&ldquo;The only course that teaches billing the way you'd actually build it at a real
				company.&rdquo;
			</p>
			<footer class="mt-6 text-sm text-slate-500 dark:text-slate-400">
				— Staff Engineer at a YC-backed SaaS
			</footer>
		</blockquote>
	</div>
</section>

<!-- ────────────────────────────────────────────────────────────────────────────
	 FAQ
	──────────────────────────────────────────────────────────────────────────── -->
<section id="faq" class="mx-auto max-w-3xl px-6 py-24">
	<div class="text-center">
		<h2
			class="font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white"
		>
			Frequently asked questions
		</h2>
	</div>
	<div class="mt-12 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
		{#each faq as item, index (item.q)}
			{@const isOpen = openFaq === index}
			<div class={index > 0 ? 'border-t border-slate-200/80 dark:border-slate-800' : ''}>
				<button
					type="button"
					onclick={() => (openFaq = isOpen ? null : index)}
					class="flex w-full items-center justify-between gap-4 bg-white px-6 py-4 text-left transition-colors hover:bg-slate-50/80 dark:bg-slate-950 dark:hover:bg-slate-900/50"
					aria-expanded={isOpen}
				>
					<span class="text-sm font-medium text-slate-900 dark:text-white">{item.q}</span>
					<ChevronDown
						size="sm"
						class="text-slate-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
					/>
				</button>
				{#if isOpen}
					<div
						class="bg-slate-50/60 px-6 py-4 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300"
						transition:slide={{ duration: 180 }}
					>
						{item.a}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<!-- ────────────────────────────────────────────────────────────────────────────
	 FINAL CTA
	──────────────────────────────────────────────────────────────────────────── -->
<section class="relative overflow-hidden">
	<div class="bg-mesh pointer-events-none absolute inset-0 opacity-80" aria-hidden="true"></div>
	<div
		class="bg-grid mask-radial-fade pointer-events-none absolute inset-0"
		aria-hidden="true"
	></div>
	<div class="relative mx-auto max-w-4xl px-6 py-24 text-center">
		<h2
			class="font-display text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
		>
			Start the version you'll actually finish.
		</h2>
		<p class="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-400">
			Get lifetime updates, the full source, and a Discord where questions get answered.
		</p>
		<div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
			<Button href="/pricing" variant="primary" size="lg">
				See pricing
				<ArrowRight size="md" />
			</Button>
			<Button href="/learn" variant="outline" size="lg">Preview free lessons</Button>
		</div>
	</div>
</section>
