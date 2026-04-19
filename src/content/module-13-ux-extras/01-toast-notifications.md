---
title: "13.1 - Toast Notifications"
module: 13
lesson: 1
moduleSlug: "module-13-ux-extras"
lessonSlug: "01-toast-notifications"
description: "Build a toast notification system using Svelte 5 reactive class pattern."
duration: 12
preview: false
---

## Overview

Contactly works. You can register, log in, manage contacts, pay for Pro, and see your billing portal. But there's one missing ingredient that separates a tech-demo from a product: **feedback**. When a user saves a contact, upgrades their plan, or deletes something, the page should acknowledge it. Right now we silently navigate to the next screen and leave the user wondering whether anything happened at all.

Inline errors are fine — when something goes wrong on a form, we already render a red banner in place. But **success** doesn't belong inline. A green "Contact saved" banner that sits in the form after the redirect is awkward, stays too long, and clutters the layout. The industry-standard answer is a **toast**: a little card that slides in from a corner, lingers for a few seconds, and fades away on its own.

In this lesson we'll build one using Svelte 5's new reactive primitives. You'll meet the `.svelte.ts` file extension, the class-based store pattern that replaces pre-runes `writable()` stores, and the `crypto.randomUUID()` API that gives us globally-unique toast IDs for free.

## Prerequisites

- Module 12 complete — billing works end-to-end, the app deploys via CI/CD, and you have a live Contactly running.
- Comfortable with Svelte 5 runes: `$state`, `$props`, `$derived`, `$effect`.

## What You'll Build

- A `ToastStore` class in `src/lib/stores/toast.svelte.ts` with `$state`-backed toast list and `add` / `dismiss` methods.
- A `ToastContainer.svelte` component that renders every active toast with `fly` / `fade` transitions.
- A root-layout integration so every page in Contactly gets toasts for free.
- Integration with form actions via `page.form` flash messages — one keystroke in your action becomes a toast on the next render.

---

## Why a Separate Notification Channel at All?

Look at the Contactly flows we've already built:

- **Contact create:** form submits → redirect to `/contacts` → list appears. Did the contact save? Probably, since we're back on the list. But there's no explicit confirmation.
- **Subscription upgrade:** Stripe webhook fires → Pro is provisioned → user returns to the app. Are they Pro yet? They have to click around to find out.
- **Account deletion:** user clicks delete → redirect to `/` → account gone. But the user never sees "Your account has been deleted" — they just see the marketing page and wonder whether the click even registered.

Every one of these needs a brief, non-blocking acknowledgement. Not a modal — modals demand action and interrupt the flow. Not an inline banner — those stick around after the content has moved on. The answer is a **toast**: a piece of ephemeral UI that appears, lingers, and disappears.

The core contract of a toast is:

1. It appears anywhere on the page without disrupting layout (absolute-positioned).
2. It has a message and a type (success / error / info).
3. It auto-dismisses after a few seconds so the user doesn't have to close it.
4. It can be manually dismissed if the user wants to.
5. Multiple toasts stack — firing five in a row doesn't clobber each other.

That list is the spec. Everything below is implementation.

---

## Step 1: The `.svelte.ts` File Extension

Svelte 5 introduced a new file extension: `.svelte.ts`. These are not component files — they're plain TypeScript modules with one special power: **they can use runes**.

Here's the rule. Runes like `$state`, `$derived`, and `$effect` are compile-time transformations. They only work in files the Svelte compiler processes. `.svelte` files are processed by the compiler (obviously). Plain `.ts` files are **not** — Vite sends them through TypeScript's transpiler, which doesn't know about runes. If you write `$state([])` in `toast.ts`, you'll get a runtime error: "`$state` is not defined."

`.svelte.ts` (and its cousin `.svelte.js`) tell Vite: "this file uses runes, send it through the Svelte compiler first." The compiler rewrites `$state`, `$derived`, and `$effect` into reactive signals, then hands the result to TypeScript for type-checking.

**Rule of thumb:** any file outside a `.svelte` component that uses runes needs the `.svelte.ts` extension.

