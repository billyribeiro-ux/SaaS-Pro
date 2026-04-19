---
title: "10.1 - Validate Tier Helpers"
module: 10
lesson: 1
moduleSlug: "module-10-access-control"
lessonSlug: "01-validate-tier-helpers"
description: "Build server-side helper functions that check a user's subscription status."
duration: 12
preview: false
---

## Overview

We have a billing pipeline. Users can sign up, enter a checkout session, pay, and Stripe fires a webhook that writes a row into `public.subscriptions` with a `status` column. That column is now the single source of truth for whether a user is entitled to paid features.

But right now, nothing in our app reads that column. A user with `status = 'active'` and a user with no subscription row at all look identical to every page and every form action in Contactly. The billing data exists; the app doesn't use it.

This lesson wires the two halves together with a tiny helper module: `src/lib/utils/access.ts`. It exports two functions — `hasActiveSubscription(userId)` and `getSubscriptionStatus(userId)` — that every subsequent lesson in this module will call. Build the foundation cleanly here and the three lessons that follow become trivial.

More importantly, this is where we start treating **authorization** (who is allowed to do what) as a distinct layer from **authentication** (who are you). You already have authentication sorted via Supabase Auth. What you don't have yet is an entitlement check — a question your code asks before performing a paid action: "Does this user have an active subscription?" Every helper in `access.ts` is a building block for that check.

## Prerequisites

- Module 7 complete — `public.subscriptions` exists with a `status` column and is populated by the `customer.subscription.*` webhook handlers.
- Module 9 complete — a real webhook flow writes `active` / `trialing` / `canceled` into that column when Stripe fires events.
- `$server` alias resolves to `$lib/server` (set in `svelte.config.js`).
- `supabaseAdmin` is wired up in `src/lib/server/supabase.ts` and uses the service-role key.

## What You'll Build

- A new file `src/lib/utils/access.ts` exporting two async helpers.
- `hasActiveSubscription(userId: string): Promise<boolean>` — a boolean gate for UI and action code.
- `getSubscriptionStatus(userId: string): Promise<string | null>` — the raw status string, for telemetry and debugging flows.
- A clean import surface so any file in the app can import these with a one-liner.

---

## Step 1: Why a Helper Module Instead of Inline Queries

Think about how many places in Contactly will eventually ask "is this user subscribed?"

- Create-contact form action (Lesson 10.2) — gate past the 10-contact free-tier limit.
- Contacts list page load (Lesson 10.3) — pass `isSubscribed` to the UI so the "Add Contact" button shows an upgrade prompt for free users.
- Checkout endpoint (Lesson 10.4) — block already-subscribed users from starting a second checkout session.
- Future: export-to-CSV action, bulk-delete action, API token generation, webhook setup page, team invite, custom fields.

If each of those places writes its own Supabase query, six things go wrong.

1. **Drift.** One call filters `status = 'active'`; another filters `status in ('active', 'trialing')`; a third forgets `trialing` entirely. Your entitlement rule lives in six different files, subtly different each time.
2. **Test surface explodes.** Six queries means six spots where you mock Supabase in tests, six chances to get the mock out of sync with reality.
3. **Refactor pain.** When you add a `paused` or `past_due` status later (you will), you edit six files instead of one.
4. **No single reviewable unit.** Security-sensitive logic deserves a single, focused module that a code reviewer can hold in their head. Six scattered calls do not.
5. **Caching is impossible.** If the call is duplicated ad hoc, you can't add a TTL cache or batching layer without touching every call site.
6. **Observability is harder.** Add a log line to one function, every call gets it. Six queries means six places to wire telemetry.

So we centralize. One file, two functions, a known interface. Every feature gate in the course will go through `hasActiveSubscription()`. When we eventually add per-feature entitlements ("is this user on the Pro tier? the Team tier?"), we extend this module — not every caller.

This is the **authorization boundary**. The rule is: all entitlement decisions flow through `src/lib/utils/access.ts`. Anything that bypasses it is a bug.

---

## Step 2: Why the Helpers Live in `$lib/utils` and Use `supabaseAdmin`

Two decisions to unpack before we write code.

### Decision 1: `$lib/utils/access.ts`, not `$server/access.ts`

