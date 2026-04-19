---
title: "4.4 - Supabase Admin Client"
module: 4
lesson: 4
moduleSlug: "module-04-crud"
lessonSlug: "04-supabase-admin-client"
description: "Create a service-role Supabase client that bypasses RLS for server-side administrative operations."
duration: 10
preview: false
---

## Overview

So far, every Supabase query in Contactly has run as **the logged-in user**. That's correct for anything a user does on their own behalf: load their contacts, update their profile, delete their own data. Row-Level Security (RLS) policies enforce the rule "users only see their own rows," and `locals.supabase` respects those policies because it's tied to the user's session cookie.

But soon you'll hit cases where that model breaks down. When Stripe sends a webhook saying "user X just upgraded to Pro," there's no logged-in user — Stripe is calling your server. When a cron job needs to clean up stale records across thousands of users, there's no session to use. When an admin panel lets you impersonate a customer for support, you need to read **their** data while authenticated as **you**. These are all **system-level** operations, and they need a different kind of Supabase client.

In this lesson you'll create `supabaseAdmin` — a server-side-only Supabase client that uses the **service role key** to bypass RLS entirely. It's a loaded gun with the safety off, and the rest of this lesson is about why that's okay for specific use cases, how to lock it down so it never leaks to the browser, and the mental model for deciding which client to use when.

## Prerequisites

- Module 2 complete — `locals.supabase` and `locals.getUser()` work.
- Module 3 complete — you understand that RLS policies enforce row ownership.
- Your local Supabase is running (`pnpm supabase start`) so you can grab the service role key.

## What You'll Build

- `src/lib/server/supabase.ts` — a single file exporting `supabaseAdmin`, a service-role-authenticated client.
- An understanding of **why** `$lib/server/` in SvelteKit is a hard security boundary.
- A decision matrix for choosing `locals.supabase` vs `supabaseAdmin` on every future feature.
- A populated `.env` and `.env.example` so the rest of the team can boot the app without guessing at env names.

---

## Two Clients, Two Philosophies

Let's compare the two Supabase clients side by side, because once you see the difference, the "when to use which" decision becomes obvious.

