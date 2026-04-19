---
title: "10.2 - Restricting Actions"
module: 10
lesson: 2
moduleSlug: "module-10-access-control"
lessonSlug: "02-restricting-actions"
description: "Gate server-side form actions behind subscription checks — free users are limited, paid users get full access."
duration: 15
preview: false
---

## Overview

Right now, every logged-in user in Contactly can create an unlimited number of contacts. That's a problem — there's no reason to pay us if the free product is the paid product. This lesson introduces the first real **entitlement gate**: free-tier users get 10 contacts, paid users get unlimited.

The gate lives in the server-side form action for "create contact." Before we insert the row, we ask two questions:

1. "Does this user have an active subscription?" — if yes, skip all limits.
2. "Has this free-tier user hit the 10-contact limit?" — if yes, return `fail(403, ...)` with an upgrade message and redirect to `/pricing?upgrade=true`.

It's a small amount of code. The important part is *where* the code lives: exclusively on the server, in the action function, before the insert. We'll unpack why that position matters (and why no amount of client-side UI can substitute for it) in the Principal Engineer Notes.

## Prerequisites

- Lesson 10.1 complete — `hasActiveSubscription()` is exported from `$lib/utils/access.ts`.
- Module 4 complete — the contacts table exists, RLS is on, and `/contacts/new` has a working form action that inserts a row.
- `locals.getUser()` and `locals.supabase` are wired through `hooks.server.ts`.

## What You'll Build

- A `FREE_TIER_LIMIT` constant (10).
- An updated `src/routes/(app)/contacts/new/+page.server.ts` that:
  - Authenticates the request.
  - Checks for an active subscription (short-circuit for paid users).
  - Counts the user's existing contacts when the user is on free tier.
  - Returns `fail(403, ...)` with an `upgradeRequired: true` flag when the limit is hit.
  - Inserts the row and redirects on success.
- A client-side pattern for the page to show an upgrade prompt when `form.upgradeRequired` is `true`, with a CTA to `/pricing?upgrade=true`.

---

## Step 1: The Entitlement Rule in English First

Before writing code, write the rule in plain language. That forces clarity:

> A user can create a new contact if they have an active subscription, OR if they currently own fewer than 10 contacts.

Translated to a decision tree, the action does these things in order:

1. Is the user authenticated? → no, redirect to login.
2. Validate the form input (name, email, phone, company) — same Zod schema as before.
3. Is the user subscribed? → yes, skip the count; fall through to insert.
4. Count the user's existing contacts.
5. Is the count ≥ 10? → yes, return `fail(403, { upgradeRequired: true, ... })`.
6. Insert the row.
7. Redirect to `/contacts` on success.

Each of those steps has a clear reason to fail and a clear reason to continue. The fail modes return descriptive shapes so the UI can render the right message. The happy path is the one you've already built in Module 4.

---

## Step 2: The Updated Server File, End to End

Here's the full `+page.server.ts` for `/contacts/new`. We'll walk it after.

```typescript
// src/routes/(app)/contacts/new/+page.server.ts
import { fail, redirect } from '@sveltejs/kit'
import * as z from 'zod'
import type { Actions } from './$types'
import { hasActiveSubscription } from '$lib/utils/access'

const FREE_TIER_LIMIT = 10

const contactSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(40).optional(),
  company: z.string().max(200).optional()
})

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const user = await locals.getUser()
    if (!user) redirect(303, '/login?redirectTo=/contacts/new')

    const formData = await request.formData()
    const raw = {
      first_name: formData.get('first_name'),
      last_name: formData.get('last_name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      company: formData.get('company')
    }

    const parsed = contactSchema.safeParse(raw)
    if (!parsed.success) {
      return fail(400, {
        error: parsed.error.issues[0]?.message ?? 'Invalid input',
        data: raw
      })
    }

    const isSubscribed = await hasActiveSubscription(user.id)

    if (!isSubscribed) {
      const { count, error: countError } = await locals.supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      if (countError) {
        return fail(500, {
          error: 'Could not verify your plan limits. Try again.',
          data: raw
        })
      }

      if ((count ?? 0) >= FREE_TIER_LIMIT) {
        return fail(403, {
          error: `Free plan is capped at ${FREE_TIER_LIMIT} contacts. Upgrade to add more.`,
          upgradeRequired: true,
          upgradeUrl: '/pricing?upgrade=true',
          data: raw
        })
      }
    }

    const { email, phone, company, ...rest } = parsed.data

    const { error: insertError } = await locals.supabase.from('contacts').insert({
      user_id: user.id,
      ...rest,
      email: email && email !== '' ? email : null,
      phone: phone && phone !== '' ? phone : null,
      company: company && company !== '' ? company : null
    })

    if (insertError) {
      return fail(500, {
        error: 'Failed to create contact. Please try again.',
        data: raw
      })
    }

    redirect(303, '/contacts')
  }
}
```

