<script lang="ts">
	/**
	 * Billing history page.
	 *
	 * Read-only: every action that needs to *change* billing state
	 * (cancel, change plan, update card) routes through the
	 * Customer Portal via `ManageBillingForm`. We surface a portal
	 * link at the top of the page so the user is never more than
	 * one click away.
	 */
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import type { BillingHistoryRow } from './+page.server';
	import Button from '$lib/components/ui/Button.svelte';
	import ManageBillingForm from '$lib/components/billing/ManageBillingForm.svelte';

	let { data }: PageProps = $props();

	const dateFormatter = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
	function fmtDate(iso: string | null): string {
		if (!iso) return '—';
		return dateFormatter.format(new Date(iso));
	}

	function periodFor(row: BillingHistoryRow): string {
		if (!row.periodStartIso || !row.periodEndIso) return '—';
		return `${fmtDate(row.periodStartIso)} – ${fmtDate(row.periodEndIso)}`;
	}

	const STATUS_TONE: Record<BillingHistoryRow['status'], string> = {
		paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		open: 'bg-amber-50 text-amber-800 ring-amber-200',
		uncollectible: 'bg-red-50 text-red-700 ring-red-200',
		void: 'bg-slate-100 text-slate-600 ring-slate-200',
		draft: 'bg-slate-100 text-slate-500 ring-slate-200'
	};
</script>

<svelte:head>
	<title>Billing history — Contactly</title>
</svelte:head>

<div class="space-y-8" data-testid="billing-history">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight text-slate-900">Billing history</h1>
			<p class="mt-2 text-sm text-slate-600">
				Receipts and PDF invoices from every charge. To change plan, update your card, or cancel,
				use the billing portal.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button href={resolve('/account')} variant="ghost">Back to account</Button>
			{#if data.entitlements.isPaid}
				<ManageBillingForm testid="billing-history-portal-cta" returnPath="/account/billing" />
			{/if}
		</div>
	</header>

	{#if data.loadError}
		<div
			class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
			role="status"
			data-testid="billing-history-load-error"
		>
			We couldn't load your invoice history right now. Your charges are unaffected — try again in a
			moment, or open the
			<span class="font-semibold">billing portal</span> for a live view.
		</div>
	{:else if data.rows.length === 0}
		<div
			class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600 shadow-sm"
			data-testid="billing-history-empty"
		>
			<p class="font-medium text-slate-900">No invoices yet</p>
			<p class="mt-1">
				When your subscription generates an invoice — usually on the day after a trial ends — it
				will appear here.
			</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
			<table class="min-w-full divide-y divide-slate-200" data-testid="billing-history-table">
				<thead class="bg-slate-50">
					<tr>
						<th
							scope="col"
							class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
							>Date</th
						>
						<th
							scope="col"
							class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
							>Invoice</th
						>
						<th
							scope="col"
							class="hidden px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase sm:table-cell"
							>Period</th
						>
						<th
							scope="col"
							class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase"
							>Total</th
						>
						<th
							scope="col"
							class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
							>Status</th
						>
						<th
							scope="col"
							class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase"
						>
							<span class="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200 bg-white" data-testid="billing-history-rows">
					{#each data.rows as row (row.id)}
						<tr data-testid="billing-history-row">
							<td class="px-4 py-3 text-sm whitespace-nowrap text-slate-700">
								{fmtDate(row.createdIso)}
							</td>
							<td class="px-4 py-3 text-sm font-medium whitespace-nowrap text-slate-900">
								{row.number ?? row.id}
							</td>
							<td class="hidden px-4 py-3 text-sm whitespace-nowrap text-slate-600 sm:table-cell">
								{periodFor(row)}
							</td>
							<td class="px-4 py-3 text-right text-sm font-semibold text-slate-900">
								{row.totalDisplay}
							</td>
							<td class="px-4 py-3">
								<span
									class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[row.status]}`}
									data-testid="billing-history-status-{row.status}"
								>
									{row.statusLabel}
								</span>
							</td>
							<td class="px-4 py-3 text-right text-sm whitespace-nowrap">
								{#if row.hostedInvoiceUrl}
									<a
										href={row.hostedInvoiceUrl}
										target="_blank"
										rel="external noopener noreferrer"
										class="text-brand-700 hover:text-brand-900 underline"
										data-testid="billing-history-view"
									>
										View
									</a>
								{/if}
								{#if row.invoicePdf}
									<span class="mx-1 text-slate-300" aria-hidden="true">|</span>
									<a
										href={row.invoicePdf}
										target="_blank"
										rel="external noopener noreferrer"
										class="text-brand-700 hover:text-brand-900 underline"
										data-testid="billing-history-pdf"
									>
										PDF
									</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
