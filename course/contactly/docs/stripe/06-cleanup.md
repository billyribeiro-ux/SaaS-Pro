# Lesson 5.7 — Cleanup

Test-mode Stripe accounts accumulate cruft. You'll seed, iterate,
change a price, re-seed, trip over a typo, seed again, and end up with
a double digit product count under `prod_contactly_*` — most of them
inactive, a couple of them orphaned in ways that make the Dashboard
confusing.

This lesson ships the antidote: an opinionated cleanup script that
archives every Contactly-tagged product and its prices in one pass,
and refuses to touch a live account.

## Why "archive," not "delete"?

Stripe **does not allow DELETE of products that have ever had a
Subscription, an Invoice, or a paid Checkout Session.** The Dashboard's
Delete button is disabled; the API returns a `resource_in_use` error.
This isn't a Stripe UX regression — it's a deliberate
auditability/compliance guarantee. Historical invoices keep pointing at
the product they billed for, forever.

The supported equivalent is **archival**: setting `active: false` on
the Price and Product. Archived resources:

- Disappear from the Dashboard product-catalog default view (they move
  to the "Archived" filter).
- Are no longer valid `line_items` in new Checkout Sessions.
- Are filtered out by `prices.list({ active: true })` / `products.list({ active: true })`.
- **Still attach to any active Subscription** — grandfathered billing
  keeps working.

That last point is important: archival is not "retire the plan and
refund every customer." It's "hide from future signups."

## Run it

```bash
cd course/contactly
pnpm run stripe:cleanup              # dry-run: lists what would change
pnpm run stripe:cleanup -- --yes     # actually archives
```

Sample dry-run output:

```text
→ Listing active Contactly products (metadata.app=contactly)…
→ Found 2 product(s) to archive:
    - prod_contactly_pro (Contactly Pro)
    - prod_contactly_business (Contactly Business)

… running in dry-run mode (no changes will be made).
    Re-run with `--yes` to actually archive these resources.
```

And the committed pass:

```text
→ Listing active Contactly products (metadata.app=contactly)…
→ Found 2 product(s) to archive:
    - prod_contactly_pro (Contactly Pro)
    - prod_contactly_business (Contactly Business)

→ Archiving prices under prod_contactly_pro (Contactly Pro)…
    · price price_1P...  lookup=contactly_pro_monthly  → active=false
    · price price_1P...  lookup=contactly_pro_yearly   → active=false
→ Archiving product prod_contactly_pro…

→ Archiving prices under prod_contactly_business (Contactly Business)…
    · price price_1P...  lookup=contactly_business_monthly  → active=false
    · price price_1P...  lookup=contactly_business_yearly   → active=false
→ Archiving product prod_contactly_business…

✓ Cleanup complete.
```

## Safety rails the script enforces

1. **Filters by `metadata.app = 'contactly'`.** Third-party products
   in the same test account (from other experiments, or shared
   tenants) are untouched.
2. **Dry-run by default.** No mutations happen unless you pass `--yes`.
3. **Refuses to run in live mode.** The script reads
   `stripe config --list` and bails if the CLI is authenticated
   against a live account. Live-mode cleanup should be a
   hand-reviewed Dashboard action, not a script.
4. **Paginates safely.** Stripe's `list` endpoints cap at 100 items
   per page; the script follows `has_more` + `starting_after` until
   the full set is collected.

## After cleanup

To bring the catalog back:

```bash
pnpm run stripe:fixtures
```

Because the fixtures file uses user-specified product IDs
(`prod_contactly_pro`, `prod_contactly_business`), the re-seed hits
the **archived** records and Stripe returns `resource_already_exists`.
Two valid recoveries:

### Option A — Unarchive and keep iterating (fast)

```bash
stripe products update prod_contactly_pro --active=true
stripe products update prod_contactly_business --active=true
pnpm run stripe:fixtures
```

Existing lookup_keys get transferred to the new Prices automatically
thanks to `transfer_lookup_key: true`.

### Option B — Blow away and start over (only when needed)

Switch to a fresh test account. Each Stripe account is independent;
test mode in a brand-new account has zero historical state and the
seed runs cleanly. You can create additional test accounts at
<https://dashboard.stripe.com/register>. Contactly's CI in Module 12.4
does exactly this — a per-branch isolated test account for e2e
billing tests.

## Module 5 done

That's the whole Stripe introduction. The remaining Stripe work across
Modules 6–10 builds on top of what this module put in place:

- A configured CLI (5.3) for forwarding webhooks.
- A versioned fixtures file (5.5) as the only path to a product
  catalog.
- A typed `LookupKey` union (5.6) as the only way code references a
  price.
- A cleanup script (this lesson) to reset state between iterations.
- An ADR (ADR-007 in `course/ARCHITECTURE.md`) to pin the pricing
  model these pieces serve.

Module 6 installs the Stripe Node SDK and wires the first webhook.
