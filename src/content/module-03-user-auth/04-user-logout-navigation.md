---
title: "3.4 - User Logout & Navigation"
module: 3
lesson: 4
moduleSlug: "module-03-user-auth"
lessonSlug: "04-user-logout-navigation"
description: "Build a secure logout flow and an auth-aware Navbar so users can see who they are and safely sign out."
duration: 18
preview: false
---

## Overview

You now have user registration (3.1), login (3.2), and a route guard on `(app)` (3.3). The last missing piece of the core auth loop is the **way out** — letting users sign out and return to the marketing site. Alongside that, we'll build the first real piece of chrome in Contactly: an **auth-aware navbar** that changes depending on whether a user is logged in.

This lesson will look deceptively small — maybe fifty lines of code once you count the form and the navbar — but the decisions behind those fifty lines are the difference between a toy app and a secure one. We're going to talk about **why logout must be a POST request** (not a GET), **what a session actually is** in Supabase, and **what the server has to do to invalidate it**. By the end you'll understand logout at a level most junior engineers never reach.

## Prerequisites

- Lesson 3.1 complete — registration exists at `/register`.
- Lesson 3.2 complete — login exists at `/login`.
- Lesson 3.3 complete — the `(app)` route group redirects unauthenticated users to `/login`, and `locals.user` is populated from `event.locals.getUser()` in `hooks.server.ts`.
- Module 2 complete — a client-side Supabase client is set up in the root layout.

## What You'll Build

- A **`signout` named action** on `/account/+page.server.ts` that calls `supabase.auth.signOut()` and redirects the user home.
- An **auth-aware Navbar** component at `src/lib/components/layout/Navbar.svelte` that:
  - Shows different links for logged-in vs. logged-out users.
  - Highlights the currently active route using `$app/state`'s `page` object and `$derived`.
  - Embeds a logout form that posts to the named action.
- A **mounted Navbar** in the `(app)` layout so it appears above every authenticated page.

## Key Concepts

- **Why logout must be POST, not GET** — CSRF, prefetching, idempotency, and the web's rules about safe vs. unsafe methods.
- **Named actions** (`?/signout`) — how SvelteKit lets a single `+page.server.ts` expose multiple handlers.
- **Sessions as cookies** — where Supabase stores the auth token, what `httpOnly` means, and why server-side logout is stronger than client-side.
- **`$app/state` vs. `$app/stores`** — the modern, runes-friendly way to read the current URL inside any component.
- **`$derived`** — computing reactive values (like "is this link active?") from other reactive values.
- **Progressive enhancement of logout** — `use:enhance` so the logout button feels instant without breaking without JavaScript.

---

## Why Logout Must Be a POST Request (Not a GET)

Before we write a single line of code, let's answer a question that trips up nearly every beginner (and plenty of seniors): **why can't logout just be a link?** A link like `<a href="/logout">Sign out</a>` is *so* tempting. It's simple. It's short. It works on the first try. So why do professional codebases insist on wrapping logout in a form?

The answer comes down to how the web itself classifies HTTP methods.

### Safe vs. Unsafe Methods

The HTTP spec divides methods into two buckets:

- **Safe methods** — `GET`, `HEAD`, `OPTIONS`. These are *supposed* to be read-only: no side effects on the server. Hit the URL as many times as you want and nothing changes.
- **Unsafe methods** — `POST`, `PUT`, `PATCH`, `DELETE`. These change state. You submit them intentionally, and the browser treats them very differently from reads.

Browsers, search engine crawlers, and even email clients assume GET requests are safe. They trigger GET requests for all sorts of reasons you never asked for:

