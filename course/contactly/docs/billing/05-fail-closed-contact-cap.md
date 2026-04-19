# Lesson 8.5 — Fail-closed contact-cap entitlement gate

## Goal

Enforce the Starter-tier contact limit at write time so that users on a paid
tier get the resource and users on the free tier never accidentally do.

This is the first **enforcing** gate in the codebase. Up to this point we
were displaying entitlements (badges, plan section). Now they decide what
the database is allowed to contain.

## Module map

```
src/lib/billing/
  └── limits.ts                  ← per-tier caps (single source of truth)

src/lib/server/billing/
  ├── contact-cap.ts             ← evaluateContactCap (pure)
  │                              ← checkContactCap   (async shell)
  └── contact-cap.test.ts        ← unit tests for the pure rule

src/routes/(app)/contacts/
  ├── +page.server.ts            ← exposes capStatus to the list page
  ├── +page.svelte               ← banner + tier-aware CTA
  ├── new/+page.server.ts        ← gates the insert action (HTTP 402)
  └── new/+page.svelte           ← inline upgrade banner + disabled Save
```

## Where the rule lives

**One file** — `src/lib/billing/limits.ts`:

```ts
export const CONTACT_CAP: Readonly<Record<Tier, number | null>> = {
	starter: 50,
	pro: null,
	business: null
};
```

Two intentional choices:

1. **`null` for unlimited, never `Infinity`.** Forces every call-site to
   pattern-match (`limit === null ? unlimited : ...`) instead of relying on
   "no number is greater than `Infinity`" — TypeScript tells us when we
   forgot the unlimited branch. `Infinity` would silently work and silently
   break around `JSON.stringify`.

2. **In code, not the database.** Pricing limits are product policy, not
   customer data. A migration would make every tweak a deploy-blocking
   schema change. Code-resident limits ship with the gates that read them,
   in one PR, reviewed together.

## Pure core, async shell

```text
              evaluateContactCap        ← pure, owns the rule
                     ▲
                     │
              checkContactCap           ← async shell, owns the I/O
                     ▲
        ┌────────────┴────────────┐
        │                          │
contacts/+page.server.ts   contacts/new/+page.server.ts
   (display capStatus)       (refuse the insert at write)
```

`evaluateContactCap` is a few lines and doesn't touch a database. The unit
tests (`contact-cap.test.ts`) cover the rule end-to-end without mocking
Supabase. `checkContactCap` only does the count query and hands the result
back to the pure function — it's the only place that needs to fail closed.

### Decision shape

```ts
type ContactCapDecision =
	| { allowed: true; tier; limit; used; remaining }
	| { allowed: false; reason: 'cap_reached'; tier; limit; used }
	| { allowed: false; reason: 'unknown'; tier };
```

