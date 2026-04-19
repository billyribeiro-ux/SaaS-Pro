# Lesson 9.5 — Invoice mirror + billing history surface

> **Module 9 — Checkout & billing portal**
> Previous: [09 — Checkout success + serial-trial guard](./09-checkout-success-and-trial-guard.md)
> Next: Module 10 — Webhooks resilience & operational hygiene

## Goal

Two pieces ship together in this lesson and form one feature:

1. **The invoice mirror.** A new `stripe_invoices` table + a webhook
   handler that upserts a row whenever Stripe finalizes, pays, fails,
   voids, or marks-uncollectible an invoice.
2. **The billing-history surface.** A new authenticated page,
   `/account/billing`, that lists the user's invoices in a table with
   "View" / "PDF" actions linking to Stripe-hosted assets, plus a
   "Manage billing" CTA into the Customer Portal.

The mirror is read by exactly one place: this page. We deliberately do
not use `stripe_invoices` for any payments-decision logic.
Subscription state is still mirrored separately and remains the source
of truth for entitlements (Module 7). This module is purely the
display layer.

## Module map

| File                                                              | Layer    | Role                                                                                                                                                            |
| ----------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260419000006_billing_invoices.sql` _(new)_ | Schema   | `stripe_invoice_status` enum + `stripe_invoices` table, indexes, RLS policy, trigger.                                                                           |
| `src/lib/database.types.ts` _(modified)_                          | Types    | Adds the new enum + table to the generated `Database` shape so the service layer is fully typed end-to-end.                                                     |
| `src/lib/server/billing/invoices.ts` _(new)_                      | Service  | `buildInvoiceRow` (pure mapper), `upsertInvoice` (I/O), `listInvoicesForUser`, plus the five webhook handlers (`handleInvoiceFinalized`, `…Paid`, `…Failed`, …) |
| `src/lib/server/billing/invoices.test.ts` _(new)_                 | Tests    | Unit tests for `buildInvoiceRow` covering paid / open / failed / voided shapes, expanded-customer payloads, missing-tax payloads, modern + legacy sub paths.    |
| `src/lib/server/stripe-events.ts` _(modified)_                    | Webhooks | Adds the five `invoice.*` events to `SUBSCRIBED_EVENTS` and routes them to the new handlers.                                                                    |
| `src/lib/server/stripe-events.test.ts` _(modified)_               | Tests    | Mocks the invoices module and asserts dispatcher routing.                                                                                                       |
| `src/routes/(app)/account/billing/+page.server.ts` _(new)_        | Load     | `listInvoicesForUser` → `BillingHistoryRow[]`, with a fallback `loadError` flag for graceful degradation.                                                       |
| `src/routes/(app)/account/billing/+page.svelte` _(new)_           | UI       | Read-only table, empty-state, error banner, "Manage billing" form, external-link guards on hosted Stripe assets.                                                |
| `src/lib/components/billing/PlanSection.svelte` _(modified)_      | UI       | Adds a "Billing history" link that routes to `/account/billing` for paid tiers.                                                                                 |

## Why mirror invoices at all

The Customer Portal already shows invoice history. We mirror anyway
for two reasons:

1. **Latency.** A logged-in user clicking "Billing" should see their
   invoices instantly, not wait for a portal-session round-trip.
2. **Self-contained UX.** We want our own surface for in-app affordances
   ("View receipt", "Download PDF", future "What was this charge?")
   without bouncing the user out for every interaction.

What we explicitly do **not** do with the mirror:

- No entitlement decision reads from `stripe_invoices`. Tier resolution
  is still driven by `stripe_subscriptions` (Module 7).
- No "is invoice X paid" check against the mirror in any payment path.
  Stripe is the boss; webhook lag of a few seconds is fine here because
  the page is for _past_ invoices, not "did the latest charge go
  through" decisions.

This separation is what lets us treat the table as a cache: if it ever
gets out of sync we can drop it, replay events from Stripe, and rebuild.
Nothing depends on it being authoritative.

## Schema

```sql
create type public.stripe_invoice_status as enum (
  'draft', 'open', 'paid', 'uncollectible', 'void'
);