This matters because it unlocks a pattern the old Svelte 4 world couldn't express cleanly: **reactive classes**. In Svelte 4 you'd reach for `writable()` from `svelte/store` and wire up `.subscribe()` / `.set()` / `.update()`. In Svelte 5 you write a plain TypeScript class with `$state` fields, and it Just Works.

---

## Step 2: The Toast Store

Create the file `src/lib/stores/toast.svelte.ts`:

```typescript
// src/lib/stores/toast.svelte.ts
type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

class ToastStore {
  toasts = $state<Toast[]>([])

  add(message: string, type: ToastType = 'info') {
    const id = crypto.randomUUID()
    this.toasts = [...this.toasts, { id, message, type }]

    setTimeout(() => this.dismiss(id), 3000)
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id)
  }
}

export const toast = new ToastStore()
```

That's the whole store. Let's walk through it line by line.

### `type ToastType = 'success' | 'error' | 'info'`

A union of three string literals. Exhaustive: a toast can only ever be one of these three types. This prevents `toast.add('Saved', 'succes')` (typo) from ever compiling.

We keep the palette small on purpose. Real apps tend to accumulate toast types — `warning`, `loading`, `debug`, `urgent`, `birthday` — and the visual language degrades. Three types map to three colors (green, red, gray). Three is enough.

### `interface Toast`

Each toast has an `id`, a `message`, and a `type`. The `id` is what lets us identify a specific toast for dismissal — we can't just say "dismiss the third one" because other toasts may have been added or removed in the meantime.

### `class ToastStore`

A plain TypeScript class. Nothing special yet.

### `toasts = $state<Toast[]>([])`

Here's where the magic happens. `$state` wraps the initial value `[]` in a Svelte 5 **reactive proxy**. Any time you read `toastStore.toasts` inside a component, Svelte tracks the dependency. Any time you reassign `toastStore.toasts = ...`, every dependent piece of UI re-renders.

The `<Toast[]>` generic parameter tells TypeScript the array holds `Toast` objects — unrelated to reactivity, just type safety.

**Why a class and not a module-level `$state`?** You could write:

```typescript
// NOT what we do
export const toasts = $state<Toast[]>([])
export function add(message: string, type: ToastType = 'info') { /* ... */ }
export function dismiss(id: string) { /* ... */ }
```

And that would work. But a class gives us three things that module-level globals don't:

1. **Encapsulation.** `toasts` is a field on an instance; external code can read it but the `add`/`dismiss` methods are the blessed mutators. No random code is going to `import { toasts }` and do `toasts.push(...)` — they'd get a type error because `toasts` is typed as readonly from outside.
2. **A natural unit of refactoring.** Tomorrow we might add a second toast surface for the admin panel. Two instances of `ToastStore` give us two independent toast streams with no code duplication.
3. **It matches the wider Svelte 5 idiom.** The Svelte team has pushed classes with `$state` fields as the canonical store pattern. Libraries are starting to ship `.svelte.ts` modules exporting class instances — you'll recognize the shape everywhere.

### `add(message, type = 'info')`

The producer method. Three things happen:

```typescript
const id = crypto.randomUUID()
this.toasts = [...this.toasts, { id, message, type }]
setTimeout(() => this.dismiss(id), 3000)
```

- `crypto.randomUUID()` — a Web Crypto API function available in all modern browsers and in Node 19+. Returns a v4 UUID string. Globally unique with astronomical probability, zero dependencies, zero setup. Perfect for our needs.
- `this.toasts = [...this.toasts, { id, message, type }]` — we create a **new array** with the old toasts plus the new one, and assign it to `this.toasts`. This triggers Svelte's reactivity. We don't `push()` because mutation on a `$state` proxy works too, but creating a new array makes the intent obvious and plays nicely with any future `$derived` chains that might depend on `toasts`.
- `setTimeout(() => this.dismiss(id), 3000)` — schedule auto-dismiss in 3 seconds. We pass the specific `id` captured in the closure, not "the last toast" or similar fragile logic. If three more toasts are added before this one expires, we still dismiss exactly the right one.

Three seconds is the industry convention — long enough to read a short message, short enough not to linger after the user has moved on. Adjust if your messages are longer; don't go above 6 seconds without accessibility review.

### `dismiss(id)`

