---
title: "2.4 - Client Side Supabase"
module: 2
lesson: 4
moduleSlug: "module-02-supabase-integration"
lessonSlug: "04-client-side-supabase"
description: "Set up the Supabase browser client in the root layout and make the user session available to all pages via PageData."
duration: 10
preview: false
---

## Overview

The server side is wired up. Now we build the **browser-side** half of the Contactly auth loop: a Supabase client that lives in the user's browser, shares cookies with the server, and reacts live to auth state changes (sign-in, sign-out, token refresh) by re-running the server load so the UI always reflects reality.

By the end of this lesson you'll understand not just what the code does, but **why we need two clients**, how they stay in sync, and how the `page.data.user` value becomes available on every page in Contactly without the usual prop-drilling or context APIs.

## Prerequisites

- Lesson 2.3 complete — `hooks.server.ts` creates a server-side Supabase client and a `getUser()` helper on every request.

## What You'll Build

- `src/routes/+layout.server.ts` — loads the authenticated user on every request and declares a `supabase:auth` dependency.
- `src/routes/+layout.svelte` — creates the browser-side Supabase client and listens for auth state changes.
- A working path for any page or component to read `page.data.user` via `$app/state`.

---

## Why Two Supabase Clients?

If you recall from lesson 2.2, `@supabase/ssr` exposes two constructors:

- **`createServerClient`** — runs on the server, reads/writes `event.cookies`.
- **`createBrowserClient`** — runs in the browser, reads/writes `document.cookie`.

We built the server one in the last lesson. Now the browser one. Why both?

### The server client handles the initial render

When a user visits `contactly.app/dashboard`, their browser sends an HTTP request. SvelteKit runs load functions **on the server**, passes the `user` object into `PageData`, renders the page to HTML, and sends it back. The user sees a fully-rendered page with their data. No spinners, no "Loading..."

This initial render uses the **server client** (via `event.locals`) and it's all we need for read-only pages. Great for SEO, great for perceived performance.

### The browser client handles everything after

After the initial HTML arrives, SvelteKit "hydrates" the page — attaches event handlers, boots the client-side router, and takes over navigation. From this point, the app runs in the browser.

When something happens that needs Supabase — the user logs out, a realtime subscription fires, a background token refresh occurs — we need a client that works from inside the browser. The **browser client** is that client. It reads the same cookies the server set and can drive realtime subscriptions, client-side auth calls, client-only queries, and so on.

### How they stay in sync

Both clients read from and write to the same cookies. When one sets a new session cookie, the other sees it on the next request/tick. This is why cookie-based auth matters so much for SSR: it's the shared source of truth between server and browser.

---

## The Root `+layout.server.ts`

Create `src/routes/+layout.server.ts`:

```typescript
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  // Tag this load with a dependency name. Calling `invalidate('supabase:auth')`
  // anywhere in the app re-runs every load function tagged with this dep.
  depends('supabase:auth')

  const user = await locals.getUser()

  return {
    user
  }
}
```

### Walking through this

- **`LayoutServerLoad`** — the auto-generated type for this specific load function. Importing from `./$types` gives you full type safety for both the event argument and the return value.
- **`({ locals, depends })`** — destructuring the event. `locals` is what we set up in the hook; `depends` is a function for tagging this load with a dependency identifier.
- **`depends('supabase:auth')`** — marks this load function as depending on the identifier `supabase:auth`. Anywhere else in the app, calling `invalidate('supabase:auth')` will re-run every load function that called `depends('supabase:auth')`. This is SvelteKit's way of expressing "this load's data depends on auth state; when auth state changes, rerun it."
- **`const user = await locals.getUser()`** — calls the helper we defined in the hook. Returns the validated user or `null`.
- **`return { user }`** — the returned object becomes `data` on the client. Because this is the root layout, `data.user` is available on every page in the app.

### Why put this in the root layout?

Layout load functions are a feature of SvelteKit's nested loading model. Pages and child layouts inherit data from their parent layouts. The root `+layout.server.ts` runs for *every* request, and its returned data merges into every page's `data`. So when we load `user` here, every `+page.svelte` in the app gets it for free.

An alternative would be to load `user` in each specific page's `+page.server.ts`. Bad idea — error-prone (forget one page and it breaks) and wasteful (same fetch repeated everywhere).

### Principal engineer note

Be careful what you put in the root layout load. Whatever you return here becomes a dependency of every page. Heavy queries here slow down every navigation. `getUser()` is cheap (one call to Supabase Auth) and its result is needed everywhere, so it belongs here. More expensive data — "user's full contact list" — belongs in the specific routes that need it.

---

## The Root `+layout.svelte`

