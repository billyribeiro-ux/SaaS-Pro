---
title: '2.2 - Install Supabase SDKs & Generate Types'
module: 2
lesson: 2
moduleSlug: 'module-02-supabase-integration'
lessonSlug: '02-install-sdks-generate-types'
description: 'Install the Supabase JavaScript SDK and SSR helper, then generate fully-typed TypeScript definitions from your database schema.'
duration: 10
preview: false
---

## Overview

In this lesson you'll install the two Supabase JavaScript libraries Contactly needs and regenerate TypeScript definitions from the live database schema. After this lesson, every Supabase call your code makes will be type-checked against the actual tables and columns in your database — so typos fail at compile time, not in production.

## Prerequisites

- Lesson 2.1 complete — your `.env` file contains `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Your local Supabase stack is running (`pnpm db:status` shows it as running).

## What You'll Build

- Both Supabase packages installed as production dependencies.
- A fresh `src/lib/types/database.types.ts` generated from your schema.
- Helper type aliases that make common patterns (like "the shape of a profiles row") concise and correct.
- A pnpm script for regenerating types easily whenever the schema changes.

---

## What Is an SDK, and What Do These Two Packages Do?

An **SDK (Software Development Kit)** is a library that wraps a service's API in ergonomic functions for a specific language. Instead of building raw HTTP requests to Supabase with `fetch`, you call `supabase.from('profiles').select()` and the SDK handles the details: URL construction, auth headers, pagination, error shapes, retry logic.

For Contactly we need two packages from Supabase:

### `@supabase/supabase-js` — the core SDK

This is the universal Supabase client. It works in browsers, on servers, in Deno, in Cloudflare Workers, anywhere JavaScript runs. It provides:

- **Database queries** — `supabase.from('profiles').select().eq('id', userId)` etc.
- **Auth** — `supabase.auth.signUp()`, `signInWithPassword()`, `signOut()`, `getUser()`.
- **Storage** — `supabase.storage.from('avatars').upload(...)`.
- **Realtime** — `supabase.channel('contacts-changes').on(...)`.
- **Edge Functions** — `supabase.functions.invoke(...)`.

Every Supabase application uses this package. It's the foundation.

### `@supabase/ssr` — server-side rendering helpers

`@supabase/supabase-js` on its own isn't enough for SvelteKit. The issue is **session storage**:

- In a single-page React app, sessions live in `localStorage`. The server never sees them.
- In SvelteKit, the server _has to_ see the session, because SvelteKit renders pages on the server using the logged-in user's data. That means auth state must travel in **cookies**, which both server and browser can read.

`@supabase/ssr` wraps `@supabase/supabase-js` with cookie-based session management. It provides two client constructors:

- **`createServerClient()`** — used in `hooks.server.ts` and other server code. Reads and writes cookies via SvelteKit's `event.cookies` API.
- **`createBrowserClient()`** — used in layouts and components. Reads and writes cookies via the browser's `document.cookie`.

Both produce the same interface (`SupabaseClient<Database>`) so the rest of your code doesn't care where it is.

### Why two packages instead of one?

Good question. The split exists for bundle size and separation of concerns:

- `@supabase/supabase-js` is environment-agnostic.
- `@supabase/ssr` brings in the cookie/SSR glue, which is only useful in specific frameworks (SvelteKit, Next.js, Remix, etc.).

Keeping them separate means a client-only React app doesn't pay the size cost of SSR helpers, and a server-only Node tool doesn't pull in browser assumptions.

### Historical note — `@supabase/auth-helpers-sveltekit` is deprecated

If you read older tutorials, you may see `@supabase/auth-helpers-sveltekit`. That package is **deprecated**. It was split up into `@supabase/ssr` plus framework-specific guidance. Don't install it; use `@supabase/ssr` directly.

---

## Installing the Packages

From your `contactly/` project root:

```bash
pnpm add @supabase/supabase-js @supabase/ssr
```

**Reading this command:**

- `pnpm add` — install a new dependency.
- No `-D` flag — these are **runtime** dependencies (the app needs them to run in production), not dev-only tools.
- Two package names — install both in one command.

**Expected output:**

```
Packages: +30 -0
Progress: resolved X, reused X, downloaded 2, added 2
```

Verify they're listed in `package.json`:

```json
{
	"dependencies": {
		"@supabase/ssr": "^0.x.x",
		"@supabase/supabase-js": "^2.x.x"
	}
}
```

Your versions may differ — the packages are actively maintained and update frequently. The `^` prefix means "compatible with this major version" — pnpm will update to newer minor or patch releases on `pnpm install`, but won't cross a major version boundary automatically.

---

## Why Regenerate TypeScript Types?

In lesson 1.4 you ran `pnpm db:types` once. You may be wondering why we're doing it again.

**Answer: your schema changes, and your types must chase it.**

Every time you write a new migration — add a table, add a column, change a type, write a function — your database has a new shape. The types file in `src/lib/types/database.types.ts` is a **snapshot** of that shape at the moment you generated it. If it goes stale, TypeScript confidently accepts queries that no longer match reality. You get green CI and broken production.

**The rule: run `pnpm db:types` after every migration, before committing.** It's a short command, and it's the difference between "TypeScript protects you" and "TypeScript lies to you."

---

## Regenerating the Types

Make sure your local Supabase stack is running:

```bash
pnpm db:status
```

If you see a list of URLs and keys, you're good. If not, run `pnpm db:start`.

Now regenerate types:

```bash
pnpm db:types
```

This is the script you added in lesson 1.2:

```json
"db:types": "supabase gen types typescript --local > src/lib/types/database.types.ts"
```

**Reading the command:**

- `supabase gen types typescript` — generate TypeScript type definitions.
- `--local` — introspect the **local** database. (You can also aim at a remote project with `--project-id`.)
- `> src/lib/types/database.types.ts` — the `>` operator redirects the command's output to a file. If the file doesn't exist, it's created. If it does, it's overwritten.

Open `src/lib/types/database.types.ts`. You should see a large, auto-generated file. At the top there's typically a comment like `// This file was automatically generated — do not edit manually.`

