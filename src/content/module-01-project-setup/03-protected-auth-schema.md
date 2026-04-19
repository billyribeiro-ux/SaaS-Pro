---
title: "1.3 - Protected Auth Schema"
module: 1
lesson: 3
moduleSlug: "module-01-project-setup"
lessonSlug: "03-protected-auth-schema"
description: "Understand Supabase's built-in auth schema and how it protects user credentials from direct database access."
duration: 10
preview: false
---

## Overview

This is the most important conceptual lesson in Module 1. Before we write any database code, you need to understand the boundary between Supabase's managed `auth` schema and the `public` schema where your app's data lives — and **why** that boundary exists. Every security decision you make in Contactly flows from this mental model.

No code is written in this lesson. Do not skip it. The next ten minutes of reading will save you days of debugging later.

## Prerequisites

- Lesson 1.2 complete — `pnpm db:start` runs a local Supabase stack.
- Supabase Studio open at `http://localhost:54323`.

## What You'll Build

You won't build code in this lesson. You'll build **mental models** — the frameworks you'll use to evaluate every future database decision. Specifically:

- A clear picture of what a PostgreSQL "schema" is and how Supabase uses schemas to separate responsibilities.
- An understanding of how `auth.uid()` converts a JWT token into an enforceable database rule.
- The architectural reasoning for why user-credential tables are never touched directly from app code.

---

## What Is a Schema?

In PostgreSQL, a **schema** is a named namespace inside a database. Think of it as a folder: you can have a table called `users` in one schema and a different table called `users` in another, and they don't collide.

Every table in Postgres has a fully-qualified name: `<schema>.<table>`. When you write `select * from profiles`, Postgres quietly resolves `profiles` to `public.profiles` because `public` is the default schema.

Supabase uses schemas deliberately, as a security and organization tool:

```
your Supabase project
├── auth        ← managed by Supabase — you read; you never write
├── storage     ← managed by Supabase — file metadata for uploads
├── realtime    ← managed by Supabase — live-query infrastructure
├── extensions  ← managed by Supabase — installed Postgres extensions
└── public      ← YOUR code — tables your app creates and manages
```

**The rule: one schema, one owner.** The `auth` schema is Supabase's territory. The `public` schema is yours. When you write a migration, every `create table`, `create function`, `create policy` goes into `public` (or a schema *you* create, which we won't need for this course). When you want information from `auth`, you read it indirectly through Supabase-provided functions.

---

## What's Inside the `auth` Schema?

The `auth` schema contains the tables Supabase Auth uses to manage user identity. The two most important:

- **`auth.users`** — one row per registered user. Columns include `id` (a UUID), `email`, `encrypted_password`, `email_confirmed_at`, `raw_user_meta_data` (a JSON column for custom data), `created_at`, `last_sign_in_at`, and many more.
- **`auth.sessions`** — active login sessions. Each row represents one browser/device currently logged in.

There are also tables for refresh tokens, multi-factor auth, SSO providers, audit logs, and internal bookkeeping.

### Why `encrypted_password` is not actually "encrypted"

If you peek at `auth.users.encrypted_password`, you'll see something like:

```
$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
```

That's a **bcrypt hash**, not encryption. The distinction matters:

- **Encryption** is reversible — if you have the key, you can recover the plaintext.
- **Hashing** is one-way — there's no key, and no mathematical way to recover the original input from the hash.

When a user logs in, Supabase:
1. Receives the plaintext password over TLS.
2. Runs the same bcrypt function on it (using the salt already baked into the stored hash).
3. Compares the result against the stored hash.
4. If they match → same password → login succeeds.

The plaintext password is **never** stored anywhere. Even Supabase employees with full database access cannot read user passwords. If an attacker stole your entire database, they'd need to brute-force each password individually against the slow bcrypt function — computationally infeasible for strong passwords.

This is the standard. Every modern system does this. If anyone ever tells you they'll "encrypt your password and show it back to you if you forget," run.

---

## Why You Never Write to `auth.users` Directly

Supabase Auth manages `auth.users` through a hardened internal API. When a user signs up via `supabase.auth.signUp()`, Supabase performs a whole sequence of operations:

1. Validate the email format.
2. Check for an existing user with the same email.
3. Generate a unique `id` (UUID).
4. Hash the password using bcrypt with a random salt.
5. Insert the row into `auth.users`.
6. Generate and send a confirmation email (to the real inbox in production, to Inbucket locally).
7. Record audit log entries.
8. Return a signed JWT session token.

If you bypass that API and write directly to `auth.users` with plain SQL, you skip every one of those steps. You could accidentally:
- Store a plaintext password (security disaster).
- Create a user with an invalid email (login will fail cryptically).
- Forget to generate the `id` or `confirmation_token` (auth breaks for that user).
- Corrupt audit logs (compliance violation).