Discriminated unions, on purpose. The list page renders one banner for
`cap_reached` ("upgrade to Pro") and a different one for `unknown` ("we
couldn't verify your plan, retry"). Both sit on the read path. The action
maps the same shape to either `fail(402)` or `fail(503)`.

## Fail-closed contract

> When the gate cannot answer with confidence, the answer is **no**.

Concretely: if the count query errors, `checkContactCap` does **not** assume
"the user is fine" or "the user is broken" — it returns
`{ allowed: false, reason: 'unknown' }` and lets the caller decide how to
explain the failure. The action turns it into HTTP 503 with a generic
"could not verify your plan limits" message. The user is annoyed; they are
not silently granted a paid resource.

The opposite policy ("fail open" — let the insert through if you can't
check) is a billing-fraud surface: a single failing query becomes
"unlimited contacts on the free tier" until the alert fires. This codebase
will never do that.

## Where the gate runs

There are two natural places to consider — the load function and the
action — and we use **both**, for different reasons.

### In the load: render-time decisions

```ts
const capStatus =
	entitlements.tier === 'starter'
		? await checkContactCap({ supabase, organizationId: organization.id, tier: 'starter' })
		: null;
```

Why: so the New-contact button can be replaced with an Upgrade button before
the user clicks it, and so the form on `/contacts/new` can disable Save and
show the upgrade banner before any keystrokes. Catching the wall at submit
time is correct but cruel — pre-flighting it makes the wall a guidepost
instead of a punishment.

`null` for paid tiers is deliberate: it skips the count query entirely, so
the unlimited tiers pay zero overhead.

### In the action: authoritative decision

```ts
const entitlements = await loadEntitlements(user.id);
const decision = await checkContactCap({
	supabase,
	organizationId: organization.id,
	tier: entitlements.tier
});

if (!decision.allowed) {
	// → fail(402, { form, message: { code: 'cap_reached', ... } })
	// → fail(503, { form, message: { code: 'cap_unknown',  ... } })
}
```

Why: a stale browser tab can hold a "you have room" capStatus from an hour
ago. Form actions cannot read parent loads, and even if they could, the gate
must be authoritative against the live database — not whatever was true at
page load. The action re-resolves entitlements and re-counts.

HTTP status:

- `402 Payment Required` for `cap_reached`. RFC 9110 documents 402 as
  "reserved for future use", and the prevailing convention (Stripe, GitHub,
  many SaaS APIs) has settled on it for billing-policy refusals. Using it
  consistently here means our future API surface can adopt the same code
  with no reinterpretation.
- `503 Service Unavailable` for `unknown`. The user's request is valid; we
  just can't service it right now.

### Why not handle this with RLS or a CHECK constraint?

It's tempting to push the cap into Postgres so the rule survives every
client. We deliberately don't, for now:

- `CHECK` cannot reference `count(*)` of another table.
- A `BEFORE INSERT` trigger that counts rows turns every insert into an
  exclusive lock on the count to be race-safe. Doable, but expensive on
  every workspace, paid or not.
- The cap is a _product_ policy that can change without a migration. A
  free promo bumping Starter to 75 contacts becomes a one-line code edit
  - tests + deploy, not a migration.

The tradeoff: a non-app insert path (a future bulk-import job, a Postgres
console session) won't be gated. Both of those run as service-role and
should call `checkContactCap` themselves; this is documented in the file
header so the next contributor doesn't get surprised.

## UX states

Two surfaces consume the cap status. Both render the same intent:

| Page                   | Allowed (under cap)                                 | Allowed (≤10% remaining)                         | `cap_reached`                                             | `unknown`                                              |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| `/contacts`            | New contact button                                  | New contact button (no banner — list is healthy) | Upgrade CTA replaces button + amber banner above the list | Amber "could not verify" banner; New contact disabled  |
| `/contacts/new` (load) | Form active                                         | Amber "X of Y remaining" warning above the form  | Form disabled + amber banner with Upgrade CTA             | (Form load doesn't surface unknown — submit will fail) |
| `/contacts/new` (POST) | Insert proceeds; redirects to `/contacts?created=1` | Same as allowed                                  | `fail(402)` → upgrade banner, Save stays disabled         | `fail(503)` → "try again" banner, Save re-enabled      |

The 10%-remaining warning is a soft nudge: starter users routinely hit the
wall and we want them to feel it coming for ~5 contacts before it lands,
not as a surprise on contact #50.

## What we deliberately did not build

- **A "remaining" badge in AppNav.** The badge is the tier; the cap belongs
  on contact-list surfaces. Putting it everywhere normalizes "you are
  almost out of room" into ambient noise.
- **Auto-deletion when downgrading.** A user who drops from Pro to Starter
  with 200 contacts keeps all 200 — the gate just refuses _new_ inserts
  until they prune. Destroying customer data because of a billing event is
  the kind of thing companies write postmortems about.
- **Email notifications when the user nears the cap.** That's transactional
  email and lives in Module 11, not here.
- **A separate gate for the contacts edit page.** Edits don't change row
  count. The gate fires only on writes that increase usage.

## Files touched

New:

- `src/lib/billing/limits.ts`
- `src/lib/server/billing/contact-cap.ts`
- `src/lib/server/billing/contact-cap.test.ts`

Modified:

- `src/routes/(app)/contacts/+page.server.ts` — load `capStatus`
- `src/routes/(app)/contacts/+page.svelte` — banner + tier-aware CTA
- `src/routes/(app)/contacts/new/+page.server.ts` — pre-flight + gating action
- `src/routes/(app)/contacts/new/+page.svelte` — form-side banner + disabled Save

## Module 8 wrap-up

That's Module 8 — pricing page + entitlements UI + a real, enforcing gate.
You can now:

- show every plan and its price (`/pricing`)
- read a user's plan everywhere (`EntitlementSnapshot`)
- show that plan in the shell (`PlanBadge`) and on the account page
  (`PlanSection`)
- enforce a tier-specific limit at write time, fail-closed, with end-to-end
  UX

Module 9 picks up Checkout, the Billing Portal, and the upgrade flow that
turns the Upgrade CTAs in this lesson into actual paid customers.
