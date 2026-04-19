---
title: "3.3 - Protecting Auth Routes"
module: 3
lesson: 3
moduleSlug: "module-03-user-auth"
lessonSlug: "03-protecting-auth-routes"
description: "Guard the (app) route group with a server-side layout that redirects unauthenticated users to login."
duration: 16
preview: false
---

## Overview

Right now, Contactly has a hole. A user who has never signed in can visit `/dashboard` and the page will render — because nothing is checking whether they're logged in. This lesson closes that hole.

The goal is simple: **every route inside `(app)/` should be accessible only to authenticated users.** If a signed-out visitor hits `/dashboard`, `/dashboard/contacts`, `/account`, or any other protected route, they should be redirected to `/login` — and after they successfully log in, they should land exactly where they were trying to go.

The solution is one file. Not fifteen route files each with their own check. One file at `src/routes/(app)/+layout.server.ts` that guards every single route below it. This is one of those lessons where SvelteKit's design lets you do what would take 100 lines in Express in about 10.

## Prerequisites

- Lesson 3.2 complete — `/login` works with `signInWithPassword`, and the `load` function redirects already-logged-in users.
- You understand SvelteKit route groups from 3.1.

## What You'll Build

- `src/routes/(app)/+layout.server.ts` — the auth guard. Three lines of real logic. Protects every route inside `(app)/`.
- `src/routes/(app)/+layout.svelte` — the shell for authenticated pages (Navbar goes in here in 3.4; for now, just a passthrough).
- `src/routes/(app)/dashboard/+page.svelte` — a stub dashboard so we have something to redirect into.
- A tested `redirectTo` round-trip: `/dashboard` → `/login?redirectTo=/dashboard` → log in → `/dashboard`.

---

## The Mental Model — Layouts As Nested Guards

Every SvelteKit request walks through a stack of `load` functions from the outside in:

```
Request: /dashboard/contacts
  └─ run src/routes/+layout.server.ts       (root layout — everyone's loaded)
      └─ run src/routes/(app)/+layout.server.ts  (app group layout — OUR GUARD)
          └─ run src/routes/(app)/dashboard/+layout.server.ts  (if any)
              └─ run src/routes/(app)/dashboard/contacts/+page.server.ts
```

If any layer `throw`s a `redirect(...)` or `error(...)`, **the rest of the chain doesn't run**. The request short-circuits right there.

This is the magic. We don't have to touch each individual route's `load` function to require authentication. We put the check in `(app)/+layout.server.ts`, and every page inside `(app)/` automatically inherits the guard. Add a new feature at `(app)/billing/settings/+page.svelte` a year from now? It's protected automatically. Delete the guard? Every page below it becomes public instantly. One choke point, zero drift.

This is the **defense-in-depth** pattern: centralize security decisions. If every page handled its own auth check, one forgotten check means one leaked route. With layout-level guards, you'd have to actively delete the file for it to break.

---

## Step 1: Build the Route Group Structure

First, the folders:

```bash
mkdir -p src/routes/\(app\)/dashboard
```

The `(app)` group is a sibling of the `(auth)` group from lessons 3.1 and 3.2. Remember: the parentheses **hide the folder from the URL**. Routes inside `(app)/dashboard` become `/dashboard`, not `/(app)/dashboard`.

Your routes folder should now look like this:

```
src/routes/
├── (auth)/
│   ├── +layout.svelte
│   ├── login/+page.{svelte,server.ts}
│   └── register/+page.{svelte,server.ts}
├── (app)/                    ← new
│   ├── +layout.server.ts     ← new (the guard)
│   ├── +layout.svelte        ← new (the shell)
│   └── dashboard/
│       └── +page.svelte      ← new (stub)
├── +layout.svelte            ← root
└── +page.svelte              ← marketing home
```

---

## Step 2: The Auth Guard — `(app)/+layout.server.ts`

Create `src/routes/(app)/+layout.server.ts`:

```typescript
// src/routes/(app)/+layout.server.ts
import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const user = await locals.getUser()

  if (!user) {
    const redirectTo = encodeURIComponent(url.pathname + url.search)
    throw redirect(303, `/login?redirectTo=${redirectTo}`)
  }

  return { user }
}
```

