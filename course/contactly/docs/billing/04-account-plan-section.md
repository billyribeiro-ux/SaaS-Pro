# Lesson 8.4 — Account "Plan" section

## Goal

Surface the user's billing reality on `/account` so they can answer three
questions in one glance:

1. Which plan am I on right now?
2. When does it renew (or end)?
3. What can I do about it?

The section is intentionally read-mostly. The Stripe Billing Portal and
Checkout flows arrive in Module 9 — this lesson lays the surface they will
hook into.

## Architecture

```
(app)/+layout.server.ts        → loads EntitlementSnapshot once per request
        └── data.entitlements
                └── /account/+page.svelte
                        └── <PlanSection {entitlements} />
```

Key point: `PlanSection` does **zero** data loading. It is a pure presentation
component fed by the snapshot already computed in the `(app)` layout (Lesson
8.3). That keeps the account page fast (no extra round-trip) and guarantees
the badge in the nav and the plan section in the page can never disagree —
they read from the same source of truth.

## What `PlanSection` renders

| Tier         | Header badge | Notice line                                      | Detail rows                               | CTAs                                              |
| ------------ | ------------ | ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------- |
| **Starter**  | `Starter`    | —                                                | Status: Free                              | **Upgrade** → `/pricing`                          |
| **Pro**      | `Pro`        | Optional: trial countdown / cancellation pending | Status: Active · Renews on / Access until | **Upgrade to Business** + disabled Manage billing |
| **Business** | `Business`   | Optional: trial countdown / cancellation pending | Status: Active · Renews on / Access until | Disabled Manage billing                           |

A trialing user gets a `Trial — N days left (ends Mon DD, YYYY)` banner.
A user who cancelled mid-cycle gets `Cancellation pending on Mon DD, YYYY`
and the renewal label flips to **Access until**, which is the exact wording
Stripe uses in their own dashboard. Same data, no surprises.

## Locale-stable formatting

All dates flow through a single module-scoped formatter:

```ts
const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' });
```

Why hard-code `en-US` (for now)?

- It produces identical output on the server and in the client, so SSR and
  hydration agree byte-for-byte. No "April 19, 2026" vs "19 April 2026"
  hydration warnings.
- The whole product is currently English-only. When we add i18n we swap this
  one line for a per-request locale and every plan/badge/date updates in
  lockstep.

The same reasoning is applied in `catalog.ts` for currency formatting (Lesson
8.1) — keep all locale decisions in named, replaceable constants.

## CTA logic

```text
starter   →  Upgrade            (active link to /pricing)
pro       →  Upgrade to Business + Manage billing (disabled, tooltip)
business  →  Manage billing (disabled, tooltip)
```

The disabled "Manage billing" buttons exist on purpose. They:

- communicate to the user that self-serve management is coming
- reserve the layout slot so Module 9.3 can wire the real handler without
  shifting any pixels
- give us a stable selector (`button[disabled][title*="Module 9.3"]`) for
  e2e tests that should pass _before_ Module 9 lands

We deliberately avoid showing the price/quantity here. That's the Billing
Portal's job. Duplicating it would mean double the places to drift when
Stripe changes a tax rule.

## Integration into `/account`

```svelte
<header>...</header>

<!-- Plan -->
<PlanSection entitlements={data.entitlements} />

<!-- Profile -->
...
```

The Plan card sits directly under the page header, above Profile. Rationale:
billing state is the most consequential thing on this page — if a card just
expired or a trial is ending in two days, the user needs to see it before
they scroll to change their display name.

## Fail-closed inheritance

Because `PlanSection` reads from `data.entitlements`, it inherits the
fail-closed behaviour from `(app)/+layout.server.ts`. If Stripe is down or
the mirror tables are unreachable, the layout falls back to a Starter
snapshot and `PlanSection` cleanly renders the Starter view with an Upgrade
CTA — never an empty card, never a thrown 500.

## Testing posture

`PlanSection` is small enough that snapshot/unit tests would mostly assert
formatting strings the browser already covers. Instead we lean on:

- the existing `snapshotFor` unit tests (Lesson 8.3) which fully cover the
  state machine the section reads from
- type-safety: the component imports `EntitlementSnapshot` directly, so any
  shape change forces an update here
- a follow-up Playwright flow in Module 12 that signs in as each tier and
  asserts the visible CTA

This is the right place to **stop** writing tests. Pure formatting
assertions on a presentation component are how test suites become liabilities.

## Files touched

- `src/lib/components/billing/PlanSection.svelte` — new component
- `src/routes/(app)/account/+page.svelte` — render `<PlanSection />` above
  Profile

## Up next

Lesson 8.5 — fail-closed contact-cap entitlement gate. We'll use the same
`EntitlementSnapshot` to enforce Starter's contact limit at write time,
returning a 402 with a structured payload the UI can convert into an
"Upgrade to add more contacts" banner.