We're importing `supabaseAdmin` from `$server/supabase`. That alone would force the file to be server-only. But we deliberately put the helper file in `$lib/utils/` rather than `$lib/server/` because the **signature** of `hasActiveSubscription(userId)` is a pure boolean — it says nothing about how the answer was obtained. If we ever add an edge-cached or client-accessible variant (a signed token, say), we'd want to re-export from the same module.

That's a small aesthetic choice; the critical one is the next.

### Decision 2: `supabaseAdmin`, not `locals.supabase`

`locals.supabase` is the per-request RLS-aware client — it carries the user's JWT and every query is constrained by the RLS policies on `subscriptions`. If we used it here, we'd need RLS policies that let a user read their own subscription row.

We'd eventually want that anyway, but there's a bigger reason to use `supabaseAdmin`:

**The webhook wrote the data.** Stripe's webhook handler in Module 9 runs with no user session — it's an anonymous HTTP POST from Stripe's servers. It has to use `supabaseAdmin` to write the `subscriptions` row. And it does.

So when we **read** back from the same table, the two options are:

1. Use `locals.supabase` with an RLS policy that lets authenticated users see their own row. Clean, but forces us to maintain yet another RLS policy.
2. Use `supabaseAdmin` (bypasses RLS) and trust the function's signature. The `userId` argument is the filter; the caller is responsible for passing the right user.

We go with option 2 because the helper is trusted code that lives behind a tight authorization boundary. The caller (a server-side form action or `+page.server.ts` load) has already authenticated the user via `locals.getUser()`. It passes that authenticated user's ID into the helper. There's no scenario where untrusted input reaches this function.

**That's the contract.** `userId` must come from `locals.getUser()` or equivalent trusted source. Don't pass an ID from a form field, a URL parameter, or any user-controllable input. If you break the contract, you break tenant isolation. Code review catches this; the helper doesn't.

---

## Step 3: The File, End to End

Create `src/lib/utils/access.ts`:

```typescript
// src/lib/utils/access.ts
import { supabaseAdmin } from '$server/supabase'

const ACTIVE_STATUSES = ['active', 'trialing'] as const

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)
    .limit(1)
    .maybeSingle()

  return !!data
}

export async function getSubscriptionStatus(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.status ?? null
}
```

Twenty-three lines. No magic. Let's walk every one of them.

### Line 2: `import { supabaseAdmin } from '$server/supabase'`

`$server` is an alias for `$lib/server`, configured in `svelte.config.js`. SvelteKit refuses to bundle anything under `$lib/server` into the client — if some misguided component imported this file, the build would fail loudly. That's the point: service-role keys never touch the browser.

`supabaseAdmin` is a Supabase JS client initialized with `SUPABASE_SERVICE_ROLE_KEY`. That key bypasses every RLS policy. Treat it the way you'd treat a production database superuser password: only server-side code touches it, and only via a named import that a reviewer can grep for.

### Line 4: `const ACTIVE_STATUSES = ['active', 'trialing'] as const`

This is the **entitlement rule**. We consider two Stripe subscription statuses as granting paid-tier access:

- `active` — the user has an active paid subscription.
- `trialing` — the user is in a free trial period. They haven't been charged yet, but Stripe will charge them at the end of the trial unless they cancel.

`as const` gives the array a literal tuple type `readonly ['active', 'trialing']` — TypeScript knows the exact values, not just `string[]`. That matters when we pass it into Supabase's `.in(...)` filter: the query-builder's generated types can verify the values against the column's domain.

**Why those two and not others?** Stripe emits a full lifecycle of statuses:

| Status | What it means | Gated? |
|---|---|---|
| `active` | Paid, current billing period | Yes — user has access |
| `trialing` | In trial, not yet charged | Yes — user has access |
| `past_due` | Payment failed, grace period active | No — we downgrade them |
| `unpaid` | Payment failed past grace period | No — no access |
| `canceled` | Explicitly canceled (or trial ended without payment) | No |
| `incomplete` | First payment hasn't succeeded yet | No |
| `incomplete_expired` | First payment timed out | No |
| `paused` | Subscription paused (manual Stripe action) | No |