Three real lines of logic. Let's take them apart.

### `const user = await locals.getUser()`

This calls the `getUser` helper we wired up in Lesson 2.3 via `hooks.server.ts`. Underneath it, `supabase.auth.getUser()` is invoked, which:

1. Reads the auth cookie from the request.
2. Sends the JWT to Supabase's auth server for validation.
3. Returns the user object (if valid) or `null` (if missing, expired, or tampered).

The **"validates against Supabase"** part is crucial. We covered it in 2.3 and again in 3.2. Using `getSession()` here instead of `getUser()` would be a serious bug — `getSession()` trusts whatever's in the cookie without verifying it. An attacker who can forge a session cookie would slip right past.

### `if (!user) { throw redirect(...) }`

If there's no user, we throw a redirect. We learned in 3.1 that `throw redirect(...)` is how SvelteKit receives redirect signals — it's caught internally by the framework.

Crucially, `throw redirect` **stops execution of this load function AND all load functions nested below it**. The `+page.server.ts` at `/dashboard/contacts` never runs. No database queries happen. No data is leaked. No wasted compute.

### `return { user }`

If we got here, the user is authenticated. We return the user object so child pages can read it from `data.user` without each calling `getUser()` again.

**Why return the whole user?** Because authenticated layouts are the one place in the app where "the current user" is universally relevant. Navbars show the user's name. Permission checks compare against their role. Analytics pings include their ID. Putting `user` in `data` at the app-layout level means every child page just reads `data.user` — no extra queries, no prop drilling.

**Does every child page get `user`?** Yes. In SvelteKit, page data is **merged** from every layout upstream. `data.user` is available in every `+page.svelte` inside `(app)/` and every `+page.server.ts` that receives `parent()`-merged data. It's also accessible from `$app/state`'s `page.data.user`, which is how we'll read it in the Navbar (Lesson 3.4).

---

## Step 3: The `redirectTo` Round-Trip

```typescript
const redirectTo = encodeURIComponent(url.pathname + url.search)
throw redirect(303, `/login?redirectTo=${redirectTo}`)
```

This is a subtle but important line. Let's unpack.

### Why preserve the original target?

Imagine the user clicks a bookmark to `/dashboard/contacts/contact_abc123`. They're not logged in (session expired overnight). Without preservation, they'd redirect to `/login`, log in, and land on `/dashboard` — not the specific contact they were trying to view. They'd have to navigate back manually. Frustrating.

With preservation, the login URL becomes `/login?redirectTo=%2Fdashboard%2Fcontacts%2Fcontact_abc123`. After they sign in, the login action (from 3.2) reads that query param and redirects them straight to their original destination.

### Why `url.pathname + url.search`?

- `url.pathname` is the path portion: `/dashboard/contacts/contact_abc123`
- `url.search` is the query string with the leading `?`: `?tab=notes`
- Together, they reconstruct the part of the URL we want to preserve (not the host or hash).

If the user was viewing `/dashboard/contacts?filter=active&sort=name`, we want to bring them back to exactly that same view — filters and all.

### Why `encodeURIComponent`?

URLs have special characters — `&`, `?`, `=`, `#`, `/` — that have syntactic meaning. If we embed a raw path like `/dashboard/contacts?filter=active` into another URL as a query value, the `?` and `&` would get parsed as **additional** query params on the login URL, breaking everything.

`encodeURIComponent` escapes those characters:

- `/` → `%2F`
- `?` → `%3F`
- `&` → `%26`
- `=` → `%3D`

So `/dashboard/contacts?filter=active` becomes `%2Fdashboard%2Fcontacts%3Ffilter%3Dactive`, which is safe to put inside a query string.

On the receiving end, `url.searchParams.get('redirectTo')` automatically **decodes** it back to `/dashboard/contacts?filter=active`. The login action doesn't need to manually `decodeURIComponent` — `searchParams` does it for you.

### Remember the open-redirect defense from 3.2