### Line-by-line breakdown of the new pieces

#### Import and constant

```typescript
import { hasActiveSubscription } from '$lib/utils/access'

const FREE_TIER_LIMIT = 10
```

`FREE_TIER_LIMIT = 10` is a constant, not a config option (yet). When you later want to A/B-test different tier caps, you'd move this to an environment variable or a feature flag. For now, literal `10` is honest — no magic-number false flexibility.

The constant is defined at module top-level, not inside the action. That makes it easy to import from tests and from the UI (Lesson 10.3) to render "You've used 7 of 10 contacts."

#### Authentication guard

```typescript
const user = await locals.getUser()
if (!user) redirect(303, '/login?redirectTo=/contacts/new')
```

Same as every server action: authenticate before doing anything else. If no user, bounce to login with a `redirectTo` so they come back to `/contacts/new` after authenticating. Progressive enhancement: the browser's native redirect works even if JS is disabled.

#### Subscription check — **after** validation, **before** the count

```typescript
const isSubscribed = await hasActiveSubscription(user.id)
```

Why after validation? Because we want to fail fast on bad input without making any DB calls — a user spamming the endpoint with garbage shouldn't trigger a subscription lookup.

Why before the count? Because counting is the expensive operation (scans the contacts table for this user), and the subscription check can short-circuit it. Paid users never pay the count.

#### The counting query

```typescript
const { count, error: countError } = await locals.supabase
  .from('contacts')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', user.id)
```

Three decisions packed in here.

**`count: 'exact'`.** Supabase offers three count modes:
- `exact` — Postgres does a `COUNT(*)` with a real scan. Accurate but cost grows with row count.
- `planned` — returns the planner's estimate. Fast but can be wildly off for small tables.
- `estimated` — a hybrid.

We use `exact` because we need the count to be right at the boundary (9 vs 10). `planned` would let a user sneak through with 12 contacts if the planner is optimistic, or block them at 8 if it's pessimistic. At our scale (worst case 10 rows per user), `exact` is nearly free.

**`head: true`.** Tells PostgREST to respond with just the HTTP headers — no row data. We want the count, not the rows. This saves bandwidth and round-trip time.

**`.eq('user_id', user.id)`.** Belt-and-suspenders. RLS already filters to the user's own rows (Module 4 set up `using (auth.uid() = user_id)` on `contacts`), but the explicit `eq` documents intent and protects us if the RLS policy is ever relaxed.

#### Handling count errors

```typescript
if (countError) {
  return fail(500, {
    error: 'Could not verify your plan limits. Try again.',
    data: raw
  })
}
```

If the count query fails for any reason (network, DB pool exhausted, RLS misconfiguration), we fail the request with a 500. We **do not** silently proceed to insert — that would let a user bypass the limit during a DB blip. Fail-closed.

`data: raw` repopulates the form so the user doesn't lose their input on retry.

#### The limit check

```typescript
if ((count ?? 0) >= FREE_TIER_LIMIT) {
  return fail(403, {
    error: `Free plan is capped at ${FREE_TIER_LIMIT} contacts. Upgrade to add more.`,
    upgradeRequired: true,
    upgradeUrl: '/pricing?upgrade=true',
    data: raw
  })
}
```

The HTTP status is `403 Forbidden` — the user is authenticated but not authorized for this specific action. Not `402 Payment Required` (too cute and poorly supported by browser UX conventions), not `400 Bad Request` (the input was fine, it's the state that's wrong).

The payload includes three specific fields:

- `error` — the message the UI renders in a banner.
- `upgradeRequired: true` — a flag the UI can branch on to render an upgrade CTA (full-width button, modal, etc.) instead of a plain error.
- `upgradeUrl: '/pricing?upgrade=true'` — the exact URL to redirect to. The `?upgrade=true` query parameter is a **marketing hook** — the pricing page can render differently ("You're close to your limit — upgrade now!") and track conversions with analytics.