1. **Link prefetching.** Chrome, Safari, and Edge all prefetch links on pages to speed up navigation. If `<a href="/logout">` is on your page, the browser might fetch it the moment your page loads — logging the user out before they even clicked.
2. **Image tags and other embeds.** A malicious site could embed `<img src="https://contactly.com/logout" />`. The user's browser will send that GET with their Contactly cookies attached — and they're logged out on a site they didn't even visit.
3. **Search engine crawlers.** Googlebot follows links. If Googlebot ever hits `/logout` (for example via a sitemap typo), it invalidates whichever test account's cookie happens to be attached.
4. **URL previews.** Slack, iMessage, and Discord fetch URLs to show previews. Paste a logout link in chat and whoever receives the message gets logged out.

None of these happen with POST. A POST request requires an explicit form submission (or an explicit `fetch()` call with `method: 'POST'`). You can't accidentally log out a user because you can't trigger a POST by putting something in an `<img>` tag.

### The CSRF Angle

There's an even darker version: **Cross-Site Request Forgery**. Suppose an attacker tricks a victim into visiting `evil.com`. On that page is:

```html
<img src="https://contactly.com/logout" />
```

If logout were a GET, the victim's browser would obediently send that request with their Contactly cookies. Boom — they're logged out. That's only a nuisance-level attack for logout, but the same technique on `/delete-account` or `/transfer-funds` is catastrophic.

