<script lang="ts" module>
	import type { EntitlementSnapshot } from '$lib/server/billing/entitlements';
	export type PlanSectionProps = { entitlements: EntitlementSnapshot };
</script>

<script lang="ts">
	/**
	 * /account → "Plan" section.
	 *
	 * Mirrors the visual surface of the other sections on /account
	 * (white card, slate border, h2 + body) so this addition reads as
	 * native to the page rather than bolted on. Renders the snapshot
	 * loaded by `(app)/+layout.server.ts` (Lesson 8.3) — there is NO
	 * extra database query here.
	 *
	 * Three slots in the card:
	 *
	 *   1. Header        — h2 + PlanBadge (the same component the
	 *                       AppNav uses, so the visual language is
	 *                       consistent across surfaces).
	 *   2. Detail dl     — "Status", "Renews on", "Trial ends",
	 *                       "Cancels on" — only the relevant rows
	 *                       render for the current state.
	 *   3. CTAs          — "Upgrade" → /pricing for Starter; for paid
	 *                       users a placeholder "Manage billing" that
	 *                       Lesson 9.3 will swap to the Stripe Billing
	 *                       Portal redirect.
	 *
	 * Date formatting uses Intl.DateTimeFormat with a locked
	 * 'en-US' locale, same reasoning as `formatCurrency` in
	 * `catalog.ts`: SSR + browser must agree, otherwise hydration
	 * mismatches.
	 */
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import PlanBadge from '$lib/components/billing/PlanBadge.svelte';
	import ManageBillingForm from '$lib/components/billing/ManageBillingForm.svelte';

	let { entitlements }: PlanSectionProps = $props();

	// Singleton formatter so we don't re-allocate on every render.
	// `dateStyle: 'long'` → "April 19, 2026" — readable, locale-stable
	// because we lock to en-US.
	const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' });

	function fmtDate(iso: string | null): string | null {
		if (!iso) return null;
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		return dateFormatter.format(d);
	}

	const renewsOn = $derived(fmtDate(entitlements.currentPeriodEnd));
	const trialEnds = $derived(fmtDate(entitlements.trialEnd));
	const cancelsOn = $derived(
		entitlements.cancelAtPeriodEnd ? fmtDate(entitlements.currentPeriodEnd) : null
	);

	const statusLabel = $derived(statusLabelFor(entitlements));

	function statusLabelFor(snap: typeof entitlements): string {
		if (!snap.isPaid) return 'Free';
		if (snap.cancelAtPeriodEnd) return 'Cancellation pending';
		switch (snap.status) {
			case 'trialing':
				return 'On trial';
			case 'active':
				return 'Active';
			case 'past_due':
				return 'Payment past due';
			case 'paused':
				return 'Paused';
			case 'incomplete':
				return 'Incomplete';
			case 'unpaid':
				return 'Unpaid';
			default:
				return 'Inactive';
		}
	}

	const trialDaysLeft = $derived(daysUntil(entitlements.trialEnd));

	function daysUntil(iso: string | null): number | null {
		if (!iso) return null;
		const ms = new Date(iso).getTime() - Date.now();
		if (Number.isNaN(ms)) return null;
		return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
	}
</script>

<section
	class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
	aria-labelledby="plan-heading"
	data-testid="account-plan-section"
>
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 id="plan-heading" class="text-lg font-semibold text-slate-900">Plan</h2>
			<p class="mt-1 text-sm text-slate-600">Your current Contactly subscription.</p>
		</div>
		<PlanBadge {entitlements} size="md" />
	</header>

	{#if entitlements.cancelAtPeriodEnd}
		<div
			class="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
			role="status"
			data-testid="plan-cancel-notice"
		>
			Your subscription is set to cancel{cancelsOn ? ` on ${cancelsOn}` : ''}. You'll keep access
			until then.
		</div>
	{:else if entitlements.badgeTone === 'past_due'}
		<div
			class="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
			role="alert"
			data-testid="plan-past-due-notice"
		>
			Your last payment didn't go through. Update your payment method to keep your plan.
		</div>
	{:else if entitlements.isTrialing && trialDaysLeft !== null}
		<div
			class="border-brand-200 bg-brand-50 text-brand-900 mt-4 rounded-md border px-3 py-2 text-sm"
			role="status"
			data-testid="plan-trial-notice"
		>
			You're on a free trial — {trialDaysLeft}
			day{trialDaysLeft === 1 ? '' : 's'} left{trialEnds ? ` (ends ${trialEnds})` : ''}.
		</div>
	{/if}

	<dl class="mt-4 divide-y divide-slate-200" data-testid="plan-details">
		<div class="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
			<dt class="text-sm font-medium text-slate-500">Status</dt>
			<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="plan-status">
				{statusLabel}
			</dd>
		</div>
		{#if entitlements.isPaid && renewsOn}
			<div class="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">
					{entitlements.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}
				</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="plan-renews-on">
					{renewsOn}
				</dd>
			</div>
		{/if}
	</dl>

	<div class="mt-6 flex flex-wrap gap-3">
		{#if entitlements.tier === 'starter'}
			<!--
				Starter has no Stripe customer (lazy-created on first
				checkout, ADR-002), so opening the Portal would land
				on an empty page. Send them to /pricing to choose a
				plan instead.
			-->
			<Button href={resolve('/pricing')} variant="primary" data-testid="plan-upgrade-cta">
				Upgrade
			</Button>
		{:else if entitlements.tier === 'pro'}
			<Button href={resolve('/pricing')} variant="primary" data-testid="plan-upgrade-cta">
				Upgrade to Business
			</Button>
			<ManageBillingForm testid="plan-manage-billing-cta" />
		{:else}
			<!-- Business is the top tier; the only billing action is "Manage". -->
			<ManageBillingForm variant="primary" testid="plan-manage-billing-cta" />
		{/if}
	</div>
</section>
