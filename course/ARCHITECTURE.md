# Contactly — Architecture Decision Record

This document is the source of truth for the architectural decisions that
shape every lesson in the Contactly course. It is intentionally short.
Every entry exists because getting it wrong costs days or weeks of rework.

If you ever need to deviate from these decisions, **stop, document the new
decision here, and then change the code.** Code that contradicts this file
without an entry below it is a bug in the documentation or a bug in the
code — never both at once.

---

## ADR-001: Multi-tenancy

**Decision.** Contactly is a multi-tenant SaaS. Data is owned by
**organizations**, not users. Every record that represents user-generated
content (contacts, notes, files, …) carries an `organization_id` foreign
key, and every Row Level Security policy keys off membership in that
organization, never off `auth.uid() = user_id` directly.

**Personal-workspace ergonomics.** When a user signs up, the
`handle_new_user` trigger creates both their `profiles` row **and** a
personal organization with that user as the sole `owner` member. A
brand-new user can therefore use the app immediately without learning the
"workspace" concept; teams emerge naturally when they invite a second
member.

**Why.** A real CRM/contact-management product is almost always
team-oriented at maturity (HubSpot, Pipedrive, Copper, Attio). Retrofitting
multi-tenancy onto a single-user data model rewrites every CRUD module,
every RLS policy, and every billing surface. Building it in from day one
costs ~15% more upfront and saves rebuilding 60% of the codebase later.

**Tested via.** RLS policy tests in Module 19 assert that a member of org A
cannot read, write, or even count rows in org B.

---

## ADR-002: Billing scope

**Decision.** Subscriptions belong to the **user**, not the organization.
A user's tier is global to their account; bringing their account into any
organization grants that organization the features the user is entitled to.

**Implications.**

- The `subscriptions` table has `user_id`, not `organization_id`.
- Stripe customer records (`customers` table) map one-to-one to users.
- Feature gates check the _acting user's_ tier, not the org's plan.
- A free-tier owner with a Pro-tier member sees Pro features when that
  member is acting; the owner reverts to Free when acting alone.

**Why.** This matches the Notion / Vercel / Cursor model: a person pays
for their own productivity tools, and brings them into shared spaces. It
sidesteps the seat-counting and per-seat invoicing complexity that
per-organization billing introduces, which is correct for v1. If we ever
want per-org billing later, the migration path is well-understood
(`subscriptions.organization_id` becomes the source of truth, seat
enforcement gates membership) and the existing per-user model becomes the
"personal Pro" tier alongside it.

---

## ADR-003: Email

**Decision.** Two surfaces, one provider:

1. **Supabase Auth emails** (signup confirmation, password reset, magic
   link, email change) — sent through **Resend** by configuring Supabase
   Auth's SMTP settings to point at Resend.
