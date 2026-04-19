<script lang="ts">
	/**
	 * Post-checkout success page.
	 *
	 * The view-model is built server-side from the Stripe Checkout
	 * Session object (NOT the local mirror — see `+page.server.ts`
	 * for the webhook-race rationale). The page itself is purely
	 * presentational.
	 */
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import Button from '$lib/components/ui/Button.svelte';

	let { data }: PageProps = $props();
	const view = $derived(data.view);

	/**
	 * Format an ISO timestamp using a locale-stable formatter
	 * (mirrors the convention from `PlanSection.svelte` and
	 * `catalog.ts`). We pin the locale so the SSR + CSR render
	 * agree byte-for-byte regardless of the user's Accept-Language.
	 */
	const dateFormatter = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		return dateFormatter.format(new Date(iso));
	}

	const isTrial = $derived(Boolean(view.trialEndIso));
	const trialEndPretty = $derived(fmtDate(view.trialEndIso));
	const nextChargePretty = $derived(fmtDate(view.nextChargeIso));
</script>

<svelte:head>
	<title>Welcome to Contactly {view.tierLabel} — Contactly</title>
	<!--
		`noindex` because this URL contains a session id that should
		never appear in search results. The link only ever opens
		from a Stripe redirect for the user who paid.
	-->
	<meta name="robots" content="noindex" />
</svelte:head>

<main
	class="mx-auto max-w-2xl px-6 py-16"
	aria-labelledby="success-heading"
	data-testid="checkout-success"
>
	<div
		class="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center shadow-sm"
		role="status"
	>
		<p class="text-xs font-semibold tracking-widest text-emerald-700 uppercase">
			{isTrial ? 'Trial started' : 'Payment received'}
		</p>
		<h1 id="success-heading" class="mt-2 text-3xl font-bold tracking-tight text-emerald-950">
			Welcome to Contactly {view.tierLabel}
		</h1>
		<p class="mt-3 text-sm text-emerald-900">
			{#if isTrial}
				Your free trial is active until <span class="font-semibold">{trialEndPretty}</span>. We
				won't charge your card until then — and we'll email you 3 days before.
			{:else if view.priceHeadline && nextChargePretty}
				You were charged <span class="font-semibold">{view.priceHeadline}</span>. Your next renewal
				is on <span class="font-semibold">{nextChargePretty}</span>.
			{:else}
				Your subscription is active. You're all set.
			{/if}
		</p>
	</div>

	<dl
		class="mt-8 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
		data-testid="checkout-success-summary"
	>
		<div class="grid grid-cols-1 gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
			<dt class="text-sm font-medium text-slate-500">Plan</dt>
			<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="success-plan">
				Contactly {view.tierLabel}
				<span class="text-slate-500">· {view.interval}</span>
			</dd>
		</div>
		{#if view.priceHeadline}
			<div class="grid grid-cols-1 gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Price</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="success-price">
					{view.priceHeadline}
				</dd>
			</div>
		{/if}
		{#if isTrial}
			<div class="grid grid-cols-1 gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Trial ends</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="success-trial-end">
					{trialEndPretty}
				</dd>
			</div>
		{/if}
		{#if nextChargePretty}
			<div class="grid grid-cols-1 gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">
					{isTrial ? 'First charge' : 'Next charge'}
				</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="success-next-charge">
					{nextChargePretty}
				</dd>
			</div>
		{/if}
		{#if view.cardLast4}
			<div class="grid grid-cols-1 gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Payment method</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="success-card">
					Card ending in {view.cardLast4}
				</dd>
			</div>
		{/if}
		{#if view.customerEmail}
			<div class="grid grid-cols-1 gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Receipt sent to</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="success-email">
					{view.customerEmail}
				</dd>
			</div>
		{/if}
	</dl>

	<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
		<Button href={resolve('/dashboard')} variant="primary" data-testid="success-go-dashboard">
			Go to dashboard
		</Button>
		<Button href={resolve('/account')} variant="secondary" data-testid="success-go-account">
			Manage billing
		</Button>
	</div>

	<p class="mt-6 text-center text-xs text-slate-500">
		Questions about your invoice? <a
			class="text-brand-700 underline"
			href="mailto:billing@contactly.app">Email billing@contactly.app</a
		>.
	</p>
</main>
