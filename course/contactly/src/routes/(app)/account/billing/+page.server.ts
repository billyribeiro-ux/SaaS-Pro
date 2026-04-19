/**
 * Billing history page — `/account/billing`.
 *
 * Reads the user's invoice mirror (Lesson 9.5) and surfaces it as a
 * sortable, paginate-friendly list. Read-only: every action that
 * needs to *change* billing state (update card, change plan, cancel)
 * goes through the Customer Portal via the `Manage billing` form
 * shipped in Lesson 9.3.
 *
 * SOURCE OF TRUTH
 * ---------------
 * The local mirror — `stripe_invoices` — is the on-page source of
 * truth here, with intentional caveats:
 *
 *   - Webhook lag of a few seconds is fine. The page is for past
 *     invoices, not "is the latest charge through yet" decisions.
 *     Anyone wanting a real-time view clicks `Manage billing` and
 *     lands on the Customer Portal's hosted history page.
 *   - The mirror is RLS-scoped to the owning user, so this load
 *     could in principle use the per-request `supabase` client. We
 *     deliberately route through the service-role helper inside
 *     `listInvoicesForUser` — same pattern as the rest of the
 *     billing services — to keep one consistent path for ops/audit
 *     logging and to avoid the small RLS round-trip for a screen
 *     the (app) layout has already auth-gated.
 *
 * VIEW-MODEL
 * ----------
 * Each row in the page is a `BillingHistoryRow` — a small,
 * presentation-shaped object built from the mirrored row plus the
 * locale-stable currency formatter. Pre-computing the formatted
 * total on the server keeps the Svelte template free of formatting
 * concerns and ensures SSR/CSR render byte-identical strings.
 */
import type { PageServerLoad } from './$types';
import { listInvoicesForUser, type InvoiceRow } from '$lib/server/billing/invoices';
import { formatCurrency } from '$lib/billing/catalog';

export type BillingHistoryRow = {
	id: string;
	number: string | null;
	status: InvoiceRow['status'];
	statusLabel: string;
	totalDisplay: string;
	createdIso: string | null;
	periodStartIso: string | null;
	periodEndIso: string | null;
	hostedInvoiceUrl: string | null;
	invoicePdf: string | null;
};

const STATUS_LABEL: Record<InvoiceRow['status'], string> = {
	draft: 'Draft',
	open: 'Open',
	paid: 'Paid',
	uncollectible: 'Uncollectible',
	void: 'Void'
};

/**
 * Map a stored invoice row to its presentation shape. Pure; left
 * exported in case a future test wants to lock the formatting.
 *
 * Currency formatting reuses `formatCurrency` (shared with the
 * pricing page and the success page) but with `'monthly'` as a
 * neutral interval — the headline is purely "amount in currency"
 * here, not "amount per period", since each invoice represents a
 * single billing event.
 */
export function toBillingHistoryRow(row: InvoiceRow): BillingHistoryRow {
	return {
		id: row.id,
		number: row.number,
		status: row.status,
		statusLabel: STATUS_LABEL[row.status],
		totalDisplay: formatCurrency(row.total, row.currency, 'monthly').replace(/\/mo$/, ''),
		createdIso: row.created_at_stripe,
		periodStartIso: row.period_start,
		periodEndIso: row.period_end,
		hostedInvoiceUrl: row.hosted_invoice_url,
		invoicePdf: row.invoice_pdf
	};
}

export const load: PageServerLoad = async ({ parent }) => {
	const { user, entitlements } = await parent();

	let rows: BillingHistoryRow[] = [];
	let loadError = false;
	try {
		const invoices = await listInvoicesForUser(user.id);
		rows = invoices.map(toBillingHistoryRow);
	} catch (err) {
		// Same posture as the pricing page: a transient mirror outage
		// shouldn't 500 the whole billing area. We render the page
		// with an explanatory banner and links to the Customer Portal
		// where the canonical history lives.
		console.error('[billing/history] listInvoicesForUser failed', {
			user_id: user.id,
			err
		});
		loadError = true;
	}

	return { rows, loadError, entitlements };
};