We include `trialing` because a user who starts a trial expects to use the product. If we gated them out, the trial would be a broken promise. We exclude `past_due` — a payment failed, they need to fix their card, and immediate downgrade creates pressure to pay. (Many SaaS companies give a grace period — send emails for 3–7 days before flipping off access. That's a retention-tuning decision; we'll default to strict.)

### Line 6: `export async function hasActiveSubscription(userId: string): Promise<boolean>`

The type signature is the API contract. `userId: string` in, `Promise<boolean>` out. Callers don't need to know about Supabase, error handling, or the status column — they get yes or no.

`Promise<boolean>` specifically (not `Promise<boolean | null>`) — we never return "I don't know." If the query fails or returns no row, we return `false`. Fail-closed is the right default for authorization.

### Lines 7–12: The query chain

```typescript
const { data } = await supabaseAdmin
  .from('subscriptions')
  .select('status')
  .eq('user_id', userId)
  .in('status', ACTIVE_STATUSES)
  .limit(1)
  .single()
```

Reading it top to bottom:

- **`.from('subscriptions')`** — targets the subscriptions table.
- **`.select('status')`** — fetches only the `status` column. We don't actually need the value for this function (we just need a row to exist), but selecting something is required. Selecting one column instead of `*` keeps the query narrow; the database's query planner can answer from a covering index if we have one.
- **`.eq('user_id', userId)`** — filter to rows belonging to this user. Remember: no RLS is in play (we're admin), so this `eq` is our only tenant filter. Getting it wrong means tenant leakage.
- **`.in('status', ACTIVE_STATUSES)`** — filter to the two statuses that grant access. Postgres turns this into `status IN ('active', 'trialing')`.
- **`.limit(1)`** — at most one row. We don't care if the user has two subscriptions; we only need to know whether they have any that grants access.
- **`.maybeSingle()`** — return the row as an object (not a one-element array), and tolerate zero results. If zero rows match, `data` is `null` and no error is thrown. If one row matches, `data` is that row. The cousin `.single()` would throw a `PGRST116` error for zero rows — that's the right choice when a row is guaranteed (e.g., primary-key lookup), and the wrong choice here where "user has no subscription yet" is a valid, common state.

### Line 14: `return !!data`

The double-bang converts whatever `data` is into a strict boolean. `null` → `false`. Any object → `true`. No ambiguity.

We don't throw, and we don't return `null`. If the Supabase call errored (network glitch, DB down), `data` is `null` and we return `false` — fail-closed. The caller's user-facing behavior is "no access right now" rather than a crash or, worse, accidental access.

### Line 17: `getSubscriptionStatus`

The second function returns the raw status string. Why do we need this if we have `hasActiveSubscription`?

Three use cases:

1. **UI nuance.** "Your subscription is past due — update your card" is a much better message than a generic "upgrade to continue." Knowing the raw status lets us branch.
2. **Telemetry.** When tracking "user hit feature gate," we want to log *why* they failed — `canceled` and `past_due` are very different signals for product analytics.
3. **Debug endpoints.** An internal admin page might render the raw status for a customer-success rep.

Same mechanics as before with two differences:

- **No `.in('status', ...)` filter.** We want the status regardless of what it is.
- **`.order('created_at', { ascending: false }).limit(1)`** — if a user has multiple subscription rows in their history (downgraded, reactivated, etc.), we want the most recent one. Ordering by `created_at DESC` plus `limit(1)` picks the newest row.

Line 23: `return data?.status ?? null` — optional chaining (`data?.status`) handles the null-data case, and `?? null` explicitly types the fallback so the return is `string | null`.

---

## Step 4: Using the Helpers from a Server File

The helpers are trivial to call. You'll see these exact shapes in lessons 10.2 and 10.3:

```typescript
// inside a +page.server.ts load function
import { hasActiveSubscription } from '$lib/utils/access'
import { redirect } from '@sveltejs/kit'

export async function load({ locals }) {
  const user = await locals.getUser()
  if (!user) redirect(303, '/login')

  const isSubscribed = await hasActiveSubscription(user.id)

  return { isSubscribed }
}
```

And in a form action:

```typescript
import { hasActiveSubscription } from '$lib/utils/access'
import { fail, redirect } from '@sveltejs/kit'

export const actions = {
  default: async ({ locals }) => {
    const user = await locals.getUser()
    if (!user) redirect(303, '/login')

    const subscribed = await hasActiveSubscription(user.id)
    if (!subscribed) {
      return fail(403, { error: 'Upgrade to continue' })
    }

    // ... do the paid thing
  }
}
```

Notice the pattern: **always get the user first, then pass `user.id` into the helper.** Never read `user_id` from a form field; never pull it from a URL. The helper's contract is that `userId` comes from a trusted source, and `locals.getUser()` is that source.

---

## Step 5: Verifying It Works

The helpers don't render anything; they're pure functions. We verify by calling them from a temporary endpoint or from the Vitest suite (Module 11). For a quick sanity check right now, add a temporary load function to any dashboard page:

```typescript
// src/routes/(app)/dashboard/+page.server.ts
import { hasActiveSubscription, getSubscriptionStatus } from '$lib/utils/access'

export async function load({ locals }) {
  const user = await locals.getUser()
  if (!user) return { }

  const isSubscribed = await hasActiveSubscription(user.id)
  const status = await getSubscriptionStatus(user.id)

  console.log({ isSubscribed, status })
  return { isSubscribed, status }
}
```

Run `pnpm dev`, log in as a user with no subscription — you should see `{ isSubscribed: false, status: null }`. Then either seed a subscription row via Studio or run through a real checkout and verify the logs flip to `{ isSubscribed: true, status: 'active' }`.

Remove the `console.log` before committing. The structured `return` is fine — we'll use it in Lesson 10.3.

---

## Common Mistakes

- **Calling the helper with the wrong ID.** `hasActiveSubscription(customerId)` where `customerId` is the **Stripe** customer ID, not our Supabase user ID. The `user_id` column in `subscriptions` stores our internal ID; passing a Stripe ID will silently return `false` for every user. The parameter name `userId` is deliberate — if you find yourself passing a `customerId`, you have a mismatch.
- **Forgetting to include `'trialing'`.** If your entitlement rule is `status = 'active'` only, trial users can't access paid features. That breaks the trial experience and kills conversion. Always include `trialing` unless you have a very specific reason not to.
- **Using `locals.supabase` "because it feels safer."** Without RLS policies that explicitly allow the user to select their own subscription row, the query returns nothing and `hasActiveSubscription` returns `false` for every user. The service-role key is the correct tool here; protect the boundary via the function's signature and code review.
- **Returning `null` instead of `false` on error.** Callers end up writing `if (subscribed === true)` instead of `if (subscribed)`, and the type surface gets worse, not better. Fail-closed: always return `false` on unknowns.
- **Using `.single()` where a row is not guaranteed.** `.single()` throws `PGRST116` when zero rows match — which is exactly the state an unsubscribed user lives in. `.maybeSingle()` returns `data: null` and no error for zero rows, so the `return !!data` fallback works. Rule of thumb: `.single()` only when you're doing a primary-key lookup and you're certain the row exists; `.maybeSingle()` for every "maybe one row" read.
- **Caching the result in a module-level variable.** "Let me avoid the DB round-trip by memoizing." In a serverless environment (Vercel, Cloudflare Workers) that lives for the duration of a single request. In a long-lived Node server it's a correctness bug — Alice's subscription status gets cached and served to Bob's next request. If you want caching, do it right (see Principal Engineer Notes).

---

## Principal Engineer Notes

### Authorization as a separate layer

The best-run codebases I've seen treat authorization (authz) as a distinct concern from authentication (authn). Authn answers *who are you?* Authz answers *what are you allowed to do?*

In Contactly, authn lives in `hooks.server.ts` and `locals.getUser()`. Authz now lives in `$lib/utils/access.ts`. Keeping them separate gives you three wins:

1. **Swap authn providers without touching authz.** If we ever replace Supabase Auth with Clerk or a homegrown solution, the authz module doesn't change — it still takes a `userId` and returns a boolean.
2. **Test authz without mocking authn.** The helper takes a plain string; unit tests construct user IDs freely.
3. **Reason about authz rules in one place.** When the product team says "let's add an `enterprise` tier with different gates," you edit `access.ts`. Not every route file.

### Why centralized helpers beat scattered queries

Security bugs come from inconsistency. When three files each write `supabase.from('subscriptions').select('status').eq('user_id', user.id)` with slightly different filters, one of them will drift. Maybe it's six months from now, maybe it's the intern's first PR — somebody adds `.neq('status', 'canceled')` to one of the three call sites because they didn't know about the others, and now you have two definitions of "subscribed."

Centralized helpers turn that into a single diff. A reviewer sees the rule change once; tests cover it once; log messages originate from one file. It's the same principle that moved SQL strings out of application code into ORMs: single source of truth for any operation that must be uniform.

### TTL caching in hot paths

`hasActiveSubscription` is called on every page load and every action for logged-in users. At scale, that's one DB round-trip per request to a table that changes rarely (a user's subscription status flips maybe once a month). This is the textbook case for a short-TTL cache.