The login action (`(auth)/login/+page.server.ts`) validates `redirectTo` with `startsWith('/')` before honoring it. That's what keeps this mechanism safe. If an attacker crafts `/login?redirectTo=https://evil.com`, the login action falls back to `/dashboard`. No open redirect, ever.

---

## Step 4: The `(app)` Layout Shell — `(app)/+layout.svelte`

Create `src/routes/(app)/+layout.svelte`:

```svelte
<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
  let { children } = $props()
</script>

<div class="min-h-screen bg-gray-50">
  <!-- Navbar will live here in Lesson 3.4 -->
  <main class="max-w-7xl mx-auto px-4 py-8">
    {@render children()}
  </main>
</div>
```

### Why a separate layout at all?

The `(app)` group's visual shell will be different from `(auth)` (which was a centered box for login/register). Authenticated pages need:

- A Navbar with the logo, nav links, and user menu.
- A wider content area (`max-w-7xl` — about 1280px) suitable for tables, forms, dashboards.
- A consistent page background and spacing.

Having a per-group layout lets us set all of that once and have every page inside `(app)/` inherit it. We don't stamp it out per page.

### `{@render children()}` — the placeholder for the child page

`children` is a **snippet** passed automatically to layouts by SvelteKit. It represents the page component being rendered inside this layout. The `{@render children()}` block is where SvelteKit substitutes the rendered child.

In Svelte 4, this would have been `<slot />`. Svelte 5's snippets are more powerful:

- Snippets can be passed around like functions.
- Snippets can take arguments (`{@render mySnippet(someArg)}`).
- Snippets have a clear declaration site with `{#snippet name()}`.
- The old `<slot>` model is gone.

For layouts, you just destructure `{ children }` from `$props()` and call `{@render children()}`. That's the whole mental model.

### Not reading `data.user` here — yet

We **could** destructure `data` from `$props()` here and read `data.user` to render a greeting in the Navbar. But we're splitting the Navbar into its own lesson (3.4), so for now the layout is just a plain shell.

Think of this file as a skeleton. In 3.4 we'll add the Navbar. In 3.5 and beyond we might add a sidebar, a notifications bell, whatever. Everything goes in this one file — every page inside `(app)/` immediately benefits.

---

## Step 5: A Stub `/dashboard` Page

To actually test the guard, we need a page behind it. Create `src/routes/(app)/dashboard/+page.svelte`:

```svelte
<!-- src/routes/(app)/dashboard/+page.svelte -->
<script lang="ts">
  let { data } = $props()
</script>

<div>
  <h1 class="text-3xl font-semibold text-gray-900 mb-2">
    Welcome, {data.user.email}
  </h1>
  <p class="text-gray-600">You're signed in. Dashboard coming soon.</p>
</div>
```

### `let { data } = $props()`

`data` is the merged result of every upstream `load` function. Because `(app)/+layout.server.ts` returned `{ user }`, and there are no other loaders between layout and page, `data.user` is that user object.

The types for `data` are generated by SvelteKit into `./$types.ts` (invisible to you, regenerated automatically). You don't hand-write types — SvelteKit infers the shape of `data` from your `load` returns.

### `{data.user.email}`

Svelte 5 uses `{expression}` for text interpolation. Since `data.user` is **definitely** present (the guard upstream would have redirected otherwise), we don't need optional chaining.

---

## Step 6: Test the Guard

With `pnpm dev` running:

### Test 1 — Unauthenticated access is blocked

1. Clear cookies (DevTools → Application → Cookies → your origin → trash icon).
2. Navigate to `/dashboard`.
3. You should be redirected to `/login?redirectTo=%2Fdashboard`.

Check the URL bar. Confirm the `redirectTo=%2Fdashboard` query param is there.

### Test 2 — Round-trip works

1. Still on `/login?redirectTo=%2Fdashboard`, enter your registered credentials.
2. Submit.
3. You should land on `/dashboard` — because the login action read `redirectTo` and honored it.

### Test 3 — Deep routes round-trip