**Rule: never edit this file by hand.** It's overwritten on every regen. If you need custom types, put them in a separate file.

### What's inside

Scroll through and you'll see a structure like:

```typescript
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	public: {
		Tables: {
			profiles: {
				Row: {
					id: string;
					email: string;
					full_name: string | null;
					avatar_url: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					email: string;
					full_name?: string | null;
					avatar_url?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					email?: string;
					full_name?: string | null;
					avatar_url?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			/* ... */
		};
		Functions: {
			/* ... */
		};
		Enums: {
			/* ... */
		};
		CompositeTypes: {
			/* ... */
		};
	};
};
```

Three type shapes per table:

| Type         | Purpose                                                                                                   | When you use it          |
| ------------ | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| **`Row`**    | The shape of a row when you SELECT. All columns present, nullable ones typed as `T \| null`.              | Reading data.            |
| **`Insert`** | The shape of an object you pass to `insert()`. Required columns required; columns with defaults optional. | Creating new rows.       |
| **`Update`** | The shape of an object you pass to `update()`. All columns optional.                                      | Modifying existing rows. |

---

## Using the Types in Your Code

In the next lesson we'll set up the Supabase client and pass `Database` as a type parameter. Here's a preview to make the connection concrete:

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.types';

const supabase = createClient<Database>(url, anonKey);

// Fully typed. Hover over `data` in VSCode and you'll see its shape.
const { data, error } = await supabase
	.from('profiles')
	.select('id, email, full_name')
	.eq('id', userId);
```

Two things to notice:

1. **`<Database>`** — the generic type parameter. This is what tells the SDK "these are the tables and columns that exist." Without it, `supabase.from('anything')` is accepted and `data` is `any`. With it, misspelling `'profiles'` as `'profile'` is a compile error.
2. **`.select('id, email, full_name')`** — the string is checked against the actual column list. Try misspelling one and TypeScript will underline it red.

This is the payoff. The types generated from your real schema become a compile-time contract. Drift between code and schema is detected immediately.

---

## Helper Type Aliases

Reading `Database['public']['Tables']['profiles']['Row']` every time you want "a profile" is painful. The generated file provides helper types you can use:

```typescript
// Several lines near the bottom of database.types.ts:
export type Tables<
  PublicTableNameOrOptions extends /* ... */
> = /* ... */

export type TablesInsert<
  PublicTableNameOrOptions extends /* ... */
> = /* ... */

export type TablesUpdate<
  PublicTableNameOrOptions extends /* ... */
> = /* ... */
```

**How to use them:**

```typescript
import type { Tables, TablesInsert, TablesUpdate } from '$lib/types/database.types';

// The shape of a profiles row
type Profile = Tables<'profiles'>;

