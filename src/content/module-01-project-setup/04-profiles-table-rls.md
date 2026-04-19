---
title: '1.4 - Profiles Table & RLS'
module: 1
lesson: 4
moduleSlug: 'module-01-project-setup'
lessonSlug: '04-profiles-table-rls'
description: 'Create the profiles table with Row Level Security policies and an automatic trigger that creates a profile on user signup.'
duration: 12
preview: false
---

## Overview

This lesson is where Contactly gets its first real piece of schema. You'll write a migration file — a SQL script that defines the `profiles` table, turns on Row Level Security, adds policies that enforce per-user isolation, and installs a trigger that automatically creates a profile row every time a user signs up.

If you have never written SQL before, you will by the end of this lesson. We'll explain every clause, every operator, every keyword. The migration file you build here is not a toy — it's the exact migration shipping in production-grade SaaS apps today.

## Prerequisites

- Lesson 1.3 complete — you understand the split between `auth` and `public` schemas and what `auth.uid()` does.
- `pnpm db:start` is running.

## What You'll Build

- A real migration file in `supabase/migrations/` that creates the `profiles` table.
- Two RLS policies: users can SELECT their own profile, and UPDATE their own profile.
- A trigger that fires on signup and auto-creates a profile.
- A second trigger that keeps `updated_at` fresh on every update.
- TypeScript types regenerated from the live schema, ready for the next module.

---

## A One-Page Introduction to SQL

If you've never seen SQL: it stands for **Structured Query Language**. It's the language databases speak. SQL statements come in two flavours:

- **DDL (Data Definition Language)** — creates, alters, and drops schema objects. `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`. This is what a migration file contains.
- **DML (Data Manipulation Language)** — reads and modifies data. `SELECT`, `INSERT`, `UPDATE`, `DELETE`. This is what your app runs to do its job.

SQL is **declarative**: you describe _what_ you want, and the database figures out _how_. Keywords are conventionally written in UPPERCASE by older tutorials, but modern Postgres style uses lowercase. We'll use lowercase throughout.

A statement always ends with a semicolon. Multiple statements in one file run in order. If one fails, the whole file aborts and rolls back — nothing is half-applied. This is a **transaction**, and it's one of the reasons Postgres is so safe.

---

## Creating the Migration File

From your `contactly/` project root:

```bash
pnpm supabase migration new create_profiles_table
```

**Reading this command:**

- `pnpm supabase` — the Supabase CLI.
- `migration new` — create a new migration file.
- `create_profiles_table` — a human description; it becomes part of the filename.

Look inside `supabase/migrations/`. A new file appears with a timestamp prefix:

```
supabase/migrations/20260418120000_create_profiles_table.sql
```

The timestamp (year, month, day, time) is added automatically. Timestamps matter because migrations run in **alphabetical order by filename**, and the timestamp format ensures correct chronological order. A migration that creates a table must run before a migration that adds a column to it.

### Why migrations, one more time

A migration is an append-only log of schema changes. Each file is:

- **Committed to git** — permanent, reviewable history.
- **Run once per environment** — Supabase tracks which migrations have been applied in a system table, so it never replays them.
- **Immutable** — once a migration has been applied to production, you don't edit it. You write a new migration that modifies what the old one did.

This discipline is what makes it possible for a team of engineers to change a database schema without stepping on each other. Every change is reviewed; every change is replayable; every environment ends up identical.

---

## The Full Migration — Then We Break It Down

Open the migration file in VSCode and paste this SQL. We'll walk through every line afterwards.

```sql
-- supabase/migrations/<timestamp>_create_profiles_table.sql

-- Profiles — one row per auth.users entry.
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable Row Level Security — rows are invisible until a policy allows access.
alter table public.profiles enable row level security;

-- Users can only read their own profile.
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can only update their own profile.
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new auth.users record is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keep updated_at fresh whenever a row is updated.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
```

---

## Breaking Down the Table Definition

```sql
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
```

**Clause by clause:**

- `create table public.profiles (` — Create a new table. `public.` makes the schema explicit (otherwise Postgres uses your default search path). Parentheses contain the column list.
- `id uuid references auth.users on delete cascade primary key,` — A column named `id`, holding a **UUID** (a 128-bit random identifier). Every row's `id` must exist as a row in `auth.users.id` — the `references` clause enforces that foreign key. `on delete cascade` says: if the referenced `auth.users` row is deleted, delete this profile too. `primary key` means this column uniquely identifies the row.
- `email text not null,` — A column named `email`, holding text. `not null` means it must always have a value. If an insert leaves this blank, Postgres rejects the insert.
- `full_name text,` — A column named `full_name`, holding text. No `not null`, so it's optional (defaults to `NULL`).
- `avatar_url text,` — An optional text column we'll use later for profile images.
- `created_at timestamptz default now() not null,` — A timestamp **with time zone**. `default now()` means: if no value is supplied on insert, use the current server time. `not null` ensures every row has this set.
- `updated_at timestamptz default now() not null` — Same idea, for the last-modified time. The trigger below keeps it fresh automatically.