1. Clear cookies again.
2. Navigate to `/dashboard/contacts?filter=active` (it'll 404 because we haven't built `/contacts` yet — that's fine; the point is the redirect behavior).
3. You're redirected to `/login?redirectTo=%2Fdashboard%2Fcontacts%3Ffilter%3Dactive`.
4. Log in.
5. You go to `/dashboard/contacts?filter=active` (which still 404s, but the **redirect** worked — confirm the URL bar).

### Test 4 — Authenticated users go straight through

1. While logged in, click a link to `/dashboard`.
2. No redirect. Page renders instantly.

### Test 5 — Already-logged-in at `/login`

1. While logged in, type `/login` in the URL bar.
2. You're immediately redirected to `/dashboard` (from the `load` function in 3.2).

### Test 6 — The guard fires on EVERY `(app)` route

Since we only have `/dashboard` right now, this test is forward-looking: when you build `/account` in lesson 3.5 and `/dashboard/contacts` in module 4, they will be **automatically** protected. No new guard code. That's the power of the layout approach.

---

## Common Mistakes

### Mistake 1: Putting the guard in a `+page.server.ts` instead of `+layout.server.ts`

If you put the `getUser()` check at the page level, you have to remember to add it to every page. You will forget one. That one is the leak.

```typescript
// ❌ DON'T — one per page means drift
// src/routes/(app)/dashboard/+page.server.ts
export const load = async ({ locals }) => {
  const user = await locals.getUser()
  if (!user) throw redirect(303, '/login')
  // ...
}
```

The layout-level guard runs once per request and covers the entire subtree. Centralize.

### Mistake 2: Using `getSession()` instead of `getUser()`

We keep harping on this because it's the most common real-world bug:

```typescript
// ❌ DON'T
const { data: { session } } = await locals.supabase.auth.getSession()
if (!session) throw redirect(303, '/login')
```

`getSession` trusts cookies. `getUser` verifies against Supabase. Use `getUser`.

### Mistake 3: Forgetting `encodeURIComponent`

```typescript
// ❌ DON'T
throw redirect(303, `/login?redirectTo=${url.pathname + url.search}`)
```

If the user was visiting `/dashboard/contacts?filter=active`, the redirect URL becomes `/login?redirectTo=/dashboard/contacts?filter=active`. That second `?` and the `&` (if present) will be parsed as additional query params on the login URL itself, and `redirectTo` will be just `/dashboard/contacts`. Encoding prevents this.

### Mistake 4: Returning `user: null` from the guard instead of redirecting

```typescript
// ❌ DON'T
if (!user) {
  return { user: null }
}
```

Then every page has to null-check `data.user`. The whole point of the guard is that inside `(app)/`, `user` is **always** present. Redirect; don't return null.

### Mistake 5: Using a client-side check (`if (!$app/state.page.data.user)`)

```svelte
<!-- ❌ DON'T — runs in the browser -->
<script>
  import { goto } from '$app/navigation'
  import { page } from '$app/state'

  if (!page.data.user) goto('/login')
</script>
```

This is a **client-side** check — it runs in the browser **after** the HTML is already sent. A signed-out user's browser could view the HTML for a split second before being redirected. Worse, if they disable JavaScript, there's no redirect at all — they see the whole protected page.

Always do auth checks server-side. SvelteKit lets you co-locate them in `+layout.server.ts`; use that.

### Mistake 6: Trying to read cookies directly in the guard

```typescript
// ❌ DON'T
const token = cookies.get('sb-access-token')
if (!token) throw redirect(303, '/login')
```

The cookie might exist but be expired, forged, or for a different project. You need Supabase to validate it. `locals.getUser()` does that. Don't read cookies directly for auth decisions.

---

## Principal Engineer Notes

### Notes on layout-level vs middleware-level guards

In Express/Next.js world, the common pattern is global middleware:

```typescript
// Next.js middleware.ts
export function middleware(req) {
  if (req.nextUrl.pathname.startsWith('/dashboard') && !req.cookies.has('session')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
}
```

Middleware is powerful (runs before everything, edge-deployable) but risky: the path-matching logic is **string-based**, easy to get wrong, and lives far from the routes it guards. A typo in the matcher leaks routes. A new route added without updating the matcher leaks. Centralized but **string-indexed**.

SvelteKit's layout-level `load` is **folder-indexed**. Any file inside `(app)/` is automatically guarded because it's physically inside that folder. No string matching, no regex patchwork, no forgotten routes. That's a meaningful structural advantage.

### Notes on the getUser per-request cost

`locals.getUser()` makes a network request to Supabase's auth service — roughly 20–50ms. On a busy page, that's overhead. If the layout load **and** a page load **and** an action all call `getUser`, you're paying three times.

In Lesson 2.3 we wrapped `getUser` with request-scoped memoization:

```typescript
// hooks.server.ts (simplified)
let cached: User | null | undefined
event.locals.getUser = async () => {
  if (cached !== undefined) return cached
  const { data: { user } } = await event.locals.supabase.auth.getUser()
  cached = user
  return cached
}
```

This caches within a single request. The first call hits Supabase; subsequent calls in the same request return the cached result. Guard, layout, page, action — one Supabase call total.

This is a small but real Principal Engineer move: centralize the verification, memoize within a request, surface it as a simple `locals.getUser()` API. Callers don't think about the caching; it just works.

### Notes on "deny by default"

Notice the architecture we've built: **by default, adding a route inside `(app)/` makes it protected.** The guard is the baseline. To opt **out** of auth (e.g., for a hypothetical preview page `/(app)/public-preview/`), you'd have to explicitly relax the guard.

Contrast with "allow by default": every new route is public unless you remember to add a check. One forgotten check = one leak.

Senior engineers default to deny. It's strictly safer: the **common path** (new protected route) requires nothing extra; the **rare path** (intentionally public) requires explicit effort. Your architecture should make the right thing the default thing.

### Notes on per-role access beyond authentication

Our guard checks "is there a user?" — that's authentication. In a real SaaS you'll also need **authorization** — "does this user have permission to access this resource?"

In Module 4 we'll add contact-level access: a user can only see **their own** contacts, enforced by RLS. That's authorization at the database layer.

Higher-level authorization (roles, admin areas, billing tiers) fits into the same pattern as auth guards — but at different folder depths:

- `(app)/+layout.server.ts` — must be authenticated
- `(app)/admin/+layout.server.ts` — must be admin role
- `(app)/enterprise/+layout.server.ts` — must be on enterprise plan

Each folder's guard gates everything below it. Layer guards; don't stuff all checks into one giant middleware function.

### Notes on silent failure in the guard

What if `locals.getUser()` **throws** (Supabase is down, network error)? Right now, the guard doesn't catch it — the user sees SvelteKit's 500 page. That's arguably correct: if we can't verify auth, we shouldn't serve a protected page. Fail closed.

If you wanted fancier behavior — "retry once, then show a friendly 'Auth service unavailable' page" — you'd wrap the call in a try/catch and handle the error explicitly. For a small SaaS, fail-closed + 500 page is fine. For enterprise, you want richer instrumentation.

### Notes on the session-expiry edge case

What happens when a user's JWT expires mid-session? The guard calls `getUser()`, which hits Supabase, which notices the JWT is expired, and Supabase's SSR client **uses the refresh token to mint a new JWT transparently**. New cookies are written to the response. The user notices nothing.

If the refresh token is also invalid (e.g., user was signed out server-side, revoked credentials), `getUser()` returns `null` and the guard redirects to login. The user is gently kicked out. That's the correct behavior.

This "silent refresh" is another reason to use `getUser` (which goes through Supabase's refresh flow) rather than reading cookies directly. Supabase handles refresh tokens for you.

---

## What's Next

Lesson 3.4 builds the **Navbar** — the visible counterpart to this invisible guard. Now that `(app)` routes are protected, we need a UI for signed-in users: links to dashboard, contacts, account, and a **Sign out** button that actually logs them out.

The Navbar will also teach you `$app/state` (Svelte 5's replacement for the old `$page` store) for reading the current route, `$derived` for computing active-link state reactively, and — importantly — why logging out must be a POST request, not a GET.