// The shape you pass to insert()
type NewProfile = TablesInsert<'profiles'>;

// The shape you pass to update()
type ProfileUpdate = TablesUpdate<'profiles'>;
```

This is the idiomatic pattern. In your own app code, write:

```typescript
import type { Tables } from '$lib/types/database.types';

function formatName(profile: Tables<'profiles'>): string {
	return profile.full_name ?? profile.email;
}
```

Clean, typed, schema-aware.

### If you ever need a nested shape

For queries that JOIN or select nested relations, the generated types can get hairy. Supabase provides a utility type `QueryData<Q>` for inferring the exact return shape of a specific query:

```typescript
import type { QueryData } from '@supabase/supabase-js';

const profileQuery = supabase.from('profiles').select('id, email, full_name').eq('id', userId);

type ProfileResult = QueryData<typeof profileQuery>;
```

You won't need this until you're writing complex queries in Module 4, but remember it's there.

---

## When to Re-run `pnpm db:types`

Every time the database schema changes in a way that would affect code:

- After creating a new migration and running `pnpm db:reset`.
- After pulling a teammate's branch that contains new migrations.
- Before committing, if you've added or modified a migration this session.
- Before running `pnpm build`, to catch drift that might otherwise succeed locally but fail the CI build.

A convenient habit: chain the commands.

```bash
pnpm db:reset && pnpm db:types
```

This resets your database to match every migration and regenerates types in one shot. Do it after every migration edit.

---

## If Generation Fails

Common failures and fixes:

- **"Cannot connect to Docker daemon"** — Docker Desktop isn't running. Start it.
- **"connection refused to localhost:54321"** — The local Supabase stack isn't running. `pnpm db:start`.
- **"No connection could be made"** on Windows — Check Windows Defender Firewall isn't blocking Docker.
- **Types file is empty or partial** — A migration may have failed silently. Run `pnpm db:reset` first and watch for SQL errors.
- **Types generated but don't match your expectations** — The generator only sees the state in the `public` schema (and a few explicitly supported others). Changes in the `auth` schema are not exposed; don't try to type against them.

---

## Principal Engineer Notes

1. **Types generated from schema beat types hand-authored.** Hand-authored types drift the moment the schema changes and nobody notices. Generated types drift the moment the schema changes and **the build breaks**. That is strictly better.

2. **Make regeneration cheap and automatic.** In Module 12 (CI/CD), you'll add a step that runs `supabase gen types` against staging and fails the build if the committed types file differs from generated output. This turns "run the command before committing" from a habit into a check.

3. **Keep your types file in git.** Some teams treat it as a build artifact and gitignore it. We keep it in git because (a) it allows `pnpm check` to run before any database is up; (b) PR reviewers can see schema changes in the diff; (c) offline contributors can still build. The marginal cost of committing a few hundred KB of types is zero.

4. **The `@supabase/ssr` package is a moving target.** It reached v0.x at the time of this course and is still evolving. The API surface you'll use (the two client constructors plus the cookies adapter) has been stable, but peripheral helpers come and go. When in doubt, check the package's README for your installed version.

5. **SDKs are thin wrappers, but wrappers matter.** You could build Contactly without `@supabase/supabase-js` by making raw `fetch` calls — and some teams do this for performance or dependency-size reasons. The SDK saves time, and its TypeScript integration is the real win. Going without it is a senior-engineer decision you make with eyes open, not a default.

---

## Summary

- Installed `@supabase/supabase-js` (universal SDK) and `@supabase/ssr` (SvelteKit cookie-based session management) as runtime dependencies.
- Understood the role of each: one is the core SDK; the other is the SSR-specific cookie glue.
- Regenerated `src/lib/types/database.types.ts` from your live local schema using `pnpm db:types`.
- Learned the three shapes per table: **`Row`**, **`Insert`**, **`Update`** — and when to use each.
- Learned the helper aliases **`Tables<'t'>`**, **`TablesInsert<'t'>`**, **`TablesUpdate<'t'>`** for idiomatic usage.
- Memorized the rule: run `pnpm db:types` after every schema change.
- Understood the broader principle: types generated from schema are a contract the build can enforce.

## Next Lesson

In lesson 2.3 you'll set up the server-side Supabase client in `hooks.server.ts` — the middleware that runs on every request, authenticates the user, and makes the Supabase client available to every page's load function. This is where Contactly gets its server-side identity layer.