```typescript
// Sketch — do NOT build this yet; only when you have metrics showing it matters.
const cache = new Map<string, { value: boolean; expiresAt: number }>()

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)
    .limit(1)
    .maybeSingle()

  const value = !!data
  cache.set(userId, { value, expiresAt: Date.now() + 60_000 })
  return value
}
```

The tradeoff: up to 60 seconds of staleness. If a user cancels and gets charged, or upgrades and doesn't see access, they'd wait up to a minute. That's almost always acceptable for SaaS; it's almost never acceptable for a bank. Benchmark before optimizing; the naive version is fast enough until it isn't.

Remember: server-side module-level caches are a correctness hazard in Node long-lived servers unless keyed properly (the sketch above keys by `userId`, which is the minimum). In serverless edge runtimes, caches are per-instance and evict on cold start — often good enough.

### `active` vs `trialing` as entitlement gates

There's a philosophical split in SaaS on what to call an "entitled" user.

- **Strict active-only.** Trials are a different experience: the user sees paid features in a preview, but actually using them is gated. This converts better for high-touch enterprise products where trials are proof-of-concept sessions.
- **Trial counts as full access.** Users in trial treat the product as if they paid. This reduces friction and converts better for self-serve products where you want to create habit before the bill hits.

We chose the latter for Contactly — our target is self-serve SMB. If you're building for enterprise, flip this: `const ACTIVE_STATUSES = ['active'] as const` and show trial users a banner that says "Trial: X days left. Start paying to unlock full access."