```typescript
dismiss(id: string) {
  this.toasts = this.toasts.filter((t) => t.id !== id)
}
```

Filter out the toast with the matching id. If the id isn't found (e.g., the user already manually dismissed it before the `setTimeout` fired), `filter` returns an array without that id — which is just the array unchanged. Idempotent. Safe to call twice.

### `export const toast = new ToastStore()`

We export a single module-level instance. Import `toast` anywhere in the app and you're operating on the same singleton. This is the one place singletons are the right pattern — toasts are intrinsically a UI-wide concept and there's exactly one channel.

---

## Step 3: The `ToastContainer` Component

Create `src/lib/components/ToastContainer.svelte`:

```svelte
<!-- src/lib/components/ToastContainer.svelte -->
<script lang="ts">
  import { fly, fade } from 'svelte/transition'
  import { toast } from '$lib/stores/toast.svelte'
</script>

<div
  class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
  role="status"
  aria-live="polite"
>
  {#each toast.toasts as t (t.id)}
    <div
      class="pointer-events-auto rounded-lg px-4 py-3 shadow-lg text-sm font-medium flex items-center gap-3 min-w-[280px]"
      class:bg-green-600={t.type === 'success'}
      class:bg-red-600={t.type === 'error'}
      class:bg-gray-800={t.type === 'info'}
      in:fly={{ x: 300, duration: 200 }}
      out:fade={{ duration: 150 }}
    >
      <span class="text-white flex-1">{t.message}</span>
      <button
        type="button"
        class="text-white/70 hover:text-white"
        onclick={() => toast.dismiss(t.id)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  {/each}
</div>
```

### The outer container

```svelte
<div
  class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
  role="status"
  aria-live="polite"
>
```

Let's unpack each utility:

- `fixed top-4 right-4` — anchored to the top-right corner of the viewport. As the user scrolls, toasts stay in place. You could pick any corner (top-right and bottom-right are the two industry-standard options). Top-right keeps toasts near the eye-level where users scan notifications.
- `z-50` — elevated above the rest of the page. If you have modals that use a higher `z-index`, put toasts even higher (z-[100]) so they render on top of modal overlays.
- `flex flex-col gap-2` — new toasts stack vertically with small gaps between them.
- `pointer-events-none` — critical detail. The container spans a region of the page. Without this, it'd block clicks on anything it covers even when it's empty. We turn pointer events off on the container and back on (`pointer-events-auto`) on each toast. This way the empty space is click-through but the toasts themselves are interactive.
- `role="status"` and `aria-live="polite"` — screen-reader accessibility. When a new toast is inserted into this container, `aria-live="polite"` tells assistive tech "read this out to the user when you get a chance, but don't interrupt them if they're in the middle of something." `role="status"` is the ARIA role for a non-urgent advisory. For error toasts in a login flow you might swap to `aria-live="assertive"` — but the polite default is right for 95% of cases and doesn't harass users.

### The each block

```svelte
{#each toast.toasts as t (t.id)}
```

Each block with a **keyed iterator** `(t.id)`. The key is mandatory for transitions: Svelte uses it to track which DOM node corresponds to which toast across renders. Without a key, when toast A dismisses and toast B slides up, Svelte might reuse A's DOM for B's content, and the transition animates the wrong thing.

### Transitions

```svelte
in:fly={{ x: 300, duration: 200 }}
out:fade={{ duration: 150 }}
```

- `in:fly={{ x: 300, duration: 200 }}` — when a toast enters, it slides in from 300px to the right of its final position over 200ms. That creates the "slide in from the right edge" feel.
- `out:fade={{ duration: 150 }}` — when a toast exits, it fades out over 150ms. Faster than the entrance on purpose — users notice arrivals more than departures, so we spend the animation budget where it matters.

Svelte's `svelte/transition` module is one of the framework's killer features — these are declarative, GPU-accelerated animations with no Framer Motion-style library bloat.

### The dismiss button

```svelte
<button
  type="button"
  class="text-white/70 hover:text-white"
  onclick={() => toast.dismiss(t.id)}
  aria-label="Dismiss"
>
  ×
</button>
```

