/**
 * Invoice mirror — local cache of `Stripe.Invoice` for the in-app
 * billing-history surface.
 *
 * SCOPE
 * -----
 * Five Stripe events all route through one upsert here:
 *
 *   - `invoice.finalized`            (status → open)
 *   - `invoice.paid`                 (status → paid)
 *   - `invoice.payment_failed`       (status often stays `open`,
 *                                     `attempt_count` advances)
 *   - `invoice.voided`               (status → void)
 *   - `invoice.marked_uncollectible` (status → uncollectible)
 *
 * All five carry the full `Stripe.Invoice` payload, so a single
 * `upsertInvoice(invoice)` is enough — the `status` field on the
 * payload tells us where the invoice landed.
 *
 * THE TABLE IS DISPLAY-ONLY
 * -------------------------
 * No entitlement decision in the app reads from `stripe_invoices`.
 * Subscription state (still source of truth for tier resolution) is
 * mirrored separately. This module is for the billing-history list,
 * the receipt links, and a future "your card was declined" notice.
 * Stripe is the boss for "is invoice X paid"; we only mirror the
 * public-facing view.
 *
 * PURE CORE / ASYNC SHELL
 * -----------------------
 *   - `buildInvoiceRow(invoice, userId)` is pure: no I/O, no clocks,
 *     no env reads. The unit tests exercise it directly so the
 *     mapping of Stripe → DB column doesn't need a Supabase mock.
 *   - `upsertInvoice(invoice)` does the I/O: customer→user lookup
 *     and the actual upsert.
 *
 * API VERSION 2026-03-25.dahlia
 * -----------------------------
 * `Invoice.subscription` (legacy) has moved to
 * `Invoice.parent.subscription_details.subscription`. The pure
 * mapper handles either shape, picking the new path first and
 * falling back to the deprecated one for older replays so a recorded
 * cassette test doesn't break the day Stripe drops the field
 * entirely.
 */
import type Stripe from 'stripe';
import type { Database } from '$lib/database.types';
import { withAdmin } from '$lib/server/supabase-admin';

type InvoiceInsert = Database['public']['Tables']['stripe_invoices']['Insert'];
export type InvoiceRow = Database['public']['Tables']['stripe_invoices']['Row'];
type InvoiceStatus = Database['public']['Enums']['stripe_invoice_status'];

/**
 * Mirrors the canonical `Stripe.Invoice.Status` enum exactly. Any
 * unknown value is logged + skipped in the async shell, never
 * silently coerced.
 */
const KNOWN_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
	'draft',
	'open',
	'paid',
	'uncollectible',
	'void'
]);

function asKnownStatus(status: string | null | undefined): InvoiceStatus | null {
	if (!status) return null;
	return (KNOWN_STATUSES as ReadonlySet<string>).has(status) ? (status as InvoiceStatus) : null;
}

/** Seconds-since-epoch → ISO-8601, or null. Same helper as elsewhere. */
function toIso(seconds: number | null | undefined): string | null {
	if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
	return new Date(seconds * 1000).toISOString();
}

/**
 * Sum the per-line `total_taxes[].amount`, returning null when the
 * payload has no tax lines (Stripe Tax disabled, exempt, etc.) so we
 * can preserve the "no tax info" semantics in the mirror.
 */
function totalTaxFor(invoice: Stripe.Invoice): number | null {
	const taxes = invoice.total_taxes ?? null;
	if (!taxes || taxes.length === 0) return null;
	return taxes.reduce((acc, t) => acc + (t.amount ?? 0), 0);
}

/**
 * Resolve the Stripe Subscription id behind this invoice.
 *
 * Modern API path: `parent.subscription_details.subscription`.
 * Legacy fallback: `(invoice as any).subscription` — kept for cassette
 * tests recorded under older API versions; this branch becomes dead
 * the day Stripe removes the field.
 *
 * Returns `null` for ad-hoc Dashboard invoices (no parent
 * subscription).
 */
function subscriptionIdFor(invoice: Stripe.Invoice): string | null {
	const fromParent = invoice.parent?.subscription_details?.subscription;
	if (typeof fromParent === 'string') return fromParent;
	if (fromParent && typeof fromParent === 'object' && 'id' in fromParent) {
		return fromParent.id;
	}

	// Legacy: cassettes recorded before 2025-09 expose `.subscription`
	// directly on the invoice. Type-cast through a narrowly-typed view
	// so we don't widen the call site to `any`.
	const legacy = (invoice as unknown as { subscription?: string | { id: string } | null })
		.subscription;
	if (typeof legacy === 'string') return legacy;
	if (legacy && typeof legacy === 'object' && 'id' in legacy) return legacy.id;

	return null;
}

/**
 * Pure mapper: `(Stripe.Invoice, userId)` → `stripe_invoices` row.
 *
 * Returns `null` when the status is unknown — caller logs + skips
 * (loud telemetry, no DB write that would later read back as garbage).
 */