**The rule is simple: your app creates users through the Supabase Auth API. It never writes directly to `auth.users`.** The API handles the details; your code doesn't need to know them.

### Reading from `auth.users` is fine

Reading is different. It's safe to run a SQL query like:

```sql
select id, email, created_at, last_sign_in_at
from auth.users
limit 10;
```

This only retrieves information — it doesn't mutate anything. Most app code doesn't need to query `auth.users` directly (you'll do it indirectly via `auth.uid()`, explained below), but it's allowed when you need to.

Try this yourself. Open Supabase Studio at `localhost:54323`, click **SQL Editor**, and run the query above. You should see zero rows (because nobody has signed up yet).

---

## How `auth.uid()` Works — The Core Security Primitive

This is the single most important concept in Supabase. Read it twice.

`auth.uid()` is a PostgreSQL **function** provided by Supabase. It takes no arguments and returns a UUID: the ID of the user who is currently authenticated, based on the JWT token attached to the current request.

### The request flow

1. A user logs into your Contactly app.
2. Supabase Auth gives the browser a **JWT access token** — a signed string that says "I am user `abc-123` and this claim is valid until timestamp X."
3. Every time the browser makes a request to Supabase, it sends the JWT in the `Authorization` header.
4. Supabase's API layer (PostgREST) verifies the JWT signature against the server's secret key. If valid, it opens a database session and sets a local variable to the user's UUID.
5. Anywhere in SQL where you call `auth.uid()`, Postgres reads that local variable.

If the JWT is missing, invalid, or expired, `auth.uid()` returns `null`. Policies that rely on it will correctly refuse access.

### Why this is clever

The user's identity is not passed in as a query argument by the application code — it's extracted from a cryptographically signed token, inside the database session, before any of your SQL even runs. This means:

- **Your app can't lie about who the user is.** The JWT is signed by Supabase's secret; a malicious client can't forge one.
- **SQL policies can reference `auth.uid()` directly.** No need to pass user IDs around in WHERE clauses.
- **Authorization is centralized in the database.** Even if your app code has a bug, the policies on each table still enforce access rules.

### A tiny example

Here's a policy you'll see in action in the next lesson:

```sql
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);
```

Read it like English: "Create a rule named 'Users can view own profile' on the `profiles` table for SELECT queries, using the condition that `auth.uid()` equals the `id` column."

When a logged-in user runs `select * from profiles`, Postgres does this for every row:
- Evaluate `auth.uid() = id`.
- If true → include this row in the result.
- If false → hide this row (not an error; just invisible).

No matter what the user's query looks like — no WHERE clause, weird JOINs, anything — rows where `auth.uid() != id` are not returned. The database is the enforcer.

---

## Row Level Security — One Sentence at a Time

**Row Level Security (RLS)** is the PostgreSQL feature that makes the above possible.

- RLS is a per-table setting. You enable it with `alter table <table> enable row level security;`.
- Once enabled on a table, **all access to that table is denied by default** — even to the table's owner, from normal clients.
- You then write **policies** that explicitly allow specific kinds of access.
- Each policy has a target (SELECT, INSERT, UPDATE, DELETE, or ALL) and a condition (a SQL expression).
- When a query runs, Postgres evaluates the applicable policies for each row. Rows where all policies pass are accessible; others are filtered out.

**The key principle is "default deny, allow by exception."** This is the opposite of "default allow, deny by exception." If you forget to write a policy, the table is locked down, not wide open. Forgotten policies cause bugs — they never cause security breaches.

Without RLS, a naive SELECT query against your profiles table would return everyone's data. With RLS, the same query returns only the authenticated user's row. Your app code gets simpler *and* more secure at the same time.

You'll write your first RLS policy in lesson 1.4.

---

## Viewing the `auth` Schema in Studio

Open Studio at `http://localhost:54323`. Click **Table Editor** in the left sidebar.

By default, Studio hides the `auth` schema from the Table Editor. This is **deliberate.** The Studio team assumes users browsing the Table Editor may be tempted to click buttons that edit rows — and editing `auth.users` by hand is exactly the problem we've been discussing. Hiding the schema removes the temptation.

You can still inspect it via SQL. In the **SQL Editor**, run:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'auth' and table_name = 'users'
order by ordinal_position;
```

This lists every column in `auth.users`. Scroll through. Notice the sheer number of columns — `phone`, `is_sso_user`, `banned_until`, `deleted_at`, `confirmation_token`, `recovery_sent_at`, and many more. Supabase Auth is doing a lot of work you'd otherwise have to build yourself.

---

## The Bridge: `public.profiles` References `auth.users`

You can't add a `favorite_color` column to `auth.users` — it's not yours to modify. So where does your app's user data go?

You create a separate table in the `public` schema and link it to `auth.users`:

```sql
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text
  -- ... any other app-specific columns
);
```

Two critical parts of that definition:

- **`references auth.users`** — this is a **foreign key constraint**. It tells Postgres: "the value in this column must exist as an `id` in `auth.users`." You can never insert a profile for a user that doesn't exist. The database refuses.
- **`on delete cascade`** — if a row is deleted from `auth.users`, its matching profile row is automatically deleted too. No orphaned profiles. No ghost data.

This is **separation of concerns**, a foundational architecture principle:

| Responsibility | Table | Owner |
|---|---|---|
| Identity (who am I?) | `auth.users` | Supabase Auth |
| Profile data (display name, avatar) | `public.profiles` | Your code |
| Business data (contacts, subscriptions) | `public.contacts`, `public.subscriptions` | Your code |

Identity belongs to Supabase because identity is hard and has a right way. Profile and business data belongs to you because it's specific to Contactly.

---

## The Sign-Up Trigger — A Preview

Here's a small problem: when a user signs up, `auth.users` gets a new row. But `public.profiles` doesn't — yet. Someone has to insert the matching profile row. Who?

Three options:

1. **App code inserts it after signup.** Risky — if the app crashes between `auth.signUp` and the insert, the user has no profile, and every future request fails.
2. **A server endpoint does it explicitly.** Better, but still two network calls.
3. **A database trigger does it automatically.** Best — atomic, guaranteed, zero app code.

We'll take option 3. In the next lesson you'll write a trigger that listens for `INSERT` events on `auth.users` and automatically inserts a matching row into `public.profiles`. It's a few lines of PL/pgSQL that solves the problem once and for all.

This is how senior engineers think: **put the rule at the lowest level it can live.** A trigger at the database enforces the rule even if a future developer writes new signup code that forgets about it.

---

## Migrations, Not Studio Clicks

Studio's UI has buttons to create tables, add columns, and change types. For a quick local experiment it's fine. For a real project — **do not use them.**

Schema changes made through Studio exist only in your local database. They are not:
- Committed to git.
- Reproducible on a teammate's machine.
- Applied to your staging or production environments.
- Auditable (no PR review, no history).

**Schema changes always go through migration files.** A migration is a SQL file that lives in `supabase/migrations/`, gets committed to git, is reviewed in a pull request, and runs identically in every environment (local, staging, production). This is the professional discipline, and it's non-negotiable.

Studio is for reading data and running one-off queries. Never schema changes.

---

## Principal Engineer Notes

1. **Layered authorization is defense in depth.** Contactly has authorization at three layers: (a) route guards in `+layout.server.ts`, (b) RLS policies on tables, (c) constraints on columns. If any one layer fails, the others still protect the data. Never rely on a single check.

2. **Putting user identity at the database layer is unusual and powerful.** Most web frameworks put authorization in middleware — a piece of JavaScript that checks `req.user.id` before every query. That works, but it's brittle: a new developer writing a new route can forget the check, and your app is open. Supabase puts the check *inside the database*. The check can't be forgotten because it runs even when your app code runs `select * from everything`.

3. **The `auth`/`public` boundary mirrors organizational ownership.** In a larger company, the team that owns auth is different from the team that owns user-facing features. Postgres schemas let those teams own different slices of the database without stepping on each other. Even as a solo dev, practicing the discipline now prepares you for scale later.

4. **Foreign keys with `on delete cascade` are a data integrity feature, not just a convenience.** They make it impossible to create inconsistent state. If you ever find yourself writing app code to "also delete the profile when a user is deleted," you're reinventing a constraint that the database can enforce for free.

5. **Never trust data just because it reached the database.** This applies even with RLS. If your app code constructs a SQL query that trusts user input as-is, you still have SQL injection. RLS protects rows; it doesn't sanitize queries. Use parameterized queries (which the Supabase SDK does by default). Belt AND suspenders.

---

## Summary

- A PostgreSQL **schema** is a namespace. Supabase uses schemas to separate ownership: `auth` is theirs, `public` is yours.
- `auth.users` stores user credentials with **bcrypt-hashed** passwords. You read from it only through `auth.uid()` and never write to it directly.
- `auth.uid()` returns the current user's UUID, extracted from the signed JWT on the request. It's the pivot point of every RLS policy.
- **Row Level Security (RLS)** turns authorization into a database-level concern. Default deny; allow by exception.
- Your app's user data lives in `public.profiles` with a foreign key to `auth.users` and `on delete cascade` for consistency.
- A **database trigger** (coming next lesson) auto-creates a profile whenever a user signs up, eliminating a whole class of inconsistency bugs.
- **Schema changes always go through migration files**, never through the Studio UI. Migrations are code; they get reviewed, committed, and replayed identically everywhere.

## Next Lesson

In lesson 1.4 you'll write your first migration: creating the `profiles` table, enabling RLS, writing SELECT and UPDATE policies using `auth.uid()`, and building the trigger that automatically creates a profile when a user signs up. You'll also generate TypeScript types from the schema so your application code is type-safe end-to-end.
