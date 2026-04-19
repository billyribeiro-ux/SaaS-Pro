---
title: "3.5 - Account Page (Display Profile)"
module: 3
lesson: 5
moduleSlug: "module-03-user-auth"
lessonSlug: "05-account-page"
description: "Build the account page's server load and UI to display the logged-in user's profile from the profiles table."
duration: 20
preview: false
---

## Overview

Users can now register, log in, and sign out. The next natural feature is a place where they can **see their profile** — their name, email, and when they joined. This is the bare-bones Account page.

It sounds trivial. It is not. Behind "display three fields" are a dozen real decisions: where does the data come from? How do we handle a missing row? Is Row-Level Security enough, or do we still filter? Why load on the server? Why `.single()` instead of `.maybeSingle()`? What's the right way to format a date? We're going to answer every one of those questions in this lesson.

By the end you'll have:
1. A `load` function on `/account` that fetches the current user's profile from Supabase.
2. A Svelte page that renders the profile data in a clean card.
3. A rock-solid mental model for **server-side data loading** in SvelteKit — the pattern you'll reuse on every page of Contactly going forward.

## Prerequisites

- Module 1 complete — `public.profiles` table exists with a trigger that creates a profile row on every new `auth.users` insert.
- Module 2 complete — a per-request Supabase server client is available as `event.locals.supabase`, and `event.locals.getUser()` is wired up in `hooks.server.ts` (it calls `supabase.auth.getUser()`, which validates the JWT against Supabase's auth server).
- Lesson 3.3 complete — the `(app)` route group has a layout guard redirecting unauthenticated users.
- Lesson 3.4 complete — the Navbar and `signout` action are in place.

## What You'll Build

- `src/routes/(app)/account/+page.server.ts` with a `load` function that fetches the user's profile using RLS-protected queries.
- `src/routes/(app)/account/+page.svelte` that displays email, full name, and sign-up date in a styled card.
- Typed data flow from SQL → Supabase → load → page via `PageData` and `Tables<'profiles'>`.

## Key Concepts

- **Server load functions** (`+page.server.ts`) vs. universal loads — why account data belongs on the server.
- **`.single()` vs. `.maybeSingle()`** — the difference between "exactly one row" and "zero or one row."
- **RLS as defense in depth** — why `.eq('id', user.id)` is still good practice even when Supabase is already filtering by the authenticated user.
- **Typing Supabase results** — `Tables<'profiles'>` for cleanly-typed rows.
- **Date formatting** — `toLocaleDateString`, user locales, and why `toString()` is the wrong answer.
- **Handling missing data gracefully** — what to do if the profile row is somehow absent.

---

## Why Load on the Server (Not the Client)

A question a lot of beginners ask: "Can't I just call `supabase.from('profiles').select()` in `onMount`?"

Technically yes. Practically, no — here's why:

1. **No flash of no-data.** If you fetch on mount, the page renders first (empty placeholders), *then* the data arrives. Users see a flicker. Server-loaded data is present on the very first paint.
2. **Works without JavaScript.** A server-rendered page with the data baked in is readable even if the JS bundle never loads. That's a nontrivial chunk of users (slow connections, JS-disabled browsers, some accessibility tools).
3. **SEO (when applicable).** The account page is behind auth so it won't be indexed, but for public pages the same pattern matters — crawlers see server-rendered content.
4. **Security-sensitive code stays on the server.** If you ever add logic like "only fetch if user is admin," you don't want that logic shipped to the client's JS bundle. Server-side loads run on the server, full stop.
5. **The client-side SDK needs the user to be signed in *in the browser*.** When rendering server-side for the first time, the browser hasn't run any client JS yet — so `createBrowserClient` hasn't hydrated. Server loads sidestep this entirely.

The rule of thumb we'll follow throughout Contactly: **if data can be fetched on the server, fetch it on the server.** Save client-side fetches for things that are truly dynamic and user-triggered (search-as-you-type, realtime subscriptions, optimistic UI after a form submit).

---

## Step 1: Create the `load` Function

Open (or create) `src/routes/(app)/account/+page.server.ts`. If you followed Lesson 3.4, this file already has the `signout` action — we'll add the `load` alongside it.

```typescript
// src/routes/(app)/account/+page.server.ts
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = await locals.getUser();
  if (!user) {
    // Belt-and-suspenders: the (app) layout guard already redirects,
    // but we repeat the check here so TypeScript narrows `user` to non-null.
    redirect(303, '/login');
  }

  const { data: profile, error: dbError } = await locals.supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, created_at, updated_at')
    .eq('id', user.id)
    .single();

  if (dbError) {
    // Something is genuinely wrong — the profile row should always exist
    // thanks to the handle_new_user() trigger. Surface a 500 so we notice.
    error(500, 'Could not load your profile. Please try again.');
  }

  return {
    profile
  };
};

export const actions: Actions = {
  signout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    redirect(303, '/');
  }
};
```

Now let's take this apart piece by piece.

### `PageServerLoad` — the typed load signature

```typescript
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
```

- **`PageServerLoad`** is a type SvelteKit auto-generates per route. It describes exactly what a `load` function at *this specific path* gets passed (URL params, cookies, `locals`, etc.) and what it's expected to return.
- Typing the export as `PageServerLoad` gives you:
  - Autocomplete on the event argument (try typing `event.` and seeing `locals`, `params`, `url`, `fetch`, `cookies`, `setHeaders` pop up).
  - Full type inference downstream: whatever you return flows into the page's `data` prop as `PageData`.
- **`async ({ locals })`** — we destructure only `locals` since that's all we need. Tidy and explicit.

### The user check

```typescript
const user = await locals.getUser();
if (!user) {
  redirect(303, '/login');
}
```

The `(app)` layout's `+layout.server.ts` already guards the whole group — unauthenticated requests never reach this `load`. So why re-check?

- **TypeScript narrowing.** `locals.getUser()` returns `Promise<User | null>`. After the `if (!user)` guard, TypeScript knows `user` is non-null for the rest of the function. Without this, every downstream `user.id` access would need `!` or `?.` noise.
- **Defense in depth.** If someone refactors the layout guard tomorrow and breaks it by mistake, this check still keeps unauthenticated requests out of the query. A double-barrier costs nothing and protects against regressions.
- **Explicit intent.** Reading the file in isolation, a reviewer sees "this page requires a user" without having to go trace the layout chain.

### The Supabase query

```typescript
const { data: profile, error: dbError } = await locals.supabase
  .from('profiles')
  .select('id, email, full_name, avatar_url, created_at, updated_at')
  .eq('id', user.id)
  .single();
```

Line-by-line:

- **`locals.supabase`** — the per-request, cookie-aware Supabase client you wired up in `hooks.server.ts` in Module 2. Because it carries the user's session cookies, every query it runs is executed *as that user* — Row-Level Security policies see `auth.uid()` equal to the user's ID.
- **`.from('profiles')`** — target the `profiles` table.
- **`.select(...)`** — explicitly list every column we need. Why not `.select('*')`? A few reasons:
  - **Future-proofing.** If a column with sensitive or wasteful data is added later (say `internal_notes` for admin use), a `*` silently starts leaking it to the page. Named columns don't.
  - **Payload size.** On tables with many columns or large TEXT/JSON fields, fetching only what you render keeps responses small.
  - **Intent.** When a reviewer reads the line, they immediately know which fields the page depends on.
- **`.eq('id', user.id)`** — filter to the row where `profiles.id = user.id`. This is "fetch my profile, not everyone's."
- **`.single()`** — tell Supabase "I expect exactly one row." If zero or more than one row match, it returns an error instead of data. We'll dig into this next.

### `.single()` vs. `.maybeSingle()` — semantic precision matters

Supabase gives you three variations:

| Method | Returns | When 0 rows | When 1 row | When >1 rows |
|---|---|---|---|---|
| no modifier | `data: T[] \| null` | `[]` | `[row]` | `[r1, r2, ...]` |
| `.maybeSingle()` | `data: T \| null` | `null`, no error | row | error |
| `.single()` | `data: T` (typed non-null) | error | row | error |

Use **`.single()`** when "zero rows" is a bug, not a normal outcome — your query *must* return a profile because the trigger created one. If somehow zero rows come back, something is broken (trigger failure, data corruption, wrong user id) and we want to know.

Use **`.maybeSingle()`** when "zero rows" is a valid, expected state. Example: "does this user have an active subscription?" — a user with no subscription is a perfectly normal result, not an error. In Lesson 3.6 we'll use `.maybeSingle()` for exactly this reason on a different query.

**Never use the no-modifier form and then grab `[0]`.** `data[0]` is `T | undefined`, forcing you to re-narrow. `.single()` is the typed, explicit equivalent.

### Is `.eq('id', user.id)` Redundant Because of RLS?

This is a question you should ask yourself on every RLS-protected query. It's worth understanding deeply.

**Your RLS policy:**

```sql
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);
```

This says: any SELECT against `profiles` is automatically filtered server-side so the only rows returned are those where `id = auth.uid()`. In theory, if you ran `supabase.from('profiles').select('*')` with no `.eq()`, you'd still get only your own row. So is `.eq('id', user.id)` doing anything?

Yes — several things:

1. **Defense in depth.** RLS is your last line of defense. The explicit filter is a redundancy. If an RLS policy gets accidentally loosened (say a migration adds `or auth.role() = 'service_role'`), the explicit filter still narrows the result. Security people call this principle "belt and suspenders" — multiple independent mechanisms, so failure of one doesn't expose the whole system.
2. **Query performance.** The query planner uses indexes. `WHERE id = '<uuid>'` hits the primary-key index directly, returning the target row immediately. RLS filters are applied in addition, but on top of an already-narrow scan — not replacing the need for a good WHERE.
3. **`.single()` requires a single row.** Without the explicit filter, if RLS somehow returned zero rows, we'd still error out at `.single()`. With the filter, the error is more specific ("filter didn't match" — easier to debug).
4. **Readability.** Someone reading the code without knowing the RLS policy can still understand the intent: "fetch this user's profile." They don't have to chase three files to understand the filter.

The mental model: **RLS is a guard, the explicit filter is a statement of intent.** They complement each other. Never rely solely on RLS; never rely solely on explicit filters. Use both.

### Handling the error path

```typescript
if (dbError) {
  error(500, 'Could not load your profile. Please try again.');
}
```

`error()` (imported from `@sveltejs/kit`) throws internally, so calling it halts the load function and SvelteKit renders the nearest `+error.svelte` boundary. Unlike `fail()` (which we use in form actions for recoverable validation errors), `error()` is for *unexpected* problems — something's broken, show a dedicated error page. (Pre-SvelteKit 2 you had to write `throw error(...)` yourself; both still work, but the modern form omits `throw`.)

- **Why 500?** We don't know exactly what went wrong, but we do know it's our fault: the DB should have returned the row. 500 Internal Server Error is the honest status.
- **Why a user-friendly message?** In production, you should *never* surface raw DB errors to users. They can leak table names, column names, and — in some cases — values. A generic "please try again" is right. You can still log the real `dbError` to your monitoring system:

  ```typescript
  if (dbError) {
    console.error('profile load failed', { userId: user.id, dbError });
    error(500, 'Could not load your profile. Please try again.');
  }
  ```

  In Module 11 we'll wire this to a proper logging service.

### The return

```typescript
return { profile };
```

What you return from a load function becomes the `data` prop on the matching `+page.svelte`. Simple. SvelteKit serializes the object (JSON + a little extra for `Date`/`Map`/`Set`) and sends it to the browser with the HTML.

---

## Step 2: Render the Profile

Create `src/routes/(app)/account/+page.svelte`:

```svelte
<!-- src/routes/(app)/account/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();

  const profile = $derived(data.profile);

  const joinedOn = $derived(
    profile?.created_at
      ? new Date(profile.created_at).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : '—'
  );
</script>

<svelte:head>
  <title>Account — Contactly</title>
</svelte:head>

<section class="mx-auto max-w-2xl px-4 py-10">
  <h1 class="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
    Your account
  </h1>
  <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
    Your profile information on Contactly.
  </p>

  <div
    class="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
  >
    <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Profile</h2>

    <dl class="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt class="text-slate-500 dark:text-slate-400">Email</dt>
        <dd class="mt-1 font-medium text-slate-900 dark:text-slate-100">
          {profile?.email ?? '—'}
        </dd>
      </div>

      <div>
        <dt class="text-slate-500 dark:text-slate-400">Full name</dt>
        <dd class="mt-1 font-medium text-slate-900 dark:text-slate-100">
          {profile?.full_name ?? 'Not set'}
        </dd>
      </div>

      <div>
        <dt class="text-slate-500 dark:text-slate-400">Joined</dt>
        <dd class="mt-1 font-medium text-slate-900 dark:text-slate-100">
          {joinedOn}
        </dd>
      </div>
    </dl>
  </div>
</section>
```

### Script block walkthrough

```typescript
import type { PageData } from './$types';

type Props = {
  data: PageData;
};

let { data }: Props = $props();
```

- **`PageData`** — another auto-generated type, derived from what your `load` function returns. If your load returns `{ profile }`, `PageData` has `profile` with the inferred Supabase row type. You don't have to declare it manually.
- **`type Props = { data: PageData }`** — our component's input contract.
- **`let { data }: Props = $props()`** — destructure `data` out of props.

```typescript
const profile = $derived(data.profile);
```

A small convenience: we alias `data.profile` to `profile` so the template stays readable (`{profile?.email}` beats `{data.profile?.email}`). Using `$derived` (not just `=`) keeps it reactive in case `data` is ever re-sent after a form action — important in Lesson 3.6.

```typescript
const joinedOn = $derived(
  profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '—'
);
```

This is where it gets interesting. We're formatting the sign-up date for display.

### Why `toLocaleDateString`, not `toString()`?

`new Date(isoString).toString()` returns something like:

```
Sat Apr 18 2026 12:43:05 GMT-0400 (Eastern Daylight Time)
```

That's fine for debugging but terrible for users. Problems:

- It's always English, regardless of the user's browser locale.
- It leaks technical detail (timezone abbreviation, seconds).
- It's hard to skim — especially for dates that are days/weeks/years old.

`toLocaleDateString(undefined, { year, month, day })` is the professional answer:

- **`undefined` as the first argument** — tells the browser "use the user's preferred locale." For a US user, that's `en-US` ("April 18, 2026"). For a UK user, `en-GB` ("18 April 2026"). For a French user, `fr-FR` ("18 avril 2026"). The browser handles the translation; you don't hand-roll locale tables.
- **`{ year: 'numeric', month: 'long', day: 'numeric' }`** — the format *parts* you want, not their literal layout. The locale decides the order and separators.
- **Why not hard-code `'en-US'`?** Because if your user's browser is set to French, you should respect that. Hard-coding a locale is a choice worth making only when you have a good reason (e.g., internal dashboards for a single-country company).

Security note: the raw `profile.created_at` from Supabase is an ISO 8601 string (e.g., `"2026-04-18T16:43:05.123Z"`). `new Date()` parses it reliably; no regex or `split()` gymnastics required.

### The template walkthrough

#### `<svelte:head>`

```svelte
<svelte:head>
  <title>Account — Contactly</title>
</svelte:head>
```

`<svelte:head>` is SvelteKit's way to inject content into the `<head>` of the document — `<title>`, `<meta>`, `<link>` tags, etc. Here we set a page-specific title so browser tabs and bookmark entries are meaningful. Every new page in Contactly should do this; it's a low-cost UX win.

#### The description-list pattern

```svelte
<dl class="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
  <div>
    <dt class="text-slate-500 dark:text-slate-400">Email</dt>
    <dd class="mt-1 font-medium text-slate-900 dark:text-slate-100">
      {profile?.email ?? '—'}
    </dd>
  </div>
  ...
</dl>
```

- **`<dl>` / `<dt>` / `<dd>`** — the HTML "description list" tags. `<dt>` is the *term* (label), `<dd>` is the *description* (value). Using the semantic tags instead of generic `<div>`s makes the structure readable to screen readers and legible to other developers.
- **`grid-cols-1 sm:grid-cols-2`** — single column on mobile, two columns on `sm` (≥640px) and up. Tailwind's mobile-first responsive prefixes handle this without any media queries.
- **`{profile?.email ?? '—'}`** — optional chaining + nullish coalescing. If `profile` is null (shouldn't happen, but just in case), show an em-dash instead of blank. If `profile.email` is null, same thing. Defensive rendering.

#### Why `'Not set'` for the full name?

```svelte
<dd>{profile?.full_name ?? 'Not set'}</dd>
```

Our `handle_new_user` trigger reads `raw_user_meta_data->>'full_name'` — if a user signed up without providing a name (say, via OAuth that doesn't expose one), `full_name` might be null. A "Not set" placeholder is more informative than a dash; it also telegraphs to the user that they can (and in Lesson 3.6 will!) change it.

---

## Step 3: Verify It Works

### Happy path

1. Boot the dev server: `pnpm dev`.
2. Make sure you're logged in (if not, go to `/login`).
3. Navigate to `http://localhost:5173/account`.
4. You should see:
   - Your email in the Email field.
   - Your full name (or "Not set") in the Full name field.
   - A human-readable "Joined" date.
5. Open DevTools → Network tab → reload. Note that the `/account` response HTML already contains your data — no blank-then-populate flicker. That's server-side rendering paying off.

### RLS verification

1. Create a second user (via `/register`). Note their user ID in Supabase Studio.
2. Log in as the first user.
3. Navigate to `/account`. You see *your* data.
4. Open DevTools → Console. Try to hit Supabase directly as the current user:

   ```js
   const { data } = await window.supabase.from('profiles').select('*');
   console.log(data);
   ```

   You get one row — your own. Even though you asked for "all rows," RLS limited the query to `auth.uid() = id`. If you could see the other user's profile, that would be a security bug.

### Error boundary

For a quick sanity check of the error path:

1. In `+page.server.ts`, temporarily change `.eq('id', user.id)` to `.eq('id', 'clearly-not-a-uuid')`.
2. Reload `/account`. You should see SvelteKit's default error page with status 500 and your "Could not load your profile" message.
3. Revert the change.

If you had `src/routes/+error.svelte`, you'd see that instead — we'll style a proper error page in Module 11.

---

## Common Mistakes

- **Using `.select('*')` in production**. Works today, leaks columns tomorrow when someone adds one. List columns explicitly.
- **Using `.maybeSingle()` here and letting `profile` be `null`**. The trigger guarantees a profile row — `.single()` is the right level of strictness. Use `.maybeSingle()` only where a missing row is a valid business state.
- **Fetching the profile in `onMount`**. Causes flash of no data, breaks no-JS users, complicates testing. Load on the server unless you have a specific reason not to.
- **Skipping the `.eq('id', user.id)` filter because "RLS will handle it."** RLS *will* handle it, but you're discarding readability, defense-in-depth, and explicit intent. Always pair the two.
- **Using `new Date(profile.created_at).toString()` or a hand-rolled format**. `toLocaleDateString` gives you locale-aware, professional-looking dates for free.
- **Not typing the page props**. `let { data } = $props()` without a type annotation compiles but loses autocomplete. Always annotate with `PageData`.
- **Displaying the raw email from `user.email` (the Supabase auth user) instead of `profile.email`**. Almost always these agree, but there are corner cases (email change pending, trigger behind the auth.users row). Prefer the source of truth you're modeling — the `profiles` table.
- **Forgetting `svelte:head`**. The browser tab shows "Contactly" (or worse, the URL) on every page. A title per page is a small-effort high-value UX improvement.

---

## Principal Engineer Notes

1. **RLS is defense in depth, not the fence.** Never design a system where the *only* thing preventing unauthorized access is an RLS policy. Explicit filters in the query, auth checks in the load function, and RLS — three independent layers. Any one of them failing should not expose data. The same principle applies to *writes*: explicit `update({...}).eq('id', user.id)` even though an RLS update policy exists.

2. **Load functions are the right boundary for auth checks.** Notice we call `locals.getUser()` here even though the layout guard already does. That's intentional. Each load function should be defensible in isolation — if someone copy-pastes the query into a different route, the safety checks come with it. This is how senior engineers think about "boundary-safe" code: every entry point protects itself.

3. **Hand-rolled date formatting is a code smell.** If you ever see `.split('T')[0]` or `d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()` in a professional codebase, something is wrong. `Intl.DateTimeFormat` (which `toLocaleDateString` wraps) is a browser-native API that handles months/days/locales/timezones/right-to-left scripts correctly. Trust it.

4. **What happens if the profile row is missing?** We treat it as a 500 because the trigger *should* guarantee a row. In practice, a few things could cause a missing row: a trigger failure during user creation (rare but possible), a race where a user logs in before the trigger commits (extremely unlikely, SQL transactions don't let this happen), or a deliberate `DELETE` by an admin. If this happens in production, it's a signal worth investigating — not a silent "show empty page" situation. By throwing `error(500)`, we force ourselves to notice.

5. **The `profile` object is server-sourced, so no client-side trust needed.** Some engineers reach for client-side validation here ("is the email format valid before showing it?"). Don't. The data came from *your* database, written by *your* server code. If the email in the `profiles` row is somehow invalid, that's a *your problem*, not a rendering problem. Trust the server; validate at boundaries (user input, third-party APIs).

6. **Typed flow from DB to UI.** The types in this lesson flow automatically: `database.types.ts` (generated from the schema) → Supabase client → load return → `PageData` → page props. Zero manual synchronization. That's the point of running `supabase gen types` and using the generated types — the compiler keeps rendering and data in sync. When you refactor a column name in SQL, the `pnpm supabase:types` regeneration + `tsc` pass tells you every place in Svelte that needs updating.

7. **Why not a `select('email, full_name, created_at')` alias like `name`?** PostgREST (what Supabase uses under the hood) supports column aliases: `.select('email, name:full_name')`. You *could* do that. We don't, because keeping the DB column names one-to-one with our TypeScript field names reduces cognitive overhead. One name per thing. When aliases are warranted (e.g., a join with ambiguous column names), reach for them — but don't aliasing by default.

---

## Summary

- Wrote a `PageServerLoad` that fetches the current user's profile via `locals.supabase.from('profiles').select(...).eq('id', user.id).single()`.
- Understood the distinction between `.single()` and `.maybeSingle()` and why `.single()` is right when the row is guaranteed.
- Internalized RLS as defense-in-depth, *alongside* explicit filters — not a substitute for them.
- Handled unexpected DB errors with `error(500)` routed through SvelteKit's error boundary.
- Built a typed `+page.svelte` that renders email, full name, and a locale-aware joined date via `toLocaleDateString`.
- Saw that server-loaded data is present on first paint — no flash, no `onMount` gymnastics.

## Next Lesson

In **Lesson 3.6** you'll add two more named actions to `/account`: `updateProfile` (change your full name) and `updatePassword` (change your password). You'll also learn the pattern for **disambiguating multiple forms on a page** via a `form` discriminator, how to use `form.action === '?/actionName'` in `use:enhance`, and why Supabase doesn't require the current password on `updateUser({ password })` (and when you should add that extra check anyway).