| | `locals.supabase` (user client) | `supabaseAdmin` (this lesson) |
| --- | --- | --- |
| **Key used** | `PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| **RLS** | Enforced | **Bypassed entirely** |
| **Runs as** | The logged-in user's role | The `service_role` (database superuser-like) |
| **Needs a session?** | Yes — reads the auth cookie | No — the key **is** the auth |
| **Where it lives** | `hooks.server.ts`, per-request | `$lib/server/supabase.ts`, module-level |
| **Use it for** | Anything a specific user does on their own behalf | Anything the system does across users or without a user |
| **Bundled to client?** | Yes (client-side version too) | **Never — SvelteKit refuses to bundle it** |

The philosophical divide:

- **User client = "this user is doing this action."** Their identity is the cookie. RLS protects other users' data from being touched. The key is public (anyone can fetch it from the client JS bundle) because the real security boundary is the JWT cookie, not the key itself.
- **Admin client = "the system is doing this action."** There's no user context. RLS is not the protection — being on the server is the protection. The key is secret because anyone with it has **unrestricted** database access.

This matters because people coming from simpler stacks often assume "one database connection per app, used everywhere." In Supabase, because of RLS, you deliberately want **two** clients: one that plays by the user's rules, and one that plays by no rules. The job of your server code is to know which one to pick.

---

## What the Service Role Key Actually Is

`SUPABASE_SERVICE_ROLE_KEY` is a long JWT (JSON Web Token) that looks like `eyJhbGciOi...`. Decoded, its payload says something like:

```json
{
  "iss": "supabase",
  "ref": "your-project-ref",
  "role": "service_role",
  "iat": 1700000000,
  "exp": 9999999999
}
```

The key fields:

- **`role: "service_role"`** — this is what makes Supabase bypass RLS. Every Supabase query starts by asking "what role is this request running as?" If the answer is `service_role`, RLS policies are skipped — the role has access to everything.
- **`exp: 9999999999`** — the JWT "expires" in the year 2286. It never really expires. If it leaks, it's leaked forever until you rotate it.

Compare this to the **anon key** (`PUBLIC_SUPABASE_ANON_KEY`), which has `role: "anon"` and grants you nothing by default — every query is filtered through RLS, and RLS policies typically require `auth.uid()` to return a real user ID before any data is allowed through.

**The service role is effectively a database superuser for your Supabase project.** It can read any row, write any row, delete any row, across every table. Treat it like a root password.

### Where to find it

Two places:

**Option 1 — local (most common for dev):** run `pnpm supabase start`. The CLI prints all your local credentials:

```
API URL: http://127.0.0.1:54321
DB URL: postgresql://...
Studio URL: http://127.0.0.1:54323
anon key: eyJhbGciOi...  ← this is PUBLIC_SUPABASE_ANON_KEY
service_role key: eyJhbGciOi...  ← this is SUPABASE_SERVICE_ROLE_KEY
```

Copy the `service_role key` value. Note: local keys are **fake** — they're the same on every local install because they're signed with a well-known JWT secret. They only work against your local Supabase. You cannot use them to attack a real Supabase project. That's intentional: dev keys are throwaway.

**Option 2 — hosted (for staging/production):** log in to Supabase Dashboard, go to **Project Settings → API**. You'll see three keys:
- `anon` / `public` — this is your `PUBLIC_SUPABASE_ANON_KEY`
- `service_role` / `secret` — this is your `SUPABASE_SERVICE_ROLE_KEY`

The dashboard covers the service role with a "reveal" button specifically because clicking it is a serious action. Treat showing it on screen with the same gravity as you would showing a password on screen during a screenshare.

---

## Step 1: Add the Key to `.env`

Create or open the `.env` file at the root of your project and add:

```bash
# .env
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...your-local-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your-local-service-role-key...
```

The naming convention matters:

- **`PUBLIC_`-prefixed** vars are exposed to the browser bundle. They're safe to embed in client-side JavaScript. SvelteKit enforces this by exposing them only via `$env/static/public` (or `$env/dynamic/public`).
- **Non-`PUBLIC_`** vars are private. Available only on the server. Accessed via `$env/static/private` or `$env/dynamic/private`. If you try to import a private env var into a file that could be bundled to the client, SvelteKit throws a **build error**. That's one of the safeguards we'll lean on.

Then update `.env.example` — the checked-in template that tells collaborators which variables they need — to document the new var **without** its real value:

```bash
# .env.example
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key-here
```

**Why two files?** `.env` holds real secrets and is in `.gitignore` (check your root `.gitignore` — it should contain `.env`). `.env.example` is checked in so new teammates run `cp .env.example .env` and then fill in real values. Never flip these: committing `.env` leaks secrets; omitting `.env.example` means every new dev pings you on Slack asking "what env vars do I need?"

### The `$env` modules — the four-quadrant rule

SvelteKit exposes environment variables through four named modules:

| Module | Public or private? | Static or dynamic? | Use when |
| --- | --- | --- | --- |
| `$env/static/public` | Public | Static | Vars known at build time, safe for browser |
| `$env/static/private` | Private | Static | Vars known at build time, server-only |
| `$env/dynamic/public` | Public | Dynamic | Vars read at runtime, safe for browser |
| `$env/dynamic/private` | Private | Dynamic | Vars read at runtime, server-only |

We use `$env/static/public` for `PUBLIC_SUPABASE_URL` and `$env/static/private` for `SUPABASE_SERVICE_ROLE_KEY`. "Static" because the values are fixed at build time (you don't change Supabase URLs at runtime). The alternative would be `dynamic/*` — useful if you deploy one bundle to multiple environments, but overkill here.

The key point: **`$env/static/private` is a tripwire**. If you accidentally import it into a `.svelte` file or a `$lib/` file that gets bundled to the client, SvelteKit's build errors out with a loud message. We'll rely on that tripwire in the next step.

---

## Step 2: Create `src/lib/server/supabase.ts`

Create the file:

```typescript
// src/lib/server/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import type { Database } from '$lib/types/database.types'

export const supabaseAdmin = createClient<Database>(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)
```

A tiny file. Every line matters. Let's take it apart.

### Imports

```typescript
import { createClient } from '@supabase/supabase-js'
```

The core Supabase JS library. Not `@supabase/ssr` — that's for user-facing clients that hook into cookies. For the admin client, there's no session to sync with cookies; we just want a plain "authenticated by key" client. `@supabase/supabase-js` is the right choice.

```typescript
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
```

The URL is public (it's just a hostname — visible in every user-facing request anyway). The service role key is imported from **`$env/static/private`**. This is the critical line: it ties the entire file to the server-only universe. If anything anywhere imports from `$lib/server/supabase.ts` and ends up in a client bundle, the `$env/static/private` import triggers the SvelteKit build error.

Two safeguards, working together:

1. **The filename path `$lib/server/`.** SvelteKit treats anything inside `src/lib/server/` as server-only. Attempting to import from a server-only module into client code throws a build error with a clear message pointing at the offending import.
2. **The `$env/static/private` import.** Even if someone renamed the folder or bypassed path conventions, this import is a second fence.

Belt **and** suspenders. It would take two independent mistakes to leak the service role key to the browser.

```typescript
import type { Database } from '$lib/types/database.types'
```

The generated Supabase types file (you generated this in Module 2 via `pnpm supabase gen types typescript --local > src/lib/types/database.types.ts`). Importing it with `import type` means it's erased at compile time — no runtime cost. Passing it as the generic parameter `createClient<Database>(...)` makes every query type-aware: `supabaseAdmin.from('contacts').select('first_name, last_last_name')` would flag `last_last_name` as a typo at compile time. Worth doing.

### Creating the client

```typescript
export const supabaseAdmin = createClient<Database>(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)
```

- **`createClient(url, key, options)`** — the standard constructor. URL and key are the first two args.
- **`auth.autoRefreshToken: false`** — the supabase-js client tries to refresh JWTs periodically when used with user sessions. Here, there's no JWT to refresh — the service role key **is** the JWT, and it doesn't expire. Turning auto-refresh off avoids a background timer that would burn CPU for no reason.
- **`auth.persistSession: false`** — the client normally persists the user's session to localStorage (in the browser) or an in-memory cache (on the server) so it's available across calls. For the admin client, there's no session to persist. Turning it off keeps the admin client stateless and clean.

Both options are essentially "disable the user-session machinery." The service role key is self-contained; none of that scaffolding is needed.

### Why module-level and not per-request?

Notice we create `supabaseAdmin` **once** at module import time, not inside a function or a request handler. That's correct: the service role client is a singleton. It doesn't depend on any per-request state (no cookies, no user). Re-creating it per request would be wasteful (more connections, more memory, no benefit).

Contrast this with `locals.supabase`, which **does** need to be per-request because it depends on the request's cookies. Different lifecycle, different scope.

---

## Step 3: Understand `$lib/server/` — the Bundler-Level Safeguard

Stop and understand this rule, because it's one of SvelteKit's best features and it'll save you from bugs you'd otherwise spend weeks debugging.

**Anything inside `src/lib/server/` is NEVER bundled into client-side code.** No exceptions. If you import from `$lib/server/` into a `.svelte` file (which becomes a client-side component) or any code that ends up in the client bundle, the SvelteKit build **fails loudly** with:

```
Cannot import $lib/server/supabase.ts into client-side code
```

The error points you at the offending import. You can't ship a build that has the mistake — it won't even complete.

**Why this matters**: without this safeguard, a sleepy developer could write:

```svelte
<!-- ❌ WOULD EXPOSE SERVICE ROLE KEY IN CLIENT BUNDLE -->
<script lang="ts">
  import { supabaseAdmin } from '$lib/server/supabase'
  // ...
</script>
```

If SvelteKit didn't prevent this, `SUPABASE_SERVICE_ROLE_KEY` would be **baked into the JavaScript served to every user's browser**. Every visitor to your site could extract it from DevTools and gain full database access. It would be the kind of leak that ends careers.

The `$lib/server/` rule prevents this absolutely. Place all server-only code there. It's a social convention that SvelteKit makes mechanically enforced.

### The two layers of protection, restated

| Layer | What it does | When it fires |
| --- | --- | --- |
| `$lib/server/` folder path | Bans client imports of anything under this path | At build time |
| `$env/static/private` | Bans client imports of private env vars | At build time |

Both are build-time guarantees. Both will fail the build on violation. You don't need runtime vigilance; the tooling has your back.

---

## Step 4: When to Use Which Client — the Decision Matrix

You now have two Supabase clients. Every time you write server code that talks to Supabase, pick one:

### Use `locals.supabase` when...

- A logged-in user is performing an action on their own behalf.
- You want RLS to enforce row-level access (you want the database to reject queries for other users' data).
- The request came with a session cookie.

**Examples in Contactly**:
- Loading the contact list in `/contacts/+page.server.ts` — a user's own contacts, RLS filters.
- Updating a profile at `/account/+page.server.ts` — the user editing their own row.
- Deleting a contact — user owns the row, RLS enforces it.

### Use `supabaseAdmin` when...

- There's no user session (webhook, cron job, admin impersonation).
- You need to read/write data across users (analytics rollup, admin dashboard).
- You intentionally need to bypass RLS for a specific administrative action.

**Examples in Contactly** (coming in later modules):
- Stripe webhook receives `customer.subscription.updated` → we need to update `profiles.stripe_customer_id` based on the Stripe event, but there's no logged-in user — Stripe is calling us.
- A nightly cron job cleans up unverified `auth.users` rows older than 24 hours.
- An admin panel lets support staff view any user's contacts without logging in as them.

### The litmus test

Ask yourself: **"Is this action being performed by a specific user, on their own behalf?"**

- Yes → `locals.supabase`. RLS does the heavy lifting.
- No → `supabaseAdmin`. You are responsible for every access check by hand.

When you reach for `supabaseAdmin`, understand you've just opted out of RLS. Every database operation in that function needs to be **manually correct** — you must ensure you're only touching rows you should touch. There's no safety net. Take it seriously.

---

## Common Mistakes

### Mistake 1: Importing `supabaseAdmin` into a `.svelte` file

```svelte
<!-- ❌ BUILD FAILS -->
<script lang="ts">
  import { supabaseAdmin } from '$lib/server/supabase'
</script>
```

SvelteKit will refuse to build. The error is immediate and loud, which is **great** — the tooling caught your mistake before it shipped.

### Mistake 2: Using `supabaseAdmin` for user-initiated actions

```typescript
// ❌ DON'T — RLS bypassed means any user_id could be passed
export const actions = {
  updateContact: async ({ request }) => {
    const formData = await request.formData()
    const id = formData.get('id')
    // using admin for a user action is a security hole
    await supabaseAdmin.from('contacts').update({ name: '...' }).eq('id', id)
  }
}
```

If `id` comes from form data and you're using `supabaseAdmin`, a malicious user can submit any contact's ID and update it — they're not restricted to their own. Always use `locals.supabase` for user-initiated actions; RLS will reject cross-user queries automatically.

### Mistake 3: Using the anon key where the service role key is needed

```typescript
// ❌ won't work — anon key is gated by RLS
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)

// ...later, in a webhook handler:
await client.from('profiles').update({ plan: 'pro' }).eq('id', userId)
// fails — no auth.uid(), RLS blocks it
```

The anon key has no privileges of its own. To bypass RLS, you need the service role key. This is a common early mistake for people who mentally conflate "server-side" with "privileged." In Supabase, privilege is determined by the **key**, not by which side of the wire you're on.

### Mistake 4: Committing `.env` to git

Your `.env` file has the service role key in plaintext. If it ends up in git, it's leaked forever (rewriting history doesn't help — forks and clones retain it). Double-check your root `.gitignore`:

```
.env
.env.local
.env.*.local
```

And never run `git add .env` or `git add -A` without first checking `git status` to make sure `.env` isn't staged.

### Mistake 5: Reusing the client across projects

The service role key is **project-scoped**. A service role key from your staging Supabase project doesn't work against your production Supabase project. If you deploy the wrong key, you get cryptic auth errors. Sanity check: the URL and key should always be from the same project.

### Mistake 6: Turning on `persistSession` for the admin client

```typescript
// ❌ pointless, slightly harmful
auth: { persistSession: true }
```

There's no session to persist — the service role key is the credential. Enabling this just makes the client start writing to a fake session store and consuming memory for no reason. Always `persistSession: false` for admin clients.

---

## Principal Engineer Notes

### Note 1: The blast radius of leaking the service role key

If this key leaks, the attacker can:

- Read every row in every table (user emails, contact lists, billing info, passwords of other systems if you stored them).
- Write or delete any row (impersonate users, inject data, wipe the database).
- Drop tables, alter schema, disable RLS entirely.
- Create new users with known passwords and log in as them.

In short: **game over**. Everything in your Supabase project is compromised. The recovery path is painful: rotate the key in the dashboard (immediately invalidating the old one), redeploy with the new key, audit logs for suspicious activity, notify affected users if any data was accessed.

Treat this key with **more** care than a database root password — at least with a root password, the firewall gates access. The service role key, if leaked, is exploitable from any internet-connected machine.

### Note 2: Defense-in-depth is not paranoia

You might feel like we're being excessive: RLS **and** `$lib/server/` **and** `$env/static/private` **and** a `.env` file convention. Isn't one of these enough?

No. Each layer defends against different failure modes:

- **RLS** protects against mistakes in **application logic** — if you forget a `.eq('user_id', ...)` filter, RLS still blocks cross-user access.
- **`$lib/server/`** protects against mistakes in **code organization** — if someone imports server code into a client component, the build fails.
- **`$env/static/private`** protects against mistakes in **env var handling** — if someone tries to expose a private var via a public import, the build fails.
- **`.env` in `.gitignore`** protects against mistakes in **version control** — if someone `git add`s carelessly, the file is ignored.

Any single layer could fail silently in edge cases. Four layers stacking on top of each other means several independent mistakes would have to align before there's a real leak. That's defense-in-depth. It's how systems that handle user data avoid catastrophe.

### Note 3: The deeper security principle — "key = identity"

Traditional web apps use database connections authenticated by a single shared database password. Every query runs as the same database user. Authorization is implemented in application code ("does this user have permission to do this?").

Supabase flips that: the key you use **determines which role you are**. Anon key = anon role. Service role key = service_role role. User JWT = `authenticated` role with their user ID. Authorization is implemented in the database itself via RLS policies that reference `auth.uid()` and roles.

This "key = identity" model has a huge benefit: database-level authorization means SQL injection or logic bugs in your app can't bypass security — the database itself enforces the rules. But the cost is that **key discipline matters absolutely**. A leaked key doesn't just reveal data; it impersonates an entire role. The service role key is the most powerful role you have.

### Note 4: When you think you need admin but you don't

Before reaching for `supabaseAdmin`, pause and ask: **is there a way to do this with `locals.supabase` instead?**

- "I need to read this user's contacts as the admin" — can you add an RLS policy that admins pass (`role = 'admin'` check)? Then `locals.supabase` still works.
- "I need to insert a row on signup" — can a database trigger do it, like `handle_new_user`? Then no app-level admin call needed.
- "I need to update a user's plan after Stripe" — fair, there's no user session during a webhook. This is the legitimate use case.

Admin clients are powerful but seductive — it's easy to reach for them just because they "skip the annoyance" of RLS. Resist that. RLS exists for a reason, and every admin-client call is a line of code where **you** have to get security right, not the database. Be stingy.

### Note 5: Auditing admin usage

In a growing team, it's useful to grep the codebase periodically for `supabaseAdmin` usage. Each call site is a place where security depends on the programmer getting it right. You can add a small lint rule or code-review checklist: "every `supabaseAdmin` call should have a comment explaining why admin is needed here." Something like:

```typescript
// We need admin here because Stripe webhooks don't have a user session.
const { error } = await supabaseAdmin
  .from('profiles')
  .update({ plan: 'pro' })
  .eq('stripe_customer_id', customerId)
```

Forcing the "why" into a comment nudges future developers to think before adding new admin calls. Cheap tooling, high leverage.

### Note 6: Rotating the key

Supabase lets you rotate the service role key from the dashboard. You should rotate it **immediately** if:

- You accidentally committed it to git (even if you reverted).
- You shared it over an insecure channel (Slack DM, email, plain HTTP).
- A team member with access to production leaves the company.
- You detect any suspicious activity.

Rotation is cheap — update one env var and redeploy — but only if you have a clean deployment path. In this course we'll set that up in Module 12 (CI/CD), where "rotate this secret" becomes a ten-minute task instead of a weekend scramble.

---

## What's Next

You now have `supabaseAdmin` wired up and understand when to reach for it. In Lesson 4.5 we'll start building the contacts feature with `locals.supabase` — the default, RLS-enforced, per-user client. You won't actually call `supabaseAdmin` in this module, but when Module 7 introduces Stripe webhooks, you'll import this exact file and be grateful it's waiting.

The two-client pattern is now part of your muscle memory: user actions use `locals.supabase`, system actions use `supabaseAdmin`. Every feature you build for the rest of this course will pick one. Pick carefully.