### A note on `uuid` vs `serial`

Postgres supports auto-incrementing integer IDs (`serial`, `bigserial`). We use UUIDs instead because:

- They're generated client-side or via `auth.users.id`, so you don't need a round-trip to the DB to know the new row's ID.
- They don't leak information (row counts, order of creation).
- They're safe to expose in URLs — `/contacts/3` tells an attacker you have at least 3 contacts; `/contacts/a6b2...` tells them nothing.

### A note on `timestamptz`

Postgres has two timestamp types: `timestamp` (no time zone) and `timestamptz` (with time zone). **Always use `timestamptz`.** It stores values internally as UTC and converts to the connection's time zone on read. The plain `timestamp` type stores whatever you hand it and assumes you know what time zone it's in — a recipe for bugs in any app with users in multiple time zones, which is most apps.

---

## Enabling Row Level Security

```sql
alter table public.profiles enable row level security;
```

**One line, enormous consequence.** After this statement runs, all access to `profiles` is denied — to everyone, including the table owner when queried via the API — until a policy explicitly allows it.

Think of it as flipping a switch from "open by default" to "closed by default." We're now in the correct state for a security-sensitive table.

---

## Understanding the SELECT Policy

```sql
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);
```

**Breaking it down:**

- `create policy "Users can view own profile"` — Creates a policy. The string in quotes is a human-readable name. It shows up in Studio and in error messages.
- `on public.profiles for select` — This policy applies to the `profiles` table and only to SELECT (read) queries.
- `using (auth.uid() = id)` — The condition. For every row considered in a SELECT query, Postgres evaluates this expression. If it evaluates to `true`, the row is included in results. If `false` (or `null`), the row is filtered out.

`auth.uid()` returns the current user's UUID (lesson 1.3). `id` is the `profiles.id` column for the row being evaluated.

**What happens when a logged-in user runs `select * from profiles`:**

1. Postgres starts examining rows.
2. For each row, it evaluates `auth.uid() = id`.
3. When `id` equals the user's UUID → include the row.
4. When `id` is someone else's UUID → skip the row.

The result: a single row — the user's own. Even though the SQL didn't say `where id = ...`, only their row came back. That's RLS doing its job.

---

## The UPDATE Policy

```sql
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);
```

Same structure, different target. `for update` means this policy governs `UPDATE` statements. The `using` clause says a user can only update rows where `auth.uid() = id` — i.e., their own.

If a malicious user tries:

```sql
update profiles set full_name = 'Hacked' where id = '<someone else's id>';
```

The statement runs without error but updates **zero rows**. The database silently refuses.

### Why no INSERT or DELETE policies?

- **INSERT**: users never insert profiles directly — the trigger below handles that on signup.
- **DELETE**: deleting a profile requires deleting the `auth.users` row, which cascades into `profiles` automatically. That's a server-side admin operation only.

By not writing policies for INSERT and DELETE, we leave them forbidden by default. Exactly what we want.

### `using` vs `with check`

Policies can have two conditions:

- **`using`** — applied to existing rows. Controls which rows are visible or affected.
- **`with check`** — applied to new or modified row values. Controls what a user is allowed to write.

For a true user isolation policy, you often want both. We omit `with check` on UPDATE because there's nothing meaningful the user could change that would violate the policy (they can't change their own `id`). In Module 4 we'll see cases where `with check` matters.

---