2. **Application emails** (welcome, organization invitation, billing
   receipts that supplement Stripe's defaults, support notifications) —
   sent directly via the **Resend Node SDK** from server actions.

**Why one provider.** Two providers means two reputations to warm up, two
deliverability stories to debug, two domain authentications, and an
inconsistent "from" address that confuses customers. One provider is the
state-of-the-art baseline.

**Why Resend specifically.** Best-in-class developer experience among
modern transactional providers, generous free tier, first-class support
for React/HTML email templates, simple SMTP exposure for Supabase Auth.

**Templates.** Application emails use `react-email`-compatible HTML
templates (rendered with `@react-email/render` even though we're a Svelte
app — the React templating story is genuinely better than the alternatives
and the rendered output is just HTML strings, language-agnostic at the
boundary).

---

## ADR-004: Error tracking & observability

**Decision.** **Sentry** for error tracking, performance, and release
tagging. Structured logs via `pino` to stdout (Vercel's runtime captures
them). A self-hosted `audit_log` table in Postgres for security-sensitive
operations (role changes, entitlement grants, impersonation, refunds).

**Why Sentry.** Industry standard, free tier comfortably covers an
indie-SaaS volume, official SvelteKit SDK, and the lessons translate
verbatim to most companies students will work at. The alternatives
(Highlight, BetterStack, self-hosted GlitchTip) are all viable but each
has a smaller ecosystem footprint.

**Audit log scope.** Anything an admin does on another user's behalf, plus
anything a user does that affects billing state, gets a row in
`admin_audit_log` (already exists in the platform; same pattern in
Contactly). The DB is the source of truth — Sentry is for engineering
incidents, the audit log is for legal/compliance/support.

---

## ADR-005: Authentication methods

**Decision.** Both **password** and **magic link** are first-class. The
sign-in page presents both options on the same screen; users pick. A user
can have set a password, used magic links, both, or neither (e.g. an
invited org member who hasn't completed signup).

**Why both.** Password meets user expectations and works offline-ish
(refresh tokens still need a network round-trip but no email round-trip).
Magic links are the modern UX-friendly path and demonstrate the pattern
students will see at every modern SaaS they use. Teaching both costs one
extra lesson and makes the course materially more complete.

**Email-verification policy.** Sign-ups via password require email
verification before access. Sign-ups via magic link are inherently
email-verified (the link itself is the proof). Invited org members are
auto-verified at the moment they accept.

---

## ADR-006: Tax

**Decision.** **Stripe Tax** with `automatic_tax: { enabled: true }` on
every Checkout Session and `automatic_tax: { enabled: true }` on every
Subscription. Customer billing address is collected at checkout
(`billing_address_collection: 'required'`) and saved to the Stripe
Customer. US sales-tax registration thresholds and obligations are the
operator's responsibility — Contactly's code handles the _integration_; the
operator handles the _registration_.

**Why.** Anything else means writing tax math, which is a regulated and
ever-changing surface area no application code should own. Stripe Tax is
~$0.50 per transaction, fully integrated with the rest of the Stripe
billing flow, and is the only sane choice for a US-multi-state SaaS.

**International note.** When Contactly expands beyond the US, Stripe Tax
also handles VAT (EU/UK), GST (AU/NZ/CA), and most other jurisdictions
with the same `automatic_tax` flag. The code is correct on day one for
both domestic and international expansion.

---

## ADR-007: Pricing model

**Decision.** Three tiers, two billing intervals on the paid tiers:

| Tier         | Monthly | Yearly | Lookup keys                                                     |
| ------------ | ------- | ------ | --------------------------------------------------------------- |
| **Starter**  | Free    | Free   | _no Stripe price; entitlement is the absence of a subscription_ |
| **Pro**      | $19     | $190   | `contactly_pro_monthly`, `contactly_pro_yearly`                 |
| **Business** | $49     | $490   | `contactly_business_monthly`, `contactly_business_yearly`       |

Yearly = 10× monthly (~17% discount). Both paid tiers include a 14-day
free trial; trial state is enforced via the `subscription_trials` audit
table (Module 9.4) so a user cannot serially restart trials by
cancelling and re-subscribing.

**Stripe modeling.**

- Two **Products** (`prod_pro`, `prod_business`) — each with two
  recurring **Prices** (monthly + yearly). Starter is _not_ a Stripe
  resource; it's the implied state when no active subscription exists.
- Code references prices by their **lookup key**, never the live
  `price_xxx` ID. Lookup keys are stable across test/live mode and
  across re-seeds; price IDs change every time we run the fixtures
  script.
- All prices are billed in `USD` for v1. Multi-currency support is a
  Module 13+ enhancement.
- `tax_behavior: 'exclusive'` on every price — Stripe Tax (ADR-006)
  computes the tax line at checkout, the headline price the customer
  sees on the pricing page is the pre-tax sticker.

**Why these specific numbers.** Round, memorable, and cleanly demonstrate
plan-comparison UX without the cognitive overhead of `$19.99`-style
psychological pricing (which is a separate marketing concern). 10×
yearly is the canonical SaaS discount that students will see at
GitHub, Linear, Vercel, Notion, etc.

**Implementation guard.** A `src/lib/billing/lookup-keys.ts` module
exports a typed `LOOKUP_KEYS` const and a `LookupKey` union. Any code
that references a price MUST import from this module — `// @ts-expect-error`
on a string literal price ID is a code-review block.

---

## Versioning

This document uses ADR (Architecture Decision Record) numbering. Decisions
are append-only — superseded entries are marked **Superseded by ADR-XXX**
and remain in the file as historical context. Never delete an ADR.