The rule to internalize: the choice of statuses is a **product decision**, not a code decision. Make sure whoever owns conversion metrics agrees with the list in `access.ts`.

### What happens when someone forgets to cancel a trial

Edge case worth knowing. A user starts a trial with a card attached, never uses the product, and the trial ends. Stripe charges the card and emits `invoice.paid`; the subscription flips from `trialing` to `active`. No code change in our helpers — they already include both statuses. The user still has access.

If the user has no card and the trial ends, Stripe emits `customer.subscription.deleted` (or `incomplete_expired` depending on configuration). The subscription row's status becomes `canceled`, our helper returns `false`, the user hits the free-tier gates next time they load the app. Clean transition.

Test this path manually at least once — use Stripe's test clock feature to fast-forward a trial and confirm your webhook handlers flip the status column correctly.

---

## Summary

- Created `src/lib/utils/access.ts` with two exports: `hasActiveSubscription` and `getSubscriptionStatus`.
- Used `supabaseAdmin` (service-role) because the webhook is the owner of the `subscriptions` data and we're reading trusted-input-only.
- Encoded the entitlement rule — `['active', 'trialing']` — as a single constant.
- Understood the authn/authz split: authentication in `hooks.server.ts`, authorization in `$lib/utils/access.ts`.
- Chose fail-closed semantics: return `false` on any error or missing row.
- Named the authorization boundary: all entitlement decisions flow through this module.

## What's Next

Lesson 10.2 takes `hasActiveSubscription` to its first real job — gating the create-contact form action so free-tier users hit a 10-contact limit. You'll see the full `fail(403, ...)` shape, the counting query, and the telemetry hook that turns "user hit the limit" into an upgrade-intent signal your marketing team can act on.
