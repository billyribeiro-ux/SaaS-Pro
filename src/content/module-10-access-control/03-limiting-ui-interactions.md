---
title: "10.3 - Limiting UI Interactions"
module: 10
lesson: 3
moduleSlug: "module-10-access-control"
lessonSlug: "03-limiting-ui-interactions"
description: "Show upgrade prompts for locked features rather than hiding them — users should see what they're missing."
duration: 12
preview: false
---

## Overview

The server-side gate from Lesson 10.2 is airtight — a free user literally cannot create their 11th contact, no matter how hard they try. But the UX is ugly. The user types in the form, submits, and only then learns they've hit a limit. That's a frustration event, and frustration events churn users.

This lesson fixes the UI side. We'll:

1. Fetch the user's subscription status in a layout `load` so every page in the app can see it.
2. Build an "upgrade overlay" pattern that **shows** the paid feature (visibly disabled) with a CTA on top.
3. Use `$derived` to compute per-page access state reactively from page data.

The crucial philosophical move: **we don't hide paid features. We show them, make them look expensive, and put an upgrade CTA in front.** That's the opposite of "if you can't use it, we'll pretend it doesn't exist." Your users can't want what they can't see.

Throughout this lesson we stay disciplined about defense-in-depth: every UI lock has a matching server lock (Lesson 10.2). The UI is the marketing surface; the server is the enforcement.

## Prerequisites