Create `src/routes/+layout.svelte`:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { invalidate } from '$app/navigation'
  import { onMount } from 'svelte'
  import { createBrowserClient } from '@supabase/ssr'
  import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
  import type { Database } from '$lib/types/database.types'

  let { data, children } = $props()

  const supabase = createBrowserClient<Database>(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY
  )

  onMount(() => {
    // Listen for auth state changes in the browser. When the user signs in,
    // signs out, or the access token is refreshed, re-run any load function
    // tagged with 'supabase:auth' so UI state catches up.
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED'
      ) {
        invalidate('supabase:auth')
      }
    })

    // Cleanup when the layout unmounts (e.g., full page reload, navigation away).
    return () => subscription.unsubscribe()
  })
</script>

{@render children()}
```

There's a lot going on here. Let's take it apart.

### The imports

- **`invalidate`** — SvelteKit's hook for manually triggering re-runs of load functions.
- **`onMount`** — a Svelte lifecycle function. The callback runs after the component has been rendered into the DOM in the browser (never on the server).
- **`createBrowserClient`** — the browser-side Supabase factory. Uses `document.cookie` internally.
- **`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`** — from `$env/static/public`. Safe in the browser.
- **`Database`** — our generated schema type. Gives the browser client the same typing as the server client.

### `let { data, children } = $props()`

This is Svelte 5 runes syntax. Two things to unpack:

- **`$props()`** — the rune that gives a component its props. Replaces the old Svelte 4 `export let data` pattern.
- **`data` and `children`** — standard SvelteKit props for a layout component.
  - `data` holds the merged output of all load functions up the tree. `data.user` is the user we loaded in `+layout.server.ts`.
  - `children` is a **snippet** — a new Svelte 5 primitive representing the component's contents. A layout renders its children somewhere with `{@render children()}`.

If you've used React: `children` is conceptually the same; `{@render children()}` is the equivalent of `{props.children}`.

### Creating the browser client

```typescript
const supabase = createBrowserClient<Database>(
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY
)
```

On the server, this line still runs during SSR (SvelteKit invokes `<script>` on both server and client). But `createBrowserClient` is written to be server-safe — it produces a benign stub on the server that never makes real calls. Only once the component is hydrated in the browser does the client become truly active. We'll rely on `onMount` — which *never* runs on the server — for the subscription.

### `onMount(() => { ... return () => subscription.unsubscribe() })`

`onMount` takes a function that runs once, in the browser, after mount. That function can optionally return another function — a **cleanup** — that Svelte calls when the component is destroyed. Here:

1. **On mount:** Subscribe to Supabase auth state changes. Store the subscription.
2. **On cleanup:** Unsubscribe. Otherwise we'd leak listeners every time the layout remounts (e.g., full-page navigation, HMR during development).

This is the standard pattern for anything that needs teardown in Svelte — event listeners, intervals, subscriptions. Always match a subscribe with an unsubscribe.

### The `onAuthStateChange` callback

```typescript
supabase.auth.onAuthStateChange((event) => {
  if (
    event === 'SIGNED_IN' ||
    event === 'SIGNED_OUT' ||
    event === 'TOKEN_REFRESHED'
  ) {
    invalidate('supabase:auth')
  }
})
```

Supabase's auth client emits events for every change in the user's session state. We care about three:

- **`SIGNED_IN`** — the user just logged in. We need the server to re-run `getUser()` so the layout's `data.user` becomes non-null.
- **`SIGNED_OUT`** — the user just logged out. Same thing in reverse; `data.user` should become null.
- **`TOKEN_REFRESHED`** — the access token just rotated. The session is still valid, but the cookie has a new value; we want the server's view to catch up.

Other events like `USER_UPDATED` or `PASSWORD_RECOVERY` don't require a UI refresh, so we don't invalidate on them.

`invalidate('supabase:auth')` runs the re-dispatch. Every load function that called `depends('supabase:auth')` — in our case, just the root `+layout.server.ts` — is rerun. The new `user` flows into `page.data.user`, reactive UI updates, we're back in sync.

### `{@render children()}`

This is the Svelte 5 way to insert the component's children into the layout. In our case, `children` is whatever page the user is currently on — the dashboard, the pricing page, whatever. The layout wraps it; `{@render children()}` is where that wrapped content goes.

Everything you put before or after `{@render children()}` in the layout becomes persistent chrome (the navbar and footer, when we add them in Module 5) that doesn't re-render on navigation.

---

## Accessing the User on Any Page

Now for the payoff. With the root layout set up, any page or component in Contactly can read the current user in one line. Here's the pattern:

```svelte
<!-- In any +page.svelte or component -->
<script lang="ts">
  import { page } from '$app/state'

  // user is reactive — updates automatically when page.data changes.
  const user = $derived(page.data.user)
</script>