export function buildInvoiceRow(invoice: Stripe.Invoice, userId: string): InvoiceInsert | null {
	const status = asKnownStatus(invoice.status);
	if (!status) {
		return null;
	}

	const customerId =
		typeof invoice.customer === 'string'
			? invoice.customer
			: invoice.customer && 'id' in invoice.customer
				? invoice.customer.id
				: null;

	if (!customerId) {
		return null;
	}

	return {
		id: invoice.id ?? '',
		user_id: userId,
		stripe_customer_id: customerId,
		subscription_id: subscriptionIdFor(invoice),
		status,
		currency: invoice.currency,
		amount_due: invoice.amount_due ?? 0,
		amount_paid: invoice.amount_paid ?? 0,
		amount_remaining: invoice.amount_remaining ?? 0,
		subtotal: invoice.subtotal ?? 0,
		total: invoice.total ?? 0,
		tax: totalTaxFor(invoice),
		number: invoice.number ?? null,
		hosted_invoice_url: invoice.hosted_invoice_url ?? null,
		invoice_pdf: invoice.invoice_pdf ?? null,
		period_start: toIso(invoice.period_start),
		period_end: toIso(invoice.period_end),
		created_at_stripe: toIso(invoice.created),
		paid_at: toIso(invoice.status_transitions?.paid_at)
	};
}

/**
 * Resolve a `cus_…` to its owning Contactly user via the customers
 * cache from Module 7.3. Returns `null` if no mapping exists.
 */
async function userIdForCustomer(stripeCustomerId: string): Promise<string | null> {
	const { data, error } = await withAdmin('billing.invoices.user-lookup', 'system', async (admin) =>
		admin
			.from('stripe_customers')
			.select('user_id')
			.eq('stripe_customer_id', stripeCustomerId)
			.maybeSingle()
	);
	if (error) {
		throw new Error(
			`[invoices] userIdForCustomer failed for ${stripeCustomerId}: ${error.message}`
		);
	}
	return data?.user_id ?? null;
}

/**
 * Insert-or-update an invoice row.
 *
 * Skip-with-log paths (do NOT throw — Stripe would retry forever
 * for a payload we can't map):
 *
 *   - Unknown status   (e.g. Stripe added a new value before we did)
 *   - Missing customer (anonymous draft)
 *   - No mapping for this customer in `stripe_customers`
 *     (Dashboard-created customer for a non-app user, or a webhook
 *     race with `customer.created` — caller can replay later).
 *
 * Throw paths (Stripe retries with backoff, which is what we want):
 *
 *   - Unexpected DB error.
 */
export async function upsertInvoice(invoice: Stripe.Invoice): Promise<void> {
	const customerId =
		typeof invoice.customer === 'string'
			? invoice.customer
			: invoice.customer && 'id' in invoice.customer
				? invoice.customer.id
				: null;

	if (!customerId) {
		console.warn('[invoices] no customer on invoice; skipping mirror', {
			invoice_id: invoice.id
		});
		return;
	}

	const userId = await userIdForCustomer(customerId);
	if (!userId) {
		console.warn('[invoices] no user mapping for customer; skipping mirror', {
			invoice_id: invoice.id,
			customer_id: customerId
		});
		return;
	}

	const row = buildInvoiceRow(invoice, userId);
	if (!row) {
		console.warn('[invoices] could not build row from invoice; skipping mirror', {
			invoice_id: invoice.id,
			status: invoice.status
		});
		return;
	}

	const { error } = await withAdmin('billing.invoices.upsert', 'system', async (admin) =>
		admin.from('stripe_invoices').upsert(row, { onConflict: 'id' })
	);
	if (error) {
		throw new Error(`[invoices] upsertInvoice failed for ${invoice.id}: ${error.message}`);
	}
}

/**
 * Webhook handler stubs. Each delegates to `upsertInvoice` because
 * the payload shape is identical across the five events; the
 * indirection exists so the dispatcher reads symmetrically with the
 * subscriptions module and so future per-event side-effects (e.g.
 * "send dunning email on payment_failed") have a clean seam to land
 * in.
 */
export const handleInvoiceFinalized = upsertInvoice;
export const handleInvoicePaid = upsertInvoice;
export const handleInvoiceVoided = upsertInvoice;
export const handleInvoiceMarkedUncollectible = upsertInvoice;

/**
 * `invoice.payment_failed` ALSO upserts the invoice (so the
 * "attempt N of 4" / `amount_remaining` shows up in the user's
 * billing history) AND logs at warn-level so it's visible in our
 * structured-logs query for retries. Email-side-effect lands in the
 * notifications module.
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
	console.warn('[invoices] payment_failed', {
		invoice_id: invoice.id,
		customer: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
		attempt_count: invoice.attempt_count,
		amount_remaining: invoice.amount_remaining
	});
	await upsertInvoice(invoice);
}

/**
 * Read the user's invoice history, newest first. Used by
 * `/account/billing` (Lesson 9.5).
 *
 * `limit` is generous by default (50 invoices ≈ 4 years of monthly
 * billing); a future "Load more" can pass an offset.
 */
export async function listInvoicesForUser(userId: string, limit = 50): Promise<InvoiceRow[]> {
	const { data, error } = await withAdmin('billing.invoices.list', 'system', async (admin) =>
		admin
			.from('stripe_invoices')
			.select('*')
			.eq('user_id', userId)
			// We exclude drafts: a draft invoice is not user-visible
			// in any Stripe surface either, and showing it in the
			// history list would be confusing ("$0 draft" rows).
			.neq('status', 'draft')
			.order('created_at_stripe', { ascending: false, nullsFirst: false })
			.limit(limit)
	);
	if (error) {
		throw new Error(`[invoices] listInvoicesForUser failed for ${userId}: ${error.message}`);
	}
	return data ?? [];
}