create table public.stripe_invoices (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id text not null,
  subscription_id text references public.stripe_subscriptions (id) on delete set null,
  status public.stripe_invoice_status not null,
  currency text not null,
  amount_due bigint not null default 0,
  amount_paid bigint not null default 0,
  amount_remaining bigint not null default 0,
  subtotal bigint not null default 0,
  total bigint not null default 0,
  tax bigint,
  number text,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  created_at_stripe timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_invoices_id_format check (id ~ '^in_[A-Za-z0-9_]+$')
);
```

Design notes:

- **Enum, not text.** A future Stripe addition surfaces as an enum
  cast failure (loud and obvious) instead of a silent mystery string.
- **`subscription_id` nullable.** Ad-hoc Dashboard invoices created
  outside any subscription are legal in Stripe and we don't want them
  to fail the FK.
- **`tax` nullable, not `0`.** `NULL` means "no tax info / Stripe Tax
  disabled / exempt". `0` would mean "we calculated tax and it was
  zero". The two are not the same.
- **Monetary integers.** Stripe stores money in the smallest currency
  unit; we mirror the integer + currency code and format in the JS
  layer with the same `formatCurrency` helper used elsewhere.
- **Compound `(user_id, created_at_stripe DESC)` index.** The page
  paginates without a sort — fast even at thousands of invoices per
  user.
- **RLS — read-only for `authenticated`.** Users can `SELECT` their
  own rows; only the service-role webhook handler writes. No
  per-user `INSERT/UPDATE/DELETE` policies exist by design.

## Pure core / async shell

The service layer (`src/lib/server/billing/invoices.ts`) keeps a hard
split between pure mapping and I/O:

```ts
// PURE — exercised directly in invoices.test.ts (no Supabase mock)
export function buildInvoiceRow(invoice: Stripe.Invoice, userId: string): InvoiceInsert | null {
	/* … */
}

// SHELL — calls buildInvoiceRow, does the customer→user lookup + upsert
export async function upsertInvoice(invoice: Stripe.Invoice): Promise<void> {
	/* … */
}
```

The pure mapper returns `null` on bad input (unknown status, missing
customer) so the shell can log + skip rather than write garbage. The
shell only throws on **unexpected DB errors** so Stripe retries the
webhook with backoff.

### API version 2026-03-25.dahlia

`Invoice.subscription` (legacy) moved to
`Invoice.parent.subscription_details.subscription` in this version.
`subscriptionIdFor` follows the new path first and falls back to the
deprecated one for cassette tests recorded under older API versions.
The legacy branch becomes dead the day Stripe removes the field
entirely.

## Webhook routing

Five events all land in the same upsert (the `Stripe.Invoice` payload
on each carries the resolved `status`):

| Event                          | Status outcome                           | Side-effect today | Future seam               |
| ------------------------------ | ---------------------------------------- | ----------------- | ------------------------- |
| `invoice.finalized`            | `open`                                   | upsert            | "Invoice ready" email     |
| `invoice.paid`                 | `paid`                                   | upsert            | "Receipt" email           |
| `invoice.payment_failed`       | usually `open`, `attempt_count` advances | upsert + `warn`   | Dunning email (Module 11) |
| `invoice.voided`               | `void`                                   | upsert            | —                         |
| `invoice.marked_uncollectible` | `uncollectible`                          | upsert            | "Past due" notice         |

`handleInvoicePaymentFailed` is the only handler with extra logic
today: it logs at `warn` (so the entry shows up in our dunning-attempt
log query) before delegating to `upsertInvoice`. The dunning-email
side-effect lands in the notifications module.

## The page (`/account/billing`)

### Load

```ts
export const load: PageServerLoad = async ({ parent }) => {
	const { user, entitlements } = await parent();
	let rows: BillingHistoryRow[] = [];
	let loadError = false;
	try {
		const invoices = await listInvoicesForUser(user.id);
		rows = invoices.map(toBillingHistoryRow);
	} catch (err) {
		console.error('[billing/history] listInvoicesForUser failed', { user_id: user.id, err });
		loadError = true;
	}
	return { rows, loadError, entitlements };
};
```

Posture choices:

- **Always render.** A transient mirror outage shouldn't 500 the
  whole billing area. We surface a banner and the `Manage billing`
  CTA, where the canonical Stripe-hosted history lives.
- **Drafts excluded.** `listInvoicesForUser` filters them out at the
  DB level. A draft invoice is not user-visible in any Stripe surface
  either; surfacing them here would be confusing ("$0 draft" rows).
- **Newest-first.** Driven by the index, not the JS layer.

### View-model

`BillingHistoryRow` pre-computes the formatted total on the server so
the Svelte template stays free of formatting concerns and SSR/CSR
render byte-identical strings.

```ts
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
```

`totalDisplay` reuses the shared `formatCurrency` helper (same one as
the pricing page and the success page). The trailing `/mo` suffix is
stripped because a single invoice represents a billing event, not a
recurring rate.

### External-link guard

The "View" and "PDF" actions point to absolute Stripe-hosted URLs
(`https://invoice.stripe.com/i/…`, `https://pay.stripe.com/…`). They
never route back into our app, so SvelteKit's `resolve()` wrapper is
inappropriate.