## The Sign-Up Trigger — In Depth

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;
```

This defines a **function** — a named piece of code stored in the database. Triggers call functions; the function does the actual work.

**Line by line:**

- `create or replace function public.handle_new_user()` — Creates a new function named `handle_new_user` in the `public` schema. `or replace` lets us re-run the migration safely.
- `returns trigger` — Declares the return type. Trigger functions must return `trigger`. The value returned is the row that will ultimately be written (or `null` to cancel the operation, in `before` triggers).
- `language plpgsql` — The function is written in PL/pgSQL, Postgres's procedural language. PL/pgSQL adds control flow (IF, LOOP, variables) to SQL.
- `security definer` — **Important.** The function runs with the privileges of the user who _defined_ it (typically `postgres`, the superuser), not the user who triggered it. We need this because the function must write to `public.profiles`, but the anonymous user inserting into `auth.users` doesn't have permission to write to `public.profiles` directly.
- `set search_path = public` — **Equally important.** Pins the function's schema lookup order to `public`. Without this, a malicious user could create a schema with the same name and hijack calls like `insert into profiles` to point at their malicious table. This is called a **schema injection attack** and it's a known class of vulnerability when combining `security definer` with unspecified search paths. Supabase's linter will flag any `security definer` function without `set search_path`.
- `as $$` … `$$;` — Dollar-quoted string. Everything between the two `$$` markers is the function body. Dollar quoting avoids having to escape single quotes inside the body.

**The body:**

```sql
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
```

- `begin` ... `end;` — PL/pgSQL block. Groups statements.
- `insert into public.profiles (...) values (...)` — Standard SQL insert.
- `new` — A special variable inside trigger functions. For INSERT triggers, it holds the row being inserted into the source table (`auth.users` in this case). `new.id`, `new.email`, `new.raw_user_meta_data` read the corresponding columns from the new `auth.users` row.
- `new.raw_user_meta_data->>'full_name'` — `raw_user_meta_data` is a JSONB (binary JSON) column. The `->>` operator extracts a key as **text**. If the user signed up with `supabase.auth.signUp({ options: { data: { full_name: 'Ada' } } })`, that name is stored here. If nothing was provided, the extraction returns `null`, and `full_name` becomes `null` in the profile.
- `return new;` — Tell Postgres to continue with the original insert into `auth.users`.

### The trigger itself

```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- `create trigger on_auth_user_created` — A named trigger.
- `after insert on auth.users` — Fire after a row has been inserted into `auth.users`. ("After" because we need the `auth.users` row to exist before we can reference its `id` via the foreign key in `profiles`.)
- `for each row` — Fire once per inserted row. The alternative `for each statement` fires once per SQL statement regardless of row count.
- `execute procedure public.handle_new_user()` — What to run.

**Why a trigger instead of app code?** Two reasons:

1. **Atomicity.** Trigger and parent insert run in the same Postgres transaction. Either both succeed or both roll back. If the trigger fails (e.g., full_name too long), the user is not created. There's no "user exists without profile" limbo state.
2. **Durability.** The rule lives in the database. A future developer writing a new signup route can't forget it. A future integration inserting users programmatically also gets the profile created. The rule is enforced everywhere.

This is a Principal Engineer instinct: **put the rule at the lowest level it can reasonably live.**

---

## The `updated_at` Trigger

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
```

A simpler trigger. Every time a row is updated, this function runs **before** the update is written to disk. It mutates `new.updated_at` to the current timestamp, then returns the modified row. The update proceeds with `updated_at = now()`.

Your app never has to remember to update `updated_at`. The database handles it. This is the value of triggers — pushing routine work out of application code and making it unavoidable.

### Note on `before` vs `after`

- **`before`** — The trigger runs with a chance to modify the row before it's written. `return new;` writes the modified row.
- **`after`** — The trigger runs after the row is written. Cannot change the row; used for side effects like inserting into an audit log table.

We use `before update` for `set_updated_at` because we need to change the row. We use `after insert` for `handle_new_user` because we need the inserted row to already exist (so the foreign key in `profiles.id` will pass).

---

## Applying the Migration

Save the file, then run:

```bash
pnpm db:reset
```

**What happens:**

1. The Supabase CLI drops your local database.
2. Recreates it empty.
3. Runs every migration file in `supabase/migrations/` in filename order.
4. Runs `supabase/seed.sql` if it exists.

**Expected output:**

```
Resetting local database...
Initialising schema...
Applying migration 20260418120000_create_profiles_table.sql...
Finished supabase db reset on branch main.
```

If you see an error — read it carefully. Migration errors are usually typos (missing semicolon, misspelled column name) or logic errors (forward-referencing a table that doesn't exist yet). Fix the SQL, save, and re-run `pnpm db:reset`.

### When to use `db reset`

You'll use this command hundreds of times. Any time you:

- Edit a migration file.
- Create a new migration file.
- Want to clear out test data.
- Want to verify your migrations work from scratch.

It's fast (a few seconds) and idempotent — running it twice does the same thing as running it once.

---

## Verifying in Studio

Open `http://localhost:54323` → **Table Editor**. You should now see `profiles` under the `public` schema, with columns `id`, `email`, `full_name`, `avatar_url`, `created_at`, `updated_at`.

Click on the table. You'll see a banner indicating **RLS is enabled**. Click through to see the two policies you created.

### Testing the trigger