- Lesson 10.1 complete — `hasActiveSubscription()` available in `$lib/utils/access.ts`.
- Lesson 10.2 complete — the create-contact action enforces the limit server-side.
- Root `(app)` layout exists and has a `+layout.server.ts` (or we'll create one).

## What You'll Build

- A `+layout.server.ts` for the `(app)` group that loads `isSubscribed` into page data.
- An `UpgradePrompt.svelte` component that overlays an upgrade CTA on a disabled interactive element.
- A reusable pattern on the contacts list page: wrap the "Add Contact" button with the prompt when the user is unsubscribed.
- A "contacts used" counter banner that surfaces usage before the user hits the cap.

---

## Step 1: Load `isSubscribed` Once, Use It Everywhere

Every protected page needs to know: is this user subscribed? If we answer that question in every `+page.server.ts` individually, we'll pay N DB round-trips for N pages and duplicate the code N times. Layouts to the rescue.

Create (or edit) `src/routes/(app)/+layout.server.ts`:

```typescript
// src/routes/(app)/+layout.server.ts
import { redirect } from '@sveltejs/kit'
import { hasActiveSubscription } from '$lib/utils/access'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = await locals.getUser()
  if (!user) redirect(303, '/login')

  const isSubscribed = await hasActiveSubscription(user.id)

  return {
    user: { id: user.id, email: user.email },
    isSubscribed
  }
}
```

### What the layout load does for us

- **Runs on every page in `(app)`.** The load function for `+layout.server.ts` executes for every child route. So `/contacts`, `/contacts/new`, `/dashboard`, `/settings` — they all have access to `data.isSubscribed` without re-running the check.
- **Single source of truth.** If a page had its own load function that also called `hasActiveSubscription`, we'd have two calls per request. The layout version feeds the whole tree.
- **Automatic typing.** SvelteKit generates `LayoutServerLoad` and downstream `PageData` types; `isSubscribed: boolean` is available on every child page's `data` prop for free.
- **Runs on navigation too.** When the user navigates between pages, the load re-runs (subject to SvelteKit's invalidation rules). So if the user just completed checkout on a different tab, a navigation event will pick up the new state.

**Important caveat on caching.** SvelteKit may cache the layout's data across navigations if nothing invalidates it. If you want the subscription status to refresh after a checkout, you'd either:

1. Call `invalidate('app:subscription')` after the checkout completes, and call `depends('app:subscription')` in this load.
2. Return `depends('app:subscription')` in the load and invalidate on billing webhook replay.

For Module 10 we accept that the status updates on the next full navigation; invalidation tuning is a Module 13 topic.

---

## Step 2: The `UpgradePrompt` Component Pattern

The pattern we're building is called the **overlay lock**. It looks like this when a feature is gated:

- The original UI (button, link, card) is rendered, but **visually disabled** — grayed out, reduced opacity, a "do not enter" cursor.
- A translucent overlay sits on top, carrying a single message: "Upgrade to unlock this" with a CTA button linking to `/pricing`.
- Clicks on the overlay bring the user to pricing; clicks on the underlying disabled element are inert.

Why not hide it? Because the most important thing a SaaS product can do is make its value visible. A free user who sees "Add Contact" sitting right there, locked, knows exactly what they'd get if they paid. A free user who never sees the button doesn't know they're missing anything.

Let's build the simplest version. Create `src/routes/(app)/contacts/+page.svelte` (or edit your existing one):

```svelte
<!-- src/routes/(app)/contacts/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let isSubscribed = $derived(data.isSubscribed)

  function createContact() {
    // open create-contact modal or navigate
  }
</script>

{#if isSubscribed}
  <button onclick={createContact}>Add Contact</button>
{:else}
  <div class="relative">
    <button disabled class="opacity-50 cursor-not-allowed">Add Contact</button>
    <div class="absolute inset-0 flex items-center justify-center bg-white/80">
      <a href="/pricing" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
        Upgrade to add unlimited contacts →
      </a>
    </div>
  </div>
{/if}
```

### Walkthrough

#### The script block

```typescript
import type { PageData } from './$types'

let { data }: { data: PageData } = $props()

let isSubscribed = $derived(data.isSubscribed)
```

- **`PageData`** — SvelteKit merges all upstream load returns (root layout, `(app)` layout, the page's own load) into this type. Because our layout load returned `{ user, isSubscribed }`, `PageData` now includes `isSubscribed: boolean` automatically.
- **`let { data }: { data: PageData } = $props()`** — Svelte 5 runes-style props read. No `export let`. The type annotation tells TypeScript the shape.
- **`let isSubscribed = $derived(data.isSubscribed)`** — `$derived` is the Svelte 5 rune for computed values. It re-evaluates whenever `data.isSubscribed` changes. Why not just use `data.isSubscribed` inline? Two reasons: (a) it's easier to read in the template as `isSubscribed` than `data.isSubscribed`; (b) if the computation ever gets more complex (e.g., `$derived(data.isSubscribed && !data.banned)`), the site of change is one line instead of N template spots.

#### The gated branch

```svelte
{#if isSubscribed}
  <button onclick={createContact}>Add Contact</button>
{:else}
  <div class="relative">
    <button disabled class="opacity-50 cursor-not-allowed">Add Contact</button>
    <div class="absolute inset-0 flex items-center justify-center bg-white/80">
      <a href="/pricing" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
        Upgrade to add unlimited contacts →
      </a>
    </div>
  </div>
{/if}
```

Three CSS moves:

1. **Outer container `relative`.** This establishes a positioning context so the overlay can absolute-position to its edges.
2. **Inner `<button disabled class="opacity-50 cursor-not-allowed">`.** Disabled buttons render with reduced opacity and ignore click events. We add `cursor-not-allowed` so hover feedback confirms "this doesn't work."
3. **Overlay `div.absolute.inset-0.flex.items-center.justify-center.bg-white/80`.** Covers the entire parent container with a semi-transparent white film (`bg-white/80` is Tailwind for `rgba(255,255,255,0.8)`) and centers a CTA link inside. The overlay sits on top in DOM order, which in the flow of `absolute inset-0` places it above the disabled button.

The user sees the "Add Contact" button through the translucent film, with the upgrade CTA centered on top. Click the CTA: you're on `/pricing`. Click anywhere else in the block: nothing happens.

#### `onclick={createContact}` — Svelte 5 event syntax

Notice the onclick attribute rather than the legacy `on:click`. Svelte 5 unified DOM event attributes with standard HTML syntax (plus some enhancements for modifiers). This is the version to use going forward.

---

## Step 3: Extracting the Pattern into a Reusable Component

Hardcoding the overlay in every place we gate is going to get old fast. Let's extract it.

Create `src/lib/components/UpgradePrompt.svelte`:

```svelte
<!-- src/lib/components/UpgradePrompt.svelte -->
<script lang="ts">
  type Props = {
    message?: string
    ctaLabel?: string
    href?: string
    children: import('svelte').Snippet
  }

  let {
    message = 'Upgrade to unlock',
    ctaLabel = 'Upgrade to Pro →',
    href = '/pricing',
    children
  }: Props = $props()
</script>

<div class="relative inline-block">
  <div class="opacity-50 pointer-events-none">
    {@render children()}
  </div>
  <div
    class="absolute inset-0 flex flex-col items-center justify-center bg-white/80 rounded-lg gap-2"
  >
    <p class="text-sm text-gray-700 font-medium">{message}</p>
    <a
      {href}
      class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
    >
      {ctaLabel}
    </a>
  </div>
</div>
```

### What's new here

- **`children: import('svelte').Snippet`** — Svelte 5's snippet type. A `Snippet` is a renderable chunk of markup passed as a prop. It replaces the old `<slot />` API.
- **`{@render children()}`** — renders the snippet at this location.
- **`.pointer-events-none`** — disables clicks on the children entirely. A disabled `<button>` ignores clicks natively, but any interactive element (link, input) wouldn't. `pointer-events-none` is belt-and-suspenders.
- **`inline-block`** — so the component wraps only its children, not the full row.

### Using the component

```svelte
<script lang="ts">
  import UpgradePrompt from '$lib/components/UpgradePrompt.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let isSubscribed = $derived(data.isSubscribed)
</script>

{#if isSubscribed}
  <a href="/contacts/new" class="bg-blue-600 text-white px-4 py-2 rounded-lg">
    Add Contact
  </a>
{:else}
  <UpgradePrompt message="You've hit your free plan cap" ctaLabel="Upgrade →">
    <span class="bg-blue-600 text-white px-4 py-2 rounded-lg inline-block">
      Add Contact
    </span>
  </UpgradePrompt>
{/if}
```

The CTA children style themselves as a button; the component handles the overlay, the opacity, the pointer-events, the CTA link. Any locked feature in the app gets this pattern in three lines.

---

## Step 4: The "Usage Counter" Pattern

Showing "9 of 10 contacts used" is more motivating than waiting for the cap and slamming the door. Let's surface it.

In the contacts list page's load:

```typescript
// src/routes/(app)/contacts/+page.server.ts
import type { PageServerLoad } from './$types'

const FREE_TIER_LIMIT = 10

export const load: PageServerLoad = async ({ locals, parent }) => {
  const { isSubscribed } = await parent()
  const user = await locals.getUser()

  const { data: contacts, count } = await locals.supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  return {
    contacts: contacts ?? [],
    contactCount: count ?? 0,
    freeTierLimit: FREE_TIER_LIMIT,
    showUsage: !isSubscribed
  }
}
```

In the page:

```svelte
<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let remaining = $derived(data.freeTierLimit - data.contactCount)
  let atCap = $derived(data.contactCount >= data.freeTierLimit)
</script>

{#if data.showUsage}
  <div
    class="mb-4 rounded-lg p-3 text-sm"
    class:bg-amber-50={atCap}
    class:text-amber-900={atCap}
    class:bg-gray-50={!atCap}
    class:text-gray-600={!atCap}
  >
    {#if atCap}
      You've used all {data.freeTierLimit} contacts on your free plan.
      <a href="/pricing" class="underline font-medium">Upgrade</a> for unlimited.
    {:else}
      {data.contactCount} of {data.freeTierLimit} contacts used.
      {remaining} remaining on the free plan.
    {/if}
  </div>
{/if}
```

The `$derived` rules do the math: `remaining` is a number, `atCap` is a boolean, both recompute when `data.contactCount` changes. The template branches on `atCap` to switch colors and copy. Subscribed users see nothing — `data.showUsage` is `false`.

This pattern turns the free tier into a progress bar. Users watch the count climb and feel the ceiling approaching. Many of them will upgrade at contact 8 or 9, not contact 11. That's a meaningfully different conversion shape than hard-stopping them at 10.

---

## Step 5: Defense-in-Depth, Not UI-Instead-of-Server

Re-read Lesson 10.2's server action. Now look at this lesson's UI. Notice we have two gates for the same rule:

- **Server gate** (10.2): `if ((count ?? 0) >= FREE_TIER_LIMIT) return fail(403, ...)`.
- **UI gate** (10.3): `{#if isSubscribed}...{:else}<UpgradePrompt>...{/if}`.

Both must exist. Neither substitutes for the other.

- **The server gate is the lock.** Bypass the UI (curl the endpoint), bypass the browser (modify the JS), bypass caching (stale client state) — the server gate holds.
- **The UI gate is the marketing surface.** It makes the paid value visible, turns every denial into a conversion opportunity, and gives users who'd pay the on-ramp.

A pure server gate with no UI gate is a locked door with no sign. Users bump into it and bounce off. A pure UI gate with no server gate is a sign with no lock — users who ignore the sign walk right through.

---

## Step 6: Testing the UI

1. Log in as an unsubscribed user. Visit `/contacts`.
2. If you have fewer than 10 contacts: the "Add Contact" CTA works; you see "N of 10 contacts used" in gray.
3. If you have 10 contacts: the CTA is overlaid with an upgrade prompt; the usage banner is amber and says "You've used all 10."
4. Log in as a subscribed user. Visit `/contacts`.
5. No usage banner. The "Add Contact" CTA is fully enabled and unstyled.

Then poke at it a little. Open the `/contacts` page in two tabs. Complete a checkout in one tab. Navigate the other tab to `/settings`. When you navigate back to `/contacts`, the banner should be gone — the layout load re-ran and fetched fresh status.

---

## Common Mistakes

- **Using `{#if !isSubscribed}{/if}` to hide locked features.** The user never sees what they're missing; the pricing page sees zero traffic. Replace hiding with overlaying.
- **Forgetting `pointer-events-none` on the wrapper.** The disabled children still intercept clicks; the overlay's CTA becomes uncliсkable in some layouts.
- **Hardcoding `/pricing` in ten places.** When your pricing page moves to `/billing/pricing`, you edit ten files. Make `href` a prop on `UpgradePrompt`.
- **Computing `isSubscribed` separately in every component.** Pull it from the layout's page data via `$derived(data.isSubscribed)` and forget it; don't call the helper from client code (it's server-only anyway).
- **Forgetting that `$derived` has no side effects.** If you write `$derived(trackAnalytics(data.isSubscribed))`, you'll call the analytics function every re-render. For side effects, use `$effect`.
- **Trusting the client-side `isSubscribed` flag for actual enforcement.** A modified client could set it to `true` locally. The value in `data.isSubscribed` is rendered at request time from the server; a tampered browser can display "paid" UI but can't actually pass server checks. Harmless, but know it.
- **Running the layout load on anonymous routes.** If you put this load in the root layout, it runs on `/login` too, and the `locals.getUser()` → `null` → `redirect(303, '/login')` creates a loop. Scope it to the `(app)` group, which is for authenticated users only.

---

## Principal Engineer Notes

### Show the locked feature — it's a conversion lever

The standard wisdom in early-stage SaaS is "don't confuse users with features they can't use; hide paid stuff." That's wrong for most products. Here's the data-informed reasoning:

- A user who never sees a feature has no reason to upgrade for it. You're invisible.
- A user who sees it and is blocked knows exactly what $X/month buys them. You're tangible.
- A user who sees the locked feature, hits the overlay, reads the CTA, and clicks through is 5–10x more likely to convert than a user who randomly navigates to `/pricing`.

This is why Slack shows message-history limits, Notion shows AI-feature counts, and Linear shows "Pro" badges on features inside the product. The free tier is the most lucrative ad space in the product.

Caveat: you can overdo this. If half the UI is grayed out with overlays, it feels like a demo, not a product. The rule of thumb: the free tier should be **useful on its own**, with a small number of obvious upgrade moments. Not a catalog.

### Defense-in-depth, in one line

The lesson is: *UI locks are marketing; server locks are security.* If you can only afford one, always build the server lock first. Then layer UI on top.

A year into Contactly's life, when a contractor adds a new locked feature, the rule to give them is: "If you put a `<UpgradePrompt>` in the UI, there must be a matching `hasActiveSubscription` check in the server action. No exceptions." Codify it in code review. Test for it. Every leak in a SaaS app starts with someone adding the UI side and forgetting the server side.

### Feature flags vs billing-gated features

These look the same in the UI layer — an `{#if hasAccess}...{:else}<Gate>{/if}` block — but they diverge in the data layer and the reasoning layer.

- **Billing gates** check subscription status. Long-lived. Tied to Stripe.
- **Feature flags** check a key/value store or experiment service. Short-lived. Tied to rollouts or A/B tests.

The mistake is wiring them through the same system. `access.ts` is for billing. If you want a feature-flag system, build `$lib/utils/flags.ts` — separate file, separate abstraction. Conflating them means every time you want to roll out a non-paid feature (a new dashboard, a beta), you either have to pretend it's gated by billing or build flags on top of billing.

Build them separately. You'll thank yourself when one changes (billing via Stripe Catalog change; flags via LaunchDarkly migration) and the other doesn't.

### When to skip the overlay

Some features don't want the overlay pattern. Specifically:

- **Destructive operations.** "Delete all contacts" shouldn't have an upgrade prompt — it's not a feature to sell. Hide it or keep it for all users.
- **Admin-only tools.** Users aren't supposed to see these; they're gated by role, not billing.
- **Features that are core-brand harmful.** If showing users a locked "export as CSV" makes your product look like a crippleware-infested nightmare, skip the overlay and just put it in a Pro section of the settings page.

Use the overlay where there's an obvious value exchange: this feature is valuable, and paying gets it. Don't use it to taunt users with things they don't want.

### Accessibility notes

The overlay pattern we built has two a11y gotchas:

1. **Screen readers read both the disabled children and the overlay.** That's confusing. Add `aria-hidden="true"` to the disabled children wrapper so screen readers only narrate the CTA.
2. **Keyboard navigation can tab into the disabled button.** Add `tabindex={-1}` to the wrapper, or use `inert` (supported in modern browsers) on the wrapper to exclude it from all interactive surfaces.

A polished final version of `UpgradePrompt`:

```svelte
<div class="relative inline-block">
  <div class="opacity-50 pointer-events-none" aria-hidden="true" inert>
    {@render children()}
  </div>
  <!-- overlay -->
</div>
```

We'll tighten a11y more rigorously in Module 13.

---

## Summary

- Loaded `isSubscribed` in `(app)/+layout.server.ts` so every authenticated page has access.
- Built an overlay-lock pattern that shows the paid feature, disabled, under an upgrade CTA.
- Extracted the overlay into a reusable `UpgradePrompt.svelte` component using Svelte 5 snippets.
- Added a usage counter ("7 of 10 contacts used") that surfaces the cap before users hit it.
- Used `$derived` for computed access state in page components.
- Internalized defense-in-depth: UI gates are the marketing surface, server gates are the security layer — both required.

## What's Next

Lesson 10.4 closes the last gap in our access control: preventing users who already have an active subscription from starting a *second* checkout. We'll gate the checkout endpoint, route existing subscribers to the Stripe customer portal instead, and swap the pricing page CTA from "Subscribe" to "Manage subscription."
