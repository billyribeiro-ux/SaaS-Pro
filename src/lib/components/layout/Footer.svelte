<script lang="ts">
	import { SITE } from '$config/site.config';
	import Sparkles from '$components/icons/Sparkles.svelte';

	const year = new Date().getFullYear();

	/*
	 * Columns are declared once so adding a section doesn't require touching markup.
	 * External links carry `external: true` so we can add an ExternalLink indicator
	 * if we ever want to — kept simple for now to hit the minimum polish bar.
	 */
	type FooterLink = { href: string; label: string; external?: boolean };
	type FooterColumn = { heading: string; links: FooterLink[] };

	const columns: FooterColumn[] = [
		{
			heading: 'Course',
			links: [
				{ href: '/learn', label: 'Curriculum' },
				{ href: '/pricing', label: 'Pricing' },
				{ href: '/#faq', label: 'FAQ' }
			]
		},
		{
			heading: 'Resources',
			links: [
				{ href: 'https://svelte.dev', label: 'SvelteKit docs', external: true },
				{ href: 'https://supabase.com/docs', label: 'Supabase docs', external: true },
				{ href: 'https://stripe.com/docs', label: 'Stripe docs', external: true }
			]
		},
		{
			heading: 'Community',
			links: [
				{ href: 'https://discord.gg', label: 'Discord', external: true },
				{ href: 'https://twitter.com', label: 'Twitter / X', external: true },
				{ href: 'https://github.com', label: 'GitHub', external: true }
			]
		}
	];
</script>

<footer
	class="border-t border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950"
>
	<div class="mx-auto max-w-6xl px-6 py-12">
		<div class="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
			<div>
				<a href="/" class="flex items-center gap-2 text-sm font-semibold tracking-tight">
					<span
						class="grid size-7 place-items-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm ring-1 ring-inset ring-white/10"
						aria-hidden="true"
					>
						<Sparkles size="sm" class="text-white" />
					</span>
					<span>{SITE.name}</span>
				</a>
				<p class="mt-3 max-w-sm text-sm text-slate-600 dark:text-slate-400">
					{SITE.description}
				</p>
			</div>
			{#each columns as column (column.heading)}
				<div>
					<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
						{column.heading}
					</h3>
					<ul class="mt-4 space-y-2.5 text-sm">
						{#each column.links as link (link.href)}
							<li>
								<a
									href={link.href}
									target={link.external ? '_blank' : undefined}
									rel={link.external ? 'noreferrer noopener' : undefined}
									class="text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
								>
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>

		<div class="mt-12 flex flex-col items-start justify-between gap-4 border-t border-slate-200/80 pt-6 text-xs text-slate-500 md:flex-row md:items-center dark:border-slate-800">
			<p>&copy; {year} {SITE.name}. All rights reserved.</p>
			<p class="font-mono">
				Built with SvelteKit, Supabase &amp; Stripe.
			</p>
		</div>
	</div>
</footer>
