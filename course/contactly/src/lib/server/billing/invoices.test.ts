import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { buildInvoiceRow } from './invoices';

/**
 * Build a synthetic `Stripe.Invoice` with sane defaults (paid Pro
 * monthly, $19, cycle ending 2026-05-01) — each test overrides only
 * the fields it cares about. Cast to `Stripe.Invoice` because the
 * SDK's interface has dozens of fields we don't populate; the
 * mapper only reads the ones we do.
 */
function fakeInvoice(over: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
	const base = {
		id: 'in_test_123',
		object: 'invoice' as const,
		customer: 'cus_test',
		status: 'paid' as const,
		currency: 'usd',
		amount_due: 1900,
		amount_paid: 1900,
		amount_remaining: 0,
		subtotal: 1900,
		total: 1900,
		number: 'D1A2C3-0001',
		hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
		invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf',
		period_start: 1_711_929_600, // 2024-04-01T00:00:00Z (just a stable fixture)
		period_end: 1_714_521_600, // 2024-05-01T00:00:00Z
		created: 1_714_521_600,
		status_transitions: {
			paid_at: 1_714_521_600,
			finalized_at: 1_714_521_600,
			marked_uncollectible_at: null,
			voided_at: null
		},
		// New-API parent shape for subscription resolution
		parent: {
			type: 'subscription_details' as const,
			subscription_details: {
				subscription: 'sub_test_abc',
				metadata: null
			},
			quote_details: null
		},
		total_taxes: [
			{
				amount: 200,
				tax_behavior: 'exclusive',
				tax_rate_details: null,
				taxability_reason: 'standard_rated',
				taxable_amount: 1900,
				type: 'tax_rate_details'
			} as unknown as Stripe.Invoice.TotalTax
		]
	};
	return { ...base, ...over } as unknown as Stripe.Invoice;
}

describe('billing/invoices — buildInvoiceRow', () => {
	it('maps a paid subscription invoice to the expected row', () => {
		const row = buildInvoiceRow(fakeInvoice(), 'user_uuid_123');
		expect(row).not.toBeNull();
		expect(row).toMatchObject({
			id: 'in_test_123',
			user_id: 'user_uuid_123',
			stripe_customer_id: 'cus_test',
			subscription_id: 'sub_test_abc',
			status: 'paid',
			currency: 'usd',
			amount_due: 1900,
			amount_paid: 1900,
			amount_remaining: 0,
			subtotal: 1900,
			total: 1900,
			tax: 200,
			number: 'D1A2C3-0001',
			hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
			invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf'
		});
		// Timestamps round-trip through `new Date(s * 1000).toISOString()`.
		expect(row?.paid_at).toBe('2024-05-01T00:00:00.000Z');
		expect(row?.created_at_stripe).toBe('2024-05-01T00:00:00.000Z');
	});

	it('returns null on an unknown invoice status (loud telemetry, no write)', () => {
		const row = buildInvoiceRow(
			fakeInvoice({ status: 'mythic' as unknown as Stripe.Invoice.Status }),
			'user_x'
		);
		expect(row).toBeNull();
	});

	it('returns null when there is no customer attached (anonymous draft)', () => {
		const row = buildInvoiceRow(fakeInvoice({ customer: null }), 'user_x');
		expect(row).toBeNull();
	});

	it('resolves an expanded customer object as well as a string id', () => {
		const row = buildInvoiceRow(
			fakeInvoice({
				customer: { id: 'cus_expanded' } as unknown as Stripe.Customer
			}),
			'user_x'
		);
		expect(row?.stripe_customer_id).toBe('cus_expanded');
	});

	it('persists a null subscription_id for ad-hoc Dashboard invoices', () => {
		const row = buildInvoiceRow(fakeInvoice({ parent: null }), 'user_x');
		expect(row?.subscription_id).toBeNull();
	});

	it('falls back to the legacy `invoice.subscription` field when parent is missing', () => {
		// Cassettes recorded under the pre-2025-09 API shape have
		// `subscription` directly on the invoice. The mapper must
		// still resolve it so historical replays don't lose links.
		const row = buildInvoiceRow(
			fakeInvoice({
				parent: null,
				...({ subscription: 'sub_legacy_xyz' } as unknown as Partial<Stripe.Invoice>)
			}),
			'user_x'
		);
		expect(row?.subscription_id).toBe('sub_legacy_xyz');
	});

	it('stores tax = null when total_taxes is missing or empty', () => {
		const noTaxes = buildInvoiceRow(fakeInvoice({ total_taxes: null }), 'user_x');
		expect(noTaxes?.tax).toBeNull();
		const emptyTaxes = buildInvoiceRow(fakeInvoice({ total_taxes: [] }), 'user_x');
		expect(emptyTaxes?.tax).toBeNull();
	});

	it('sums multiple tax lines into the single `tax` column', () => {
		const row = buildInvoiceRow(
			fakeInvoice({
				total_taxes: [
					{ amount: 100 } as unknown as Stripe.Invoice.TotalTax,
					{ amount: 250 } as unknown as Stripe.Invoice.TotalTax
				]
			}),
			'user_x'
		);
		expect(row?.tax).toBe(350);
	});

	it('records open + payment_failed invoices with their attempt-state fields intact', () => {
		const row = buildInvoiceRow(
			fakeInvoice({
				status: 'open',
				amount_paid: 0,
				amount_remaining: 1900,
				status_transitions: {
					paid_at: null,
					finalized_at: 1_714_521_600,
					marked_uncollectible_at: null,
					voided_at: null
				}
			}),
			'user_x'
		);
		expect(row?.status).toBe('open');
		expect(row?.amount_paid).toBe(0);
		expect(row?.amount_remaining).toBe(1900);
		expect(row?.paid_at).toBeNull();
	});
});
