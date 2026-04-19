<script lang="ts" module>
	import type { EntitlementSnapshot } from '$lib/server/billing/entitlements';

	export type PlanBadgeSize = 'sm' | 'md';
	export type PlanBadgeProps = {
		entitlements: EntitlementSnapshot;
		/** `sm` for the AppNav, `md` for the /account "Plan" card. */
		size?: PlanBadgeSize;
		/** Optional override; consumer may want to compose extra Tailwind. */
		class?: string;
	};
</script>

<script lang="ts">
	/**
	 * PlanBadge — the visual surface for `EntitlementSnapshot.{tier,
	 * badgeLabel, badgeTone}`.
	 *
	 * Renders a small pill with the user's current plan (Starter, Pro,
	 * Business) and a status suffix when relevant ("· Trial",
	 * "· Past due"). The colors are chosen so a glance at the badge
	 * tells the user three things at once:
	 *
	 *   1. **What plan they're on**       — the label.
	 *   2. **Whether it's healthy**       — green/brand fill = good,
	 *      amber = past_due (action required), outlined = trialing.
	 *   3. **Whether they should care**   — Starter is neutral grey
	 *      so it doesn't shout at users who are perfectly happy on
	 *      the free tier.
	 *
	 * The component is purely presentational; ALL the decisions about
	 * which tone to render live in `entitlements.ts`'s `snapshotFor`,
	 * so this file is what the design system shows in Storybook with
	 * synthetic snapshots and the entire entitlement story in one
	 * picture.
	 */
	import { cn } from '$lib/utils/cn';

	let { entitlements, size = 'sm', class: className }: PlanBadgeProps = $props();

	const sizeClasses: Record<PlanBadgeSize, string> = {
		sm: 'px-2 py-0.5 text-xs gap-1',
		md: 'px-3 py-1 text-sm gap-1.5'
	};

	const toneClasses = $derived(toneClassesFor(entitlements.badgeTone));

	function toneClassesFor(tone: typeof entitlements.badgeTone): string {
		switch (tone) {
			case 'starter':
				return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200';
			case 'paid':
				return 'bg-brand-100 text-brand-800 ring-1 ring-inset ring-brand-200';
			case 'trial':
				// Trial is "paid but conditional" — same hue as paid, but
				// outlined rather than filled to read as provisional.
				return 'bg-white text-brand-700 ring-1 ring-inset ring-brand-300';
			case 'past_due':
				return 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300';
		}
	}

	const suffix = $derived(suffixFor(entitlements));

	function suffixFor(snap: typeof entitlements): string | null {
		if (snap.tier === 'starter') return null;
		if (snap.badgeTone === 'past_due') return 'Past due';
		if (snap.badgeTone === 'trial') return 'Trial';
		return null;
	}
</script>

<span
	class={cn(
		'inline-flex items-center rounded-full font-semibold',
		sizeClasses[size],
		toneClasses,
		className
	)}
	data-testid="plan-badge"
	data-tier={entitlements.tier}
	data-tone={entitlements.badgeTone}
>
	{entitlements.badgeLabel}
	{#if suffix}
		<span class="opacity-70">·</span>
		<span>{suffix}</span>
	{/if}
</span>