- `type="button"` — stops the button from submitting a form if it ever ends up inside one.
- `onclick={() => toast.dismiss(t.id)}` — calls dismiss with the exact id of this toast. Svelte 5 uses property-style event handlers (`onclick`, not `on:click`). Same idea, cleaner syntax.
- `aria-label="Dismiss"` — the visible content is `×`, which screen readers read as "times" or skip entirely. The aria-label tells assistive tech what the button does.

---

## Step 4: Wire It Into the Root Layout

Open `src/routes/+layout.svelte` and add the container so it's always mounted:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css'
  import ToastContainer from '$lib/components/ToastContainer.svelte'

  let { children } = $props()
</script>

{@render children()}

<ToastContainer />
```

The container sits as a sibling of `{@render children()}`. Because it's `position: fixed`, it doesn't affect the document flow — it just hovers over the viewport, ready to display any toasts that get pushed to the store. Mount once, use from anywhere.

---

## Step 5: Firing Toasts from Code

Once the container is mounted, firing a toast is a one-liner from any component:

```svelte
<script lang="ts">
  import { toast } from '$lib/stores/toast.svelte'
</script>

<button onclick={() => toast.add('Contact saved', 'success')}>Save</button>
```

That works for any client-side event. But our actual use case is subtler: we want to fire toasts **after a server action completes**. The user submits a form, the server processes it, we redirect, and on the next page we want a toast to appear.

---

## Step 6: Flash Messages via `page.form`

SvelteKit's form-action system already gives us `page.form` — the object returned from the most recent form action. We can attach a `flash` field to it and have the layout turn it into a toast automatically.

First, update a form action. Here's an example from the contact-create flow:

```typescript
// src/routes/(app)/contacts/new/+page.server.ts
import { redirect } from '@sveltejs/kit'

export const actions = {
  default: async ({ request, locals }) => {
    // ... validation + insert ...

    redirect(303, '/contacts?flash=contact-created')
  }
}
```

The simplest pattern: redirect with a query param the next page reads. Then the destination's load function converts it to a flash:

```typescript
// src/routes/(app)/contacts/+page.server.ts
export const load = async ({ url, locals }) => {
  const flash = url.searchParams.get('flash')
  // ... existing contact loading ...
  return {
    contacts,
    flash: flash === 'contact-created'
      ? { message: 'Contact saved', type: 'success' as const }
      : null
  }
}
```

And in the layout we pick up any `data.flash` and push it to the toast store:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css'
  import ToastContainer from '$lib/components/ToastContainer.svelte'
  import { page } from '$app/state'
  import { toast } from '$lib/stores/toast.svelte'

  let { children } = $props()

  let lastFlash: string | null = $state(null)

  $effect(() => {
    const flash = page.data.flash as
      | { message: string; type: 'success' | 'error' | 'info' }
      | null
      | undefined
    if (flash && flash.message !== lastFlash) {
      lastFlash = flash.message
      toast.add(flash.message, flash.type)
    }
  })
</script>

{@render children()}

<ToastContainer />
```

The `$effect` watches `page.data.flash`. When it changes to a non-null value we haven't seen before, we push a toast. The `lastFlash` guard prevents re-firing if the component re-renders for unrelated reasons. We read `page` from `$app/state`, the Svelte 5 replacement for the deprecated `$app/stores` `page` store.

---

## Testing the System

```bash
pnpm dev
```

1. Navigate to `/contacts/new`. Fill the form. Submit.
2. On redirect to `/contacts`, a green "Contact saved" toast slides in from the right and vanishes after 3 seconds.
3. Click the × on a toast before it auto-dismisses. It fades out instantly.
4. Rapid-fire: add a console button that calls `toast.add('Hi', 'info')` three times in a row. Three toasts stack.
5. Keyboard test: tab to a toast's dismiss button and hit Enter. Focus management works.

Accessibility spot-check: turn on your OS screen reader (VoiceOver on macOS, NVDA on Windows) and fire a toast. You should hear the message announced politely, without interrupting whatever else is being read.

---

## Common Mistakes