POST-plus-CSRF-protection is the standard defense. SvelteKit enables [CSRF protection for form submissions by default](https://kit.svelte.dev/docs/configuration#csrf): cross-origin POSTs with a form-like content type are rejected unless the origin matches. GETs get no such protection because they're supposed to be safe.

### Idempotency

There's one more subtle reason. POST is non-idempotent by convention, meaning "submitting this twice is not automatically the same as submitting it once." That's the right mental model for logout — we're *changing* state (invalidating a session). If the user hits their back button after logging out and the browser offers to "resubmit the form," they at least get a prompt, not a silent re-request.

### The Practical Rule

> Any request that **changes server state** — signing out, posting a comment, deleting a record, charging a card — must be a POST (or PUT/PATCH/DELETE). Links and GETs are for reads and navigation only.

This is a rule you should now internalize for every feature in the course. It's not a SvelteKit-specific rule. It's the web.

---

## Step 1: Add the `signout` Named Action

Our plan: rather than creating a dedicated `/logout` route, we'll add a **named action** to the account page. Why? Because logout is almost always invoked from chrome (a navbar or a menu), not from a dedicated logout page. Users don't "visit the logout page" — they click a button. A named action on an existing page is the idiomatic SvelteKit way to expose this kind of behavior.

> **Alternative: dedicated `/logout` route.** You could instead create `src/routes/logout/+page.server.ts` with a default action. It works fine. The reason we prefer a named action on `/account` is that it keeps related account-management logic (sign out, later: change password, delete account) in one file. Less sprawl. Either approach is a valid professional choice; we'll stick with the named-action pattern throughout Contactly.

### The `signout` action

Open `src/routes/(app)/account/+page.server.ts` (you'll flesh this file out fully in the next two lessons — for now, we just need the sign-out action). Add:

```typescript
// src/routes/(app)/account/+page.server.ts
import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  signout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    throw redirect(303, '/');
  }
};
```

That's the whole thing. Seven functional lines. Let's walk through them.

#### Line-by-line

- **`import { redirect } from '@sveltejs/kit'`** — the same `redirect` helper you used in registration. It throws internally, so calling it immediately halts the action.
- **`import type { Actions } from './$types'`** — the type for the `actions` export of this specific page. SvelteKit generates it from your folder structure. Typing the export gives you autocomplete on `event.locals`, `event.request`, etc.
- **`export const actions: Actions = { ... }`** — the standard SvelteKit pattern for exposing server-side form handlers.
- **`signout: async ({ locals }) => { ... }`** — a named action. The name `signout` is what we'll target from the form with `action="?/signout"`. Everything inside the braces runs when the form is submitted.
- **`await locals.supabase.auth.signOut()`** — the Supabase SDK call that ends the session. We'll dig into what this does server-side in a moment. The `await` matters: if we didn't wait for it, the redirect could race ahead and the user's cookie might survive.
- **`throw redirect(303, '/')`** — after logout, send the user to the home/marketing page. `303 See Other` ensures the browser follows with a GET, preserving the POST/Redirect/GET pattern you met in Lesson 3.1.

#### Why redirect to `/` (home) instead of `/login`?

Three reasons:

1. **Clarity of user intent.** A person who just signed out wants to *leave*, not be nagged to sign back in. Dropping them on `/login` feels pushy.
2. **Marketing funnel.** The home page shows your pricing, product highlights, and testimonials. If a user is canceling (or a friend of a canceled user is using their computer), `/` is the page that might re-engage them.
3. **Route-guard cleanliness.** After `signOut()` the user no longer has a session. If we redirected to `/login` and the login page tried to load session-aware data, we'd rely on correct ordering. `/` has no such coupling.

If you ever did want users to land on `/login`, you'd change the redirect target. That's the whole change.

### What `signOut()` actually does

This is where most tutorials wave their hands. We won't.

When `locals.supabase.auth.signOut()` is called server-side, the `@supabase/ssr` client does two things:

1. **Revokes the session on Supabase's side.** The current access token is marked invalid in Supabase's auth database. Subsequent requests using that token will be rejected. This is *server-side invalidation* — the most important step.
2. **Deletes the session cookies.** The `sb-<project-ref>-auth-token` cookie (and its `-refresh` companion) is cleared from the browser by setting an expired `Set-Cookie` header in the response.

Both steps matter. Clearing the cookie alone (client-side) is weak: if an attacker had sniffed the cookie earlier, they could keep using it until it naturally expires. Step 1 — revoking the session server-side — makes the stolen token instantly useless.

This is why we use the server-side `locals.supabase` client here, not the browser-side client. The server's call goes straight through Supabase's auth admin pathway and invalidates the session at the source.

---

## Step 2: Build the Auth-Aware Navbar

Now we wire up a navigation bar that changes depending on who's viewing it. When logged in, it shows their email and a **Sign out** button. When logged out, it shows **Sign in** / **Get started**.

The Navbar lives in `src/lib/components/layout/Navbar.svelte`. We'll start by creating it step-by-step.

### The full component

Create `src/lib/components/layout/Navbar.svelte`:

```svelte
<!-- src/lib/components/layout/Navbar.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';

  type Props = {
    userEmail?: string | null;
  };

  let { userEmail = null }: Props = $props();

  type NavLink = { href: string; label: string; requiresAuth?: boolean };

  const links: readonly NavLink[] = [
    { href: '/', label: 'Home' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/dashboard', label: 'Dashboard', requiresAuth: true },
    { href: '/account', label: 'Account', requiresAuth: true }
  ];

  let visibleLinks = $derived(
    links.filter((link) => !link.requiresAuth || Boolean(userEmail))
  );
</script>

<header
  class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80"
>
  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
    <div class="flex items-center gap-6">
      <a href="/" class="text-lg font-semibold tracking-tight">Contactly</a>
      <nav class="hidden items-center gap-4 text-sm md:flex">
        {#each visibleLinks as link (link.href)}
          {@const isActive = page.url.pathname === link.href}
          <a
            href={link.href}
            class="rounded-md px-3 py-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            class:text-blue-700={isActive}
            class:text-slate-700={!isActive}
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
          </a>
        {/each}
      </nav>
    </div>

    <div class="flex items-center gap-3">
      {#if userEmail}
        <span class="text-sm text-slate-600 dark:text-slate-300">{userEmail}</span>
        <form method="POST" action="/account?/signout" use:enhance>
          <button
            type="submit"
            class="rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </form>
      {:else}
        <a
          href="/login"
          class="rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Sign in
        </a>
        <a
          href="/register"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Get started
        </a>
      {/if}
    </div>
  </div>
</header>
```

That's it. Now let's pull it apart.

### The script block, line by line

```typescript
import { page } from '$app/state';
import { enhance } from '$app/forms';
```

- **`page` from `$app/state`** — a reactive object that holds information about the current page: URL, route params, load data, action result, and more. Because it's a rune-backed object, reading `page.url.pathname` inside a `$derived` (or in the template) automatically subscribes to changes.
- **`enhance` from `$app/forms`** — the progressive-enhancement helper you met in Lesson 3.1. Applied to our logout form via `use:enhance`, it makes submission AJAX-like (no full-page flash) while preserving the no-JS fallback.

> **`$app/state` vs. `$app/stores`**: SvelteKit used to expose `page` via `$app/stores` as a Svelte store. In SvelteKit 2.12+ the preferred way is `$app/state` — a plain reactive object. Stores still work for now but are marked deprecated. Use `$app/state` in every new component. (You'll see this rule repeated across the course because it's easy to forget.)

```typescript
type Props = {
  userEmail?: string | null;
};

let { userEmail = null }: Props = $props();
```

- **`type Props`** — we describe the Navbar's inputs explicitly. Only one prop so far: `userEmail`. It's optional (`?`) and can be `null`. We keep `null` as a distinct valid value to indicate "intentionally not logged in" — useful for SSR where `undefined` can get confused with "not yet loaded."
- **`$props()`** — the runes replacement for `export let`. It returns the component's props as a plain object you can destructure. The fallback `= null` kicks in when the parent doesn't pass anything.

```typescript
type NavLink = { href: string; label: string; requiresAuth?: boolean };

const links: readonly NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/dashboard', label: 'Dashboard', requiresAuth: true },
  { href: '/account', label: 'Account', requiresAuth: true }
];
```

- **`type NavLink`** — the shape of one nav entry. `requiresAuth` is optional; when absent it defaults to public. We model it explicitly so TypeScript catches typos in any future entries.
- **`readonly NavLink[]`** — the array itself is `const`, but declaring the element type as `readonly` also stops anyone inside the component from accidentally calling `.push()` or `.splice()` and mutating the menu. Small defensive touch; saves you a bug years from now.

```typescript
let visibleLinks = $derived(
  links.filter((link) => !link.requiresAuth || Boolean(userEmail))
);
```

- **`$derived(expression)`** — declares a *reactive computed* value. Whenever any reactive dependency in the expression changes (here, `userEmail`), `visibleLinks` recomputes automatically.
- **The filter rule**: keep a link if (a) it doesn't require auth, or (b) the user is authenticated (`userEmail` is truthy). `Boolean(userEmail)` forces a clean conversion — `null`, `undefined`, and empty string all become `false`; a real email becomes `true`.

Why `$derived` instead of just `const visibleLinks = ...`? Because `userEmail` is a prop — its value can change at runtime (e.g., after a layout reload following login/logout). A plain `const` would compute once and never update. `$derived` keeps the menu in sync with the auth state automatically.

### The markup, region by region

#### Outer shell

```svelte
<header
  class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80"
>
  <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
```

- **`<header>`** — the semantic HTML tag for a page's introductory/navigation region. Screen readers announce landmarks; using `<header>` instead of a generic `<div>` makes the page more navigable for assistive tech.
- **`bg-white/80 backdrop-blur`** — a translucent white background with a blur behind it, a common modern navbar look (similar to Stripe's and Linear's).
- **`max-w-6xl`** — caps the content width so on wide monitors the nav doesn't feel stretched thin.

#### Logo and primary links

```svelte
<a href="/" class="text-lg font-semibold tracking-tight">Contactly</a>
<nav class="hidden items-center gap-4 text-sm md:flex">
  {#each visibleLinks as link (link.href)}
    {@const isActive = page.url.pathname === link.href}
    <a
      href={link.href}
      class="rounded-md px-3 py-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
      class:text-blue-700={isActive}
      class:text-slate-700={!isActive}
      aria-current={isActive ? 'page' : undefined}
    >
      {link.label}
    </a>
  {/each}
</nav>
```

- **`{#each visibleLinks as link (link.href)}`** — the `(link.href)` part is the **keyed each** form. It tells Svelte to identify items by `href`, so if the list re-orders or filters, Svelte moves the right DOM nodes instead of rebuilding. For a tiny list of four it doesn't matter for performance; keying is still best-practice habit.
- **`{@const isActive = page.url.pathname === link.href}`** — a block-scoped constant for the current iteration. We compare the link's `href` to the current pathname. Reading `page.url.pathname` here creates a reactive dependency — when the user navigates, `isActive` recalculates automatically and the class swaps.
- **`class:text-blue-700={isActive}`** — Svelte's class directive. When `isActive` is true, this class is applied; when false, it's removed. Cleaner than interpolating a ternary into `class="..."`.
- **`aria-current={isActive ? 'page' : undefined}`** — an accessibility attribute. Screen readers announce the current page when `aria-current="page"` is set. Setting it to `undefined` removes the attribute entirely (rather than setting it to the literal string `"false"`, which is a common mistake).

#### The auth area

```svelte
{#if userEmail}
  <span class="text-sm text-slate-600 dark:text-slate-300">{userEmail}</span>
  <form method="POST" action="/account?/signout" use:enhance>
    <button type="submit" ...>
      Sign out
    </button>
  </form>
{:else}
  <a href="/login" ...>Sign in</a>
  <a href="/register" ...>Get started</a>
{/if}
```

This is the heart of auth-awareness:

- **`{#if userEmail}`** — simple truthy check. If we have an email, the user is logged in; show the logout form and their email.
- **`<form method="POST" action="/account?/signout" use:enhance>`** — posts to the `signout` named action you wrote in Step 1. Let's dissect this attribute by attribute:
  - **`method="POST"`** — non-negotiable, for all the reasons in the opening section.
  - **`action="/account?/signout"`** — the full-path form. The format is `action="/<route>?/<actionName>"`. `/account` is the route that owns `+page.server.ts`; `signout` is the named action key. Because the Navbar is rendered on *many* pages, we use the absolute path so the form always targets the same action regardless of where it's embedded.
  - **`use:enhance`** — layers on AJAX submission + automatic re-render. Without it, the form still works (full page reload), but with it, logout feels instant.
- **`<button type="submit">`** — crucial detail: `type="submit"` is explicit. Without it, buttons inside forms default to submit *most* of the time, but not in all browsers and not if you ever wrap the button in another component. Explicit submit type = zero surprises.
- **The else branch** — two plain `<a>` links because "Sign in" and "Get started" are *navigation*, not state-changing actions. GET is the right method for reading the page.

---

## Step 3: Mount the Navbar in the `(app)` Layout

The Navbar component is ready; now we need to place it where it'll be seen. All authenticated pages live under `(app)`, so we add the Navbar to `(app)/+layout.svelte`.

Open `src/routes/(app)/+layout.svelte`. It currently looks something like:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  type Props = {
    data: LayoutData;
    children: Snippet;
  };

  let { data, children }: Props = $props();
</script>

{@render children()}
```

Update it to render the Navbar above the page content:

```svelte
<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import Navbar from '$lib/components/layout/Navbar.svelte';

  type Props = {
    data: LayoutData;
    children: Snippet;
  };

  let { data, children }: Props = $props();
</script>

<Navbar userEmail={data.user?.email} />

<main class="mx-auto max-w-6xl px-4 py-8">
  {@render children()}
</main>
```

### Walkthrough

- **`import Navbar from '$lib/components/layout/Navbar.svelte'`** — `$lib` resolves to `src/lib/`. Importing through it keeps paths stable no matter how deeply nested the consuming file is.
- **`let { data, children }: Props = $props()`** — we destructure `data` (the load data from `+layout.server.ts`) and the `children` snippet. Recall from Lesson 3.3 that the `(app)` layout's load function returned `{ user: locals.user, ... }`, so `data.user` is a typed Supabase `User`.
- **`<Navbar userEmail={data.user?.email} />`** — we pass the user's email. The `?.` (optional chaining) is paranoia: the route guard should already have kicked out unauthenticated users, but a typed-narrow `data.user` might still be inferred as `User | null`. Optional chaining gives us `undefined` when `user` is null, which our Navbar's `userEmail` type accepts.
- **`{@render children()}`** — Svelte 5's replacement for `<slot />`. It renders whichever page is currently mounted inside the layout — `/dashboard`, `/account`, or anything else under `(app)`.

### Why the Navbar lives in `(app)` only

We deliberately are **not** mounting the Navbar in the root `+layout.svelte`. Why?

- The marketing pages under `(marketing)` have their own hero, nav, and footer — a different visual identity.
- The auth pages under `(auth)` are intentionally chromeless (centered card, minimal distraction) — adding a navbar would break the design and distract from the task.
- The Navbar is only meaningful when the user is logged in (because half of its links require auth). Rendering it on public pages would require extra conditional logic.

Route groups + per-group layouts are how SvelteKit lets you draw these lines cleanly. Every `(app)` page now gets the Navbar for free; every other part of the site is untouched.

---

## Step 4: Test the Flow End to End

Boot the dev server:

```bash
pnpm dev
```

### Logged-out state

1. Visit `http://localhost:5173/`. You should see the marketing site (no Navbar — the `(app)` layout doesn't apply here).
2. Click **Sign in** → `/login`. Log in with a user you created in Lesson 3.1 or 3.2.
3. After login, you're redirected to `/dashboard`. The Navbar appears: logo on the left, your email and a **Sign out** button on the right.

### Active-link highlighting

1. Click **Home** — it highlights blue.
2. Click **Pricing** — Pricing highlights, Home returns to slate.
3. Navigate to `/dashboard` — **Dashboard** highlights.

Behind the scenes, every navigation updates `page.url.pathname`, which forces the `{@const isActive = ...}` in each iteration to re-evaluate, which toggles the `class:text-blue-700` directive.

### Signing out

1. Click **Sign out**.
2. The button posts to `/account?/signout`. The `signout` action runs, calls `supabase.auth.signOut()`, and redirects to `/`.
3. You land on the home page, logged out. The Navbar is gone (because `/` is not in `(app)`).
4. Try manually navigating to `/dashboard`. The `(app)` layout's route guard redirects you to `/login?next=/dashboard`. Confirmation: session is invalidated.

### Verify the cookie is gone

1. Open DevTools → **Application** → **Cookies** → `http://localhost:5173`.
2. Before logout, you should see `sb-<ref>-auth-token` and its refresh partner.
3. After logout, they're gone (or set to an expired date).

### The no-JS fallback

1. Before you log in next, open DevTools → Command Palette → "Disable JavaScript."
2. Log in, arrive at `/dashboard`, click **Sign out**.
3. Even without JS, the form submits (full page reload), the server invalidates the session, and you land on `/`. Progressive enhancement delivered.

---

## Common Mistakes

- **Using `<a href="/logout">` and a GET endpoint.** Everything in the opening section warned about this. Don't.
- **Calling `supabase.auth.signOut()` on the client-side only.** It clears the local storage but doesn't revoke the session server-side. Someone who scraped the token earlier can keep using it. Always sign out on the server (via the form action + `locals.supabase`).
- **Forgetting `use:enhance`.** The form still works, but every logout triggers a full-page reload. Add `use:enhance` for the nicer UX.
- **Writing `action="?/signout"` in the Navbar.** The relative form works only if the Navbar is rendered on `/account`. Because the Navbar is on every `(app)` page, you need the absolute `action="/account?/signout"`.
- **Passing the user object to Navbar instead of just the email.** You'd leak more data to the client than necessary (full user metadata, created_at, etc.). Pass only what the component needs — a single string.
- **Using `$app/stores`.** Deprecated. Use `$app/state`. If you see `import { page } from '$app/stores'` in old StackOverflow answers, translate it: `import { page } from '$app/state'` and drop the `$page` prefix when reading values.
- **Redirecting to `/login` after logout.** Allowed, but usually worse UX than `/`. Redirect to the marketing home unless you have a reason not to.

---

## Principal Engineer Notes

1. **Server-side session invalidation is the point.** If you're ever tempted to implement logout as "delete the cookie on the client and call it a day," remember: an attacker who stole the session token doesn't have to use the victim's browser. They have the token. Only by invalidating it on the server do you close the hole. This is why we use `locals.supabase.auth.signOut()` in an action rather than clearing `document.cookie` in a client handler.

2. **POST for state change is a universal rule, not a SvelteKit rule.** The same reasoning applies to any framework, any backend. If an intern ever PRs "make logout a link, it's simpler" — this section is why you say no.

3. **The route guard is your last line of defense, not your first.** We depend on the `(app)/+layout.server.ts` guard to redirect post-logout users away from `/dashboard`. But `locals.supabase.auth.signOut()` also invalidates the session at the Supabase level. The double check is deliberate: defense in depth. If the route guard ever has a bug, the server-side session is still revoked; if server-side revocation is somehow bypassed, the route guard still bounces users. You want both.

4. **The Navbar knows nothing about Supabase.** Notice that our Navbar component takes only `userEmail: string | null`. It doesn't import Supabase, doesn't call any auth APIs, doesn't know how sessions work. That separation is intentional: the Navbar is a *pure presentation component*. The layout is the one doing the auth wiring. This pattern — layouts do the side-effectful data fetching, components render props — is how you keep large Svelte codebases testable and refactorable.

5. **`aria-current="page"` is not optional in production.** Screen reader users navigating a site by landmark don't see your blue underline. They need `aria-current` to know "this link represents the page you're currently on." Adding the attribute costs nothing and makes the Navbar meaningfully usable for more people. The industry term for this is "accessibility as a first-class concern" — not an afterthought, not a Module 11 bolt-on.

6. **Why not an `onclick` instead of a form?** If JavaScript is loaded, `<button onclick={...}>` calling `fetch('/logout', { method: 'POST' })` would work. But it fails the no-JS case — the button literally does nothing. Forms give you both worlds: no-JS submission, plus a `use:enhance` layer for enhanced UX. In a SvelteKit app, always prefer forms for state-changing actions over JS-only onclick handlers.

7. **Logout auditing (future).** For a real SaaS, you'll eventually want to log sign-out events (timestamp, IP, device). The easiest place to add this is inside the `signout` action, before `throw redirect(...)`. Something like `await supabase.from('auth_events').insert({ user_id: user.id, type: 'signout' })`. You'll add this kind of audit log in Module 11.

---

## Summary

- Added a `signout` named action at `/account/+page.server.ts` that calls `supabase.auth.signOut()` and redirects to `/`.
- Learned why logout must be POST: GET requests can be triggered by prefetchers, image tags, crawlers, and CSRF attacks — POST is the web's mechanism for intentional state change.
- Understood what Supabase's `signOut()` does server-side (revokes the session, deletes cookies) and why that's strictly stronger than clearing cookies client-side.
- Built an auth-aware Navbar component that uses `$app/state`'s `page` object and `$derived` to compute which links to show and which one is active.
- Wired the Navbar into `(app)/+layout.svelte` so every authenticated page shows it — and only `(app)` pages, preserving the chromeless auth and marketing layouts.
- Verified logout end-to-end: session cookie gone, route guard bounces post-logout dashboard requests, no-JS fallback works.

## Next Lesson

In **Lesson 3.5** you'll build the **Account page** that *displays* the logged-in user's profile — pulling their `full_name`, email, and sign-up date from the `profiles` table via a `load` function. You'll meet `.single()` vs. `.maybeSingle()`, see RLS working as defense-in-depth, and learn the right way to format dates in a SvelteKit app.