The `svelte/no-navigation-without-resolve` rule explicitly allows
links carrying `rel="external"`, so we add it alongside the standard
`noopener noreferrer`:

```svelte
<a
	href={row.hostedInvoiceUrl}
	target="_blank"
	rel="external noopener noreferrer"
	class="text-brand-700 hover:text-brand-900 underline"
	data-testid="billing-history-view"
>
	View
</a>
```

`rel="external"` doubles as a real browser hint (no SPA hijacking) and
satisfies the linter without an inline disable comment.

### Empty / error states

- **Empty.** First-time pro users with no invoices yet see a friendly
  "Once we charge you, your receipts will show up here." panel with
  the `Manage billing` CTA below it.
- **Error.** A red banner explains "We couldn't load your billing
  history right now." and points to the portal. The page still
  renders with whatever rows we _did_ manage to fetch (today, that's
  always the empty array, but the shape is forward-compatible with
  partial failures).

### Plan-section integration

`PlanSection` (Module 8.4) gets a small addition: a "Billing history"
button next to "Manage billing" for Pro and Business tiers. Starter
users see nothing new — they have no invoices to look at.

## Tests

`src/lib/server/billing/invoices.test.ts` covers the mapper:

- Paid invoice → all monetary fields correct, `paid_at` populated.
- Open invoice → no `paid_at`, `amount_remaining > 0`.
- Voided invoice → status maps, all timestamps preserved.
- Customer expanded as object vs string id → both yield the same
  `stripe_customer_id`.
- Missing `total_taxes` → `tax` is `null`, not `0`.
- Multiple `total_taxes` lines → summed correctly.
- Modern `parent.subscription_details.subscription` → respected.
- Legacy `(invoice as any).subscription` → fallback path works.
- Unknown status → returns `null` (caller logs + skips).
- Missing customer → returns `null`.

`src/lib/server/stripe-events.test.ts` adds a `vi.mock` for
`$lib/server/billing/invoices` so dispatcher tests cover _routing_
only — no DB or Stripe round-trip in unit tests.

End-to-end coverage is intentionally deferred to Module 12, where the
recorded-cassette harness exercises the full event → mirror → page
loop against a Stripe sandbox.

## Operational notes

- **Backfill.** A new install or a dropped table can be repopulated
  from Stripe in one call: list invoices for each customer and run
  them through `upsertInvoice`. The mirror is intentionally
  reconstructible.
- **Debugging "missing invoice" reports.** The flow is always
  Stripe → webhook handler → `stripe_invoices` → page. If a user
  reports a missing receipt, check (a) did the webhook deliver
  (Stripe Dashboard), (b) did the handler skip-with-log (search the
  app logs for `[invoices]`), (c) is the row present in the table
  with the expected `user_id`?
- **Privacy.** RLS makes the table user-scoped at the DB layer; the
  service-role webhook handler bypasses RLS by design (it has to
  write across users). Never expose the service-role key to the
  client.

## Acceptance checklist

- [x] Migration applies cleanly and is idempotent across reruns of
      `supabase db reset`.
- [x] `pnpm run lint` and `pnpm run check` are green with no
      suppressions in committed code.
- [x] `pnpm run test:unit` is green; mapper coverage hits all known
      status / payload shapes.
- [x] Webhook dispatcher routes the five `invoice.*` events to the
      correct handlers (verified in `stripe-events.test.ts`).
- [x] `/account/billing` renders for Starter (no invoices, friendly
      empty state), Pro (recent invoices listed), and Business
      (same shape as Pro), all with the `Manage billing` CTA.
- [x] Both `View` and `PDF` actions open Stripe-hosted assets in a
      new tab with `rel="external noopener noreferrer"`.
- [x] Failure path (`listInvoicesForUser` throws) renders the banner
      and never 500s.

## What changed since Lesson 9.4

- **DB:** new `stripe_invoice_status` enum + `stripe_invoices` table
  with indexes, RLS, and `updated_at` trigger.
- **Service:** new `invoices.ts` (pure mapper + async shell + handlers
  - list helper).
- **Webhooks:** five new `invoice.*` events wired into the existing
  dispatcher.
- **UI:** new `/account/billing` page, plus a "Billing history" CTA
  on `PlanSection`.
- **Tests:** new mapper tests, dispatcher mocks updated.
- **Docs:** this file.