- **Naming the store file `toast.ts` instead of `toast.svelte.ts`.** Runes don't work; you get "$state is not defined." Rename it.
- **Using `toast.toasts.push(...)` inside `add`.** Works, but paired with stale closures or non-runes code it gets confusing. We reassign with a new array to make the reactivity obvious.
- **Forgetting the `(t.id)` key in `{#each}`.** Transitions animate the wrong toast when entries shift. Always key lists that mount/unmount.
- **Mounting `<ToastContainer />` inside a route layout instead of the root.** Navigating between sibling routes in the same group keeps the container alive — but navigating across group layouts tears it down and your toast disappears mid-slide. Root layout only.
- **Putting `aria-live="assertive"` on every toast.** Screen readers interrupt whatever they're reading to announce the toast. Fine for errors; annoying for "Saved." Default to polite.
- **Not deduplicating flash messages.** Without the `lastFlash` guard, a re-render that doesn't change `page.data.flash` could still trigger the `$effect` (depending on invalidation), firing the same toast again. The guard fixes it.

---

## Principal Engineer Notes

1. **`.svelte.ts` is the Svelte 5 inflection point.** Runes in module scope were the single biggest ergonomic upgrade from Svelte 4. It turns "I need to write a store" into "I'll write a class with `$state` fields." Internalize this: anywhere you previously reached for `writable()` or `derived()`, write a class in a `.svelte.ts` module. The compiler does the heavy lifting.

2. **Class-based stores beat writables for real apps.** Writables give you `.subscribe` / `.set` / `.update`, all via strings-and-callbacks machinery. Classes give you typed methods (`add`, `dismiss`), encapsulated state, and IDE-friendly refactoring. Plus: methods compose naturally (`add` calls `dismiss` via `this`). Pre-runes code used `derived(toasts, ...)` to express the same thing — fine, but clumsy when logic grows.

3. **Toast fatigue is real.** Every SaaS eventually ships a toast cascade during some error: "Session expired" / "Please log in" / "Cannot load" — five at once, stacked like pancakes. Real fixes: dedupe by message content (if the same message is already visible, don't add another), cap the visible stack (keep the newest 3, drop the rest), and audit every `toast.add` call quarterly. If you catch yourself thinking "let's just toast it" for everything, you've started to decay.

4. **A11y is not optional.** `role="status"` and `aria-live="polite"` are two attributes. Adding them turns a toast from an inaccessible decoration into a first-class announcement surface for screen readers. The cost is zero; the win is users with visual impairments can use your app. There is no defensible reason to skip them.

5. **Flash messages are the bridge between server state and client UI.** We used `page.data.flash` driven by a URL query param. Other options: session cookies (more robust across redirects, more moving parts), WebSockets (real-time broadcasts from server to client, complete overkill for a CRUD app), or returning the message directly from the action without redirecting. For Contactly's flow — write, redirect, confirm — the query-param-to-flash pattern is the smallest thing that works.

6. **Animations respect user preferences.** Users with vestibular disorders can enable "reduce motion" in their OS. Svelte's transitions respect that — `fly` and `fade` automatically become instant in that environment. If you ever hand-roll an animation (e.g., with `$effect` setting `style.transform`), make sure you check `window.matchMedia('(prefers-reduced-motion: reduce)')` and skip the animation.

---

## Summary

- Built a `ToastStore` class in a `.svelte.ts` module, using `$state` to back the toast list.
- Implemented `add(message, type)` and `dismiss(id)` methods with `crypto.randomUUID()` for ids and `setTimeout` for auto-dismiss.
- Built the `ToastContainer` component with fixed positioning, pointer-events handling, ARIA status role, and `fly`/`fade` transitions.
- Mounted the container once in the root `+layout.svelte` so every page gets toasts.
- Wired form actions to the toast system via query-param flash messages, picked up in the layout's `$effect`.

## What's Next

Lesson 13.2 tackles a smaller but equally important UX polish: **better redirects**. Right now when a user hits `/contacts` while logged out, we send them to `/login` and then dump them on `/dashboard` after they log in — even though what they wanted was the contacts page. We'll fully implement the `redirectTo` query-parameter pattern, harden it against open-redirect attacks, and extract the safe-redirect helper into `$lib/utils/redirect.ts` so every auth check uses the same code path.