{#if user}
  <p>Welcome, {user.email}</p>
{:else}
  <p>Please log in</p>
{/if}
```

### Three pieces to understand

- **`page` from `$app/state`** — a reactive object containing the current route's `url`, `params`, `data`, and more. `$app/state` is the Svelte 5 runes-compatible replacement for the older `$app/stores`. If you see tutorials importing `page` from `$app/stores`, they're on an older SvelteKit.

  **Rule: in a Svelte 5 / SvelteKit 2 project, import from `$app/state`, not `$app/stores`.**

- **`$derived(page.data.user)`** — creates a reactive value. Whenever `page.data` updates (for instance, when `invalidate('supabase:auth')` fires after a login), the `user` variable automatically reflects the new value. No manual subscriptions, no `.subscribe()`.

- **`{#if user}...{:else}...{/if}`** — standard Svelte conditional. Renders the first branch if `user` is truthy, the second otherwise.

### Why we don't expose the Supabase client itself

A common beginner instinct is to put the `supabase` browser client into `PageData` so every component can call `supabase.auth.signIn()` or `supabase.from('...').select()` directly. We deliberately don't do this.

- Direct database reads from components bypass SvelteKit's data-loading story (no SSR, no caching, no streaming).
- Auth operations are better done through **form actions** (coming in Module 3), which work without JavaScript and survive slow networks.
- When every component can query, every component becomes a potential source of bugs — duplicate fetches, race conditions, forgotten error handling.

The right pattern: **server load functions for data, form actions for mutations, browser client only for things that must happen client-side** (auth state listener, realtime subscriptions). Keep the browser client in the layout. Export it only where you truly need it.

---

## Verifying the Whole Loop

Boot the dev server:

```bash
pnpm dev
```

Visit `http://localhost:5173`. The page loads. Open DevTools → **Network** tab. Reload. You should see:

- The HTML response for `/` (or whatever page you're on).
- A request to `http://localhost:54321/auth/v1/user` — that's `getUser()` firing in the hook.

Check **Application** tab → **Cookies** → `localhost:5173`. You should see no auth cookies yet — nobody's logged in.

Create a test user in Supabase Studio (as you did at the end of lesson 1.4). Reload the app page. Still no cookies because we haven't built the login UI yet — that's Module 3. But the infrastructure you built in lessons 2.3 and 2.4 is ready: once login is wired up, the moment a user authenticates, cookies flow, `onAuthStateChange` fires, `invalidate` re-runs `+layout.server.ts`, and `page.data.user` populates across the app.

---

## Principal Engineer Notes

1. **Two clients, one cookie.** This two-client pattern is a key design choice in `@supabase/ssr`. Some developers find it confusing at first — "why do I need two of the same thing?" — but once you understand the server/browser environment split, it's obvious. A single client cannot be both environments at once.

2. **`invalidate` is a narrow tool with a broad use case.** You can use it for far more than auth: cache invalidation after a mutation, resubscribing to realtime events, forcing a refetch when a background task completes. Any time your load functions' data has a dependency on something outside SvelteKit's awareness, reach for `depends` + `invalidate`. Don't reach for `invalidateAll()` unless you truly can't scope it — targeted invalidation is faster.

3. **`onAuthStateChange` fires once immediately on mount.** Supabase calls the callback with the current state as soon as you subscribe, not just on actual changes. If you only want real changes, you'll need to track a flag or check the `session` argument. Our code handles this correctly because `invalidate('supabase:auth')` is idempotent — reruns are safe.

4. **Beware the browser client on the server.** In some edge cases (tests, static analysis), `createBrowserClient` executes during module evaluation on the server. Modern versions of `@supabase/ssr` guard against this, but if you see odd errors about `document` or `window`, check your version and that nothing outside `onMount` is using the client directly.

5. **This architecture scales.** The same pattern — auth at the root layout, server load validated with `getUser`, browser listener wired to `invalidate` — is what you'll find in production-grade Supabase + SvelteKit apps at any scale. You're not learning a toy pattern; you're learning the canonical one.

---

## Summary

- Understood why a Supabase+SvelteKit app needs **two clients** (server for SSR, browser for post-hydration), and how they stay in sync via shared cookies.
- Created `src/routes/+layout.server.ts` which runs on every request, validates the user with `locals.getUser()`, and exposes it to every page as `data.user`.
- Called `depends('supabase:auth')` so specific invalidations can re-run this load.
- Created `src/routes/+layout.svelte` which constructs a browser-side Supabase client and listens for auth state changes with `onAuthStateChange`.
- Tied the two halves together: on `SIGNED_IN` / `SIGNED_OUT` / `TOKEN_REFRESHED`, we call `invalidate('supabase:auth')`, which reruns the server load and updates `page.data.user` everywhere.
- Learned the access pattern: `import { page } from '$app/state'; const user = $derived(page.data.user)`.
- Internalized Svelte 5 runes: `$props()`, `$derived`, and the snippet-based `{@render children()}` pattern.
- Made a design choice: don't expose the Supabase browser client globally; prefer server load functions and form actions for data and mutations.

## Next Lesson

Module 3 begins — **User Auth**. You'll wire up the real sign-up, login, logout, and password-reset flows using SvelteKit form actions with Zod validation. By the end of Module 3, a visitor can create an account, log in, see protected data, and sign out — all backed by the infrastructure you built in Module 2.