In Studio, go to **Authentication** → **Users** → click **Add user → Create new user**. Enter an email (`test@example.com`) and password, leave auto-confirm on, and submit.

Now go back to **Table Editor** → `profiles`. You should see one row — the profile your trigger auto-created. `id` matches the new user's UUID, `email` matches, `full_name` is null (we didn't provide it).

This is proof. The trigger fires, the foreign key resolves, the policy allows the insert (it's running as a `security definer` function, bypassing RLS). Everything works.

Delete the test user from **Authentication** → **Users**. Go back to `profiles` — it's gone. Cascade delete, working as designed.

---

## Generating TypeScript Types

We now have a schema. Next step: generate a TypeScript definition that matches it, so our app code can use typed queries.

```bash
pnpm db:types
```

(That's the script you added in lesson 1.2 — it calls `supabase gen types typescript --local > src/lib/types/database.types.ts`.)

The `--local` flag tells the CLI to introspect your **local** database (not a cloud project). The output is piped into `src/lib/types/database.types.ts`.

Open that file. You'll see something like:

```typescript
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
					/* ... */
				};
				Update: {
					/* ... */
				};
			};
		};
		// ...
	};
};
```

Three shapes per table:

- **`Row`** — the shape of a row you'd get from a SELECT.
- **`Insert`** — the shape you must provide to INSERT (optional fields have defaults).
- **`Update`** — the shape you must provide to UPDATE (all fields optional).

### How to use the types

When we install the Supabase SDK in the next module, you'll pass `Database` as a type parameter:

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.types';

const supabase = createClient<Database>(url, anonKey);

// Fully typed: TypeScript knows 'profiles' is a valid table,
// and 'email' and 'full_name' are valid columns.
const { data } = await supabase.from('profiles').select('id, email, full_name');
```

The editor will autocomplete table names, column names, and flag typos before you run the code.

### Rule: regenerate types on every schema change

Any time you write a new migration, run `pnpm db:reset && pnpm db:types`. The types must match the schema or TypeScript will lie to you — which defeats the entire point. Some teams wire this into a pre-commit git hook; for now, just remember to run it.

---

## Principal Engineer Notes

1. **Migrations are the single source of truth for your schema.** If it's not in a migration file, it doesn't exist. This discipline protects you from "works on my machine" forever.

2. **`security definer` + `search_path` is a two-part answer.** Many older tutorials show `security definer` alone. That's incomplete — and Supabase's linter will flag it. Always pin `search_path` explicitly. This defends against a schema injection attack class that most beginners (and many experienced engineers) have never heard of.

3. **Push work into the database when the rule is truly global.** Triggers are a strong tool but not a free one — they're invisible to app code, harder to debug than a line in a function, and harder to change once users depend on them. The right bar for "put it in a trigger" is: "This rule must apply no matter which code path creates or updates the row, forever." Creating a profile on signup passes that bar. Complex business logic usually doesn't.

4. **Types generated from the schema are a contract.** If the types are out of date, TypeScript will confidently accept invalid queries that fail at runtime. Treat `pnpm db:types` with the same seriousness as you treat `pnpm build`. In Module 12 you'll add a CI check that fails the build if types are stale.

5. **RLS is not a substitute for input validation.** RLS protects rows; it does not sanitize query arguments, prevent SQL injection via raw SQL, or rate-limit requests. You still validate inputs at the application boundary (Zod schemas, for example, which we'll use in Module 3). RLS is defense in depth, not defense alone.

---

## Summary

- Wrote your first migration file with `supabase migration new create_profiles_table`.
- Created the `public.profiles` table with a foreign key to `auth.users` and `on delete cascade`.
- Enabled **Row Level Security** on the table, flipping it from open-by-default to closed-by-default.
- Wrote SELECT and UPDATE policies using `auth.uid() = id` to enforce per-user isolation at the database layer.
- Wrote the `handle_new_user()` trigger function with `security definer` + `set search_path = public` to safely auto-create a profile on signup.
- Wrote the `set_updated_at()` trigger so `updated_at` is maintained automatically on every update.
- Ran `pnpm db:reset` to apply all migrations from scratch.
- Verified the trigger by creating a test user in Studio and watching the profile appear.
- Generated TypeScript types from the live schema with `pnpm db:types`.
- Internalized the rules: schema changes always go through migrations; triggers carry rules that must be universal; RLS is enforcement, not validation.

## Next Lesson

Module 2 begins. You'll wire Contactly's SvelteKit app to Supabase — configuring environment variables correctly, installing the Supabase JavaScript SDKs, setting up a server-side Supabase client in `hooks.server.ts`, and exposing the authenticated user to every page in your app. The database you built today becomes reachable from code.