`(count ?? 0)` — if the count is unexpectedly `null` (shouldn't happen with `exact`, but types are types), treat it as 0 rather than throwing.

`>= FREE_TIER_LIMIT` — not `>`. A user with 10 contacts has hit the cap; the 11th would be the 11th. Off-by-one bugs here are the classic form of "free users seem to get 11 contacts."

#### The insert (unchanged from Module 4)

```typescript
const { email, phone, company, ...rest } = parsed.data

const { error: insertError } = await locals.supabase.from('contacts').insert({
  user_id: user.id,
  ...rest,
  email: email && email !== '' ? email : null,
  phone: phone && phone !== '' ? phone : null,
  company: company && company !== '' ? company : null
})
```

The empty-string → null conversion for optional fields is still the right pattern — `email = ''` in the database is a lie ("the user has an email, and it's the empty string"). `null` is the truth ("the user has no email").

`user_id: user.id` — the RLS `with check` policy enforces this, but we set it explicitly so the code is self-documenting and doesn't rely on defaults.

#### The redirect

```typescript
redirect(303, '/contacts')
```

On success, `303 See Other` sends the user to the contacts list, using a GET request. POST/Redirect/GET: refresh doesn't duplicate the contact, browser history is clean.

---

## Step 3: Rendering the Upgrade Prompt on the Page

The action returns rich error payloads; the page needs to render them. Update `src/routes/(app)/contacts/new/+page.svelte`:

```svelte
<!-- src/routes/(app)/contacts/new/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import type { ActionData } from './$types'

  let { form }: { form: ActionData } = $props()
</script>

<div class="max-w-xl mx-auto py-8">
  <h1 class="text-2xl font-bold mb-6">New contact</h1>

  {#if form?.upgradeRequired}
    <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
      <p class="font-semibold text-amber-900">{form.error}</p>
      <a
        href={form.upgradeUrl}
        class="inline-block mt-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
      >
        Upgrade to Pro →
      </a>
    </div>
  {:else if form?.error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
      {form.error}
    </div>
  {/if}

  <form method="POST" use:enhance>
    <!-- your existing fields here -->
  </form>
</div>
```

The template branches on `form?.upgradeRequired` first (amber "upgrade me" banner with a CTA button) and falls back to a generic red error banner for everything else. The upgrade-prompt styling is deliberately different from a normal validation error — we're signaling "this isn't a bug you can fix; you need to buy something."

Notice we use `$props()` and read the `form` prop the Svelte 5 way. No `export let form`. The TypeScript type is `ActionData`, which SvelteKit auto-generates from your action's return shape — `upgradeRequired` and `upgradeUrl` show up in autocomplete for free.

---

## Step 4: The Pricing-Page Side of the Flow

The server sends the user to `/pricing?upgrade=true`. That page already exists (Module 8). The small upgrade-state tweak is just reading the `upgrade` search param via `$app/state` and rendering a different headline:

```svelte
<!-- src/routes/(app)/pricing/+page.svelte (snippet) -->
<script lang="ts">
  import { page } from '$app/state'

  let showUpgradeBanner = $derived(page.url.searchParams.get('upgrade') === 'true')
</script>

{#if showUpgradeBanner}
  <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-blue-900">
    You've hit your free plan's contact limit. Pick a plan below to keep adding.
  </div>
{/if}
```

`page` from `$app/state` is the Svelte-5-native reactive page store. `page.url.searchParams` is a standard `URLSearchParams` object. `$derived` wraps the boolean so the component re-renders if the URL changes (edge case, but free with `$derived`).

---

## Step 5: Testing the Gate

1. Log in as a user with no subscription.
2. Create contacts 1 through 10 — they should all succeed.
3. Try to create the 11th. You should see the amber upgrade banner with the "Upgrade to Pro →" button.
4. Click the button. You land on `/pricing?upgrade=true` with the "you've hit your limit" banner.
5. Complete a checkout (Module 9 flow). Return to `/contacts/new`.
6. Try the 11th contact again. It should succeed — the subscription check short-circuits the count.

Add the test to your Playwright suite once you're in Module 11; for now, manual verification is fine.

To test the server-side enforcement directly (without the UI), `curl` or `httpie` the endpoint as the limited user:

```bash
curl -X POST http://localhost:5173/contacts/new \
  -H "Cookie: sb-access-token=YOUR_JWT" \
  -d "first_name=Eleventh&last_name=Contact"
```

You should get a 403 with a body containing `"upgradeRequired":true`. Even bypassing our Svelte UI entirely, the gate holds.

---

## Common Mistakes

- **Checking `count > FREE_TIER_LIMIT` instead of `>=`.** A user with 10 contacts has used all 10 slots. The 11th is over the limit. Using `>` lets them create 11.
- **Running the count before the subscription check.** Paid users pay a DB round-trip for nothing. Always short-circuit with the cheaper check first.
- **Putting the gate in the client.** A `disabled` attribute on the submit button feels like a gate; it's a speed bump. Anyone with DevTools can delete the attribute and submit. The real gate is the server action, always.
- **Using `count: 'planned'` or `'estimated'`.** These are fast but not accurate at the boundary. `exact` is correct for small per-user rowcounts.
- **Returning just a string from `fail()`.** `fail(403, 'Upgrade required')` works but gives you no structure. The client sees `form = 'Upgrade required'` — no branching logic, no upgrade URL. Always return an object.
- **Hardcoding `FREE_TIER_LIMIT` in multiple places.** The UI (Lesson 10.3) also needs to know the limit. Export it from a shared module (`$lib/config/tiers.ts`) if you find yourself copy-pasting `10`.
- **Forgetting `redirectTo` on the login redirect.** If the user's session expired mid-form, they log back in and land on `/dashboard` instead of `/contacts/new`. Include `?redirectTo=...` so they pick up where they left off.

---

## Principal Engineer Notes

### Server-side gates are non-negotiable

There is exactly one place in the flow that truly enforces this limit: the server action. UI state is hints; URL routing is hints; form validation is hints. The only authoritative decision happens on the server, where the database lives and where the code cannot be modified by the user.

Every time you think "I'll just hide the button in the client," ask: can a curl command still create the row? If yes, you don't have a gate; you have a suggestion. The server action is the gate.

This is why Lesson 10.3 builds client-side UI *on top of* the server gate, not instead of it. UI makes the paid tier's value visible and the free tier's walls polite. The server makes the walls real.

### Fail-closed posture

Every error branch in the action returns `fail(...)` — we never silently proceed when something unexpected happens. The count query errors? 500, don't insert. The subscription helper throws? 500, don't insert. The Zod parse fails? 400, don't insert.

The alternative — "if we can't verify, assume paid" — is the move that breaks SaaS. A DB hiccup on Tuesday afternoon becomes "all free users bypass limits for 20 minutes." The uncharitable user finds out first. Default to "no" when you can't prove "yes."

### Telemetry on "hit the cap"

Every time the 403 branch fires, log it:

```typescript
console.log({ event: 'free_tier_limit_hit', userId: user.id, count })
```

That event has two uses:

1. **Product metric.** How many users hit the cap per week? Are they the same users repeatedly? That's your total addressable upgrade population.
2. **Upgrade-intent signal.** A user who hits the cap and doesn't upgrade within 24 hours is a target for a follow-up email. "You're running into limits — here's 20% off your first month." Conversion teams live for signals like this.

Wire it to your telemetry backend (PostHog, Segment, or just structured logs plus a daily SQL query) as a first-class event. "Upgrade-intent events" is usually the highest-signal funnel stage between "signed up" and "paid."

Important: don't spam the event. A user who hits the cap and retries the form five times should generate one event per session, not five. Add a simple server-side dedupe (hash of `userId + day`) or let your analytics platform dedupe.

### The atomicity caveat

Strictly, the count-then-insert sequence has a race condition: a user could submit two create-contact requests in parallel, both pass the count check (say, count reads 9 for both), and both inserts succeed — leaving the user with 11 contacts.

For our scale and UX (users clicking a submit button), this race is essentially zero probability. If we wanted to harden it, the right move is a database-side check: a `CHECK` constraint plus a trigger, or a stored function that does count-and-insert in one transaction. That's Module 11+ material; the business value of closing the race is low. Know the tradeoff; don't over-engineer.

### Graceful downgrades

What about existing users? A user who had 50 contacts while subscribed, then cancels, suddenly has 40 "extra" contacts in the database. Our action correctly prevents them from creating a 51st — but the 50 remain visible.

Contactly's policy: **downgrades don't delete data.** The user keeps read access to their old contacts; they just can't add new ones or edit past the 10-limit (depending on how strict you want edit-mode to be). It's a generous policy, it avoids angry support tickets, and it leaves an obvious re-upgrade carrot. Stripe, Notion, Linear all do some variant of this.

The alternative — "on cancel, archive everything past the free tier" — is technically cleaner but creates churn-rage support tickets. Not recommended.

### Feature flags vs billing gates

Some features will be gated by billing (this lesson). Others will be gated by feature flags (modules 11+). They look similar but have different lifetimes:

- **Billing gates** are long-lived and tied to Stripe subscription state.
- **Feature flags** are short-lived A/B tests or rollout controls.

Don't share the same plumbing for both. `hasActiveSubscription(userId)` is for billing. A separate `isFeatureEnabled(userId, 'new-dashboard')` (which you'd build later with LaunchDarkly or a home-rolled table) is for flags. Conflating them creates nightmare refactors when you migrate flag systems.

---

## Summary

- Built a server-side gate in `+page.server.ts` that checks `hasActiveSubscription` and counts existing contacts.
- Short-circuited the count for paid users — they never pay the query.
- Used `{ count: 'exact', head: true }` for an accurate, cheap count.
- Returned `fail(403, { upgradeRequired: true, upgradeUrl })` with enough structure for the UI to render a proper upgrade CTA.
- Redirected to `/pricing?upgrade=true` for a marketing-aware upgrade flow.
- Understood that client-side UI never substitutes for server-side enforcement.
- Established fail-closed semantics and observability hooks on cap events.

## What's Next

Lesson 10.3 turns the server-side gate into a polished UI: upgrade prompts overlaid on disabled buttons, a "9/10 contacts used" banner, and the `$derived` pattern for computed access state. We'll build the `UpgradePrompt` component and talk about why showing the locked feature converts better than hiding it.
