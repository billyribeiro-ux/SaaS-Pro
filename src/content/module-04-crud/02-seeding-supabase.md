---
title: "4.2 - Seeding Supabase"
module: 4
lesson: 2
moduleSlug: "module-04-crud"
lessonSlug: "02-seeding-supabase"
description: "Set up seed data so you have realistic users and profiles to develop against locally."
duration: 8
preview: false
---

## Overview

Right now, your local Supabase database is an empty house. The tables are built, the foundations are poured, the wiring is run — but nothing lives inside. If you try to build the Contactly UI against this empty database, you'll hit a frustrating loop: open the dashboard, see no data, manually register a user through the sign-up form, manually create a few contacts, reload, repeat. Every time you run `pnpm supabase db reset`, everything you painstakingly created disappears, and you start the ritual over.

This lesson fixes that. You'll set up a **seed file** — a single SQL script that Supabase runs automatically every time you reset your local database. After this lesson, `pnpm supabase db reset` will give you a fully populated local environment: one test user, one profile row, and credentials you can actually log in with. Ten seconds instead of ten minutes.

Seed data seems like a small quality-of-life improvement, but it quietly shapes the quality of everything you build. Developers who fight their database spend less time thinking about their product. Developers with instant, realistic data spend more time noticing bugs that empty tables hide — broken pagination, blank states that never render, subtle null-handling failures. Seed data is a productivity tool AND a quality tool. Both matter.

## Prerequisites

- Module 1 complete — Supabase CLI is installed, a `supabase/` folder lives at the project root, and `pnpm supabase start` successfully boots the local stack.
- Module 3 complete — the `profiles` table and `handle_new_user` trigger are in place from the profile migration, so a row in `auth.users` can be linked to a matching row in `public.profiles`.

## What You'll Build

- A `supabase/seed.sql` file that creates one test user directly in `auth.users` with a known, bcrypt-hashed password.
- A matching `public.profiles` row for that test user.
- Login credentials you can reuse: `test@example.com` / `password123`.
- A `pnpm supabase db reset` that takes your database from empty to fully usable in seconds, every single time.

---

## What `supabase/seed.sql` Actually Is

Supabase CLI has a convention: if a file named `seed.sql` exists inside the `supabase/` folder, it's executed automatically **after all migrations** during a local database reset. The lifecycle looks like this:

```
pnpm supabase db reset
  ├─ drop the entire local database
  ├─ recreate it from scratch
  ├─ replay every migration in supabase/migrations/ in order
  └─ run supabase/seed.sql  ← the seed step
```

By the time `seed.sql` runs, your schema is already in place. Tables exist. Constraints exist. Triggers exist. RLS policies exist. The seed file's job is to insert data — nothing structural, just rows.

Think of migrations as your database's **blueprint** and seed as its **furniture**. Migrations describe the shape of the house (walls, plumbing, electrical). Seeds fill it with furniture so someone can actually live in it. You can rearrange furniture all day without touching the walls — and you can reset your database over and over without losing the "I moved in yesterday" feel.

### Why seeds are separate from migrations

Migrations and seeds answer two completely different questions:

| | Migrations | Seed |
| --- | --- | --- |
| **Purpose** | Define/evolve schema | Populate development data |
| **Where it runs** | Every environment (local, staging, prod) | Local dev only |
| **Version controlled?** | Yes, in order, immutable once shipped | Yes, but replaceable at will |
| **Touches production?** | Yes | **Never** |
| **Contents** | `create table`, `alter table`, RLS policies, triggers | `insert into ...` for fake users, example data |

The division matters because the **audience** is different. Migrations are written for the database schema itself — they have to run the same way in every environment, forever, and the schema they describe is shared by every user of your app. Seeds are written for **you, the developer** — they only need to run in your laptop's local Postgres, and they should contain data that makes it easy to develop against.

### Why seed data is LOCAL ONLY

This is the single most important thing to internalize in this lesson.

The Supabase CLI's `db reset` command is what triggers seeding. It's only ever meant to be run against your **local** database — not a hosted Supabase project. When you push migrations to a hosted project (`pnpm supabase db push` or a deploy pipeline), **only migrations run**. The seed file never executes in production. Never. Not even if you accidentally ask it to — the hosted Supabase deploy flow doesn't include a seed step.

This is by design. Seed data is fake. It's for development only. Imagine if your production database had a user named "Test User" with the password `password123` — that's an instant security incident. Supabase prevents that by design: `seed.sql` runs only on local `db reset`.

That means:
1. You can put anything in seeds — fake users, hardcoded UUIDs, insecure passwords — and it stays local.
2. You should **never** put real customer data or real credentials in seeds, because the file is committed to git and visible to every developer on the project.
3. Real production data comes from real users signing up through your real signup flow.

Keep this boundary absolute. Seeds exist for development only.

---

## Step 1: Create the Seed File

Create `supabase/seed.sql` at the root of your `supabase/` folder:

```sql
-- supabase/seed.sql
-- This runs after all migrations on: pnpm supabase db reset
-- LOCAL DEVELOPMENT ONLY

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, role
) values (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test User"}',
  false, 'authenticated'
) on conflict (id) do nothing;

insert into public.profiles (id, email, full_name)
values (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  'Test User'
) on conflict (id) do nothing;
```

That's the whole file. Now let's understand every line.

---

## Line-by-Line Walkthrough

### The comment banner

```sql
-- supabase/seed.sql
-- This runs after all migrations on: pnpm supabase db reset
-- LOCAL DEVELOPMENT ONLY
```

SQL comments start with `--`. These three lines are documentation for future-you and future-teammates. The `LOCAL DEVELOPMENT ONLY` reminder is deliberate — the next developer who opens this file should have zero doubt that it never runs in production. Comments that state intent are free; nobody ever regrets adding them.

### Inserting into `auth.users`

```sql
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, role
) values (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Test User"}',
  false, 'authenticated'
) on conflict (id) do nothing;
```

Two things here are worth pausing on: we're inserting **directly** into `auth.users` (bypassing the normal signup API), and we're using `crypt()` to hash the password ourselves.

#### `auth.users` — the schema behind Supabase Auth

Supabase Auth stores its users in a regular Postgres table — `auth.users`. Normally you interact with it through the Supabase Auth API (`supabase.auth.signUp()`, `supabase.auth.signInWithPassword()`), which handles hashing, email confirmation, and session issuance. But because it's just a Postgres table, you can insert into it directly if you know the shape.

Every column matters:

- **`id`** — a UUID that uniquely identifies this user. We hardcode `00000000-0000-0000-0000-000000000001` so we can reliably reference this user from other seed inserts. Real signups get a random UUID; we cheat because we want predictable IDs.
- **`email`** — the login email. `test@example.com` is an IANA-reserved domain (it literally cannot receive email) — safe to use in tests without accidentally emailing a real person.
- **`encrypted_password`** — the bcrypt hash of the password. Never plain text. We'll cover `crypt()` in a second.
- **`email_confirmed_at`** — the timestamp when the user verified their email. We set it to `now()` because we want to skip email confirmation during development. In production, this field is null until the user clicks the verification link.
- **`created_at` / `updated_at`** — timestamps Supabase uses for its internal bookkeeping.
- **`raw_app_meta_data`** — JSON of app-set metadata (provider info). We record that the user was created via the `email` provider, matching what the signup API would record for a normal email/password account.
- **`raw_user_meta_data`** — JSON of user-set metadata. This is what `supabase.auth.signUp({ options: { data: { full_name } } })` writes to. The `handle_new_user` trigger you wrote in Module 3 reads this field to populate `profiles.full_name`.
- **`is_super_admin`** — `false` for regular users.
- **`role`** — the Postgres role to impersonate for this user's requests. `'authenticated'` is the default role for signed-in users in Supabase; `'anon'` is for unauthenticated. Don't change this unless you know what you're doing.

#### `crypt()` and `gen_salt('bf')` — bcrypt password hashing

```sql
crypt('password123', gen_salt('bf'))
```

These two functions come from the **`pgcrypto`** extension, which Supabase enables by default in `auth` and `public` schemas. Let's decode them:

- **`gen_salt('bf')`** — generates a random bcrypt salt. The `'bf'` stands for Blowfish, the cipher bcrypt is based on. Every password hash uses a fresh salt, so two users with the same password have different hashes.
- **`crypt(password, salt)`** — applies the hashing algorithm (determined by the salt) to the password and returns the hashed value. With a bcrypt salt, you get a bcrypt hash.

The resulting string looks something like `$2a$06$abc.../...`. The leading `$2a$` identifies it as bcrypt; the `06` is the cost factor; the rest is the salt and hash combined.

**Why bcrypt?** Because Supabase Auth uses bcrypt to hash passwords on login. When a user types `password123` into your login form, Supabase runs bcrypt against the stored hash to verify it matches. If we stored a plain password here (or hashed it with a different algorithm), the login wouldn't work. By using `crypt('password123', gen_salt('bf'))`, we produce exactly the same format Supabase itself produces.

**Why `password123` specifically?** It's short, memorable, and universally recognized as a test password. Nobody will mistake it for a real credential. Your production users will never have this password — production users sign up through the real flow with their own passwords.

### The `on conflict (id) do nothing` idempotency pattern

```sql
on conflict (id) do nothing;
```

This tail clause is short but important. It says: **"If a row with this `id` already exists, just skip this insert silently."**

Why does this matter? Because the `seed.sql` file runs every time you `db reset`. If you ever change the flow (maybe accidentally run it twice, or later add manual inserts for testing), a plain `insert` would crash on the duplicate primary key. With `on conflict (id) do nothing`, the insert becomes **idempotent** — safe to run over and over, producing the same result every time.

Idempotence is a word worth owning. An operation is idempotent if applying it multiple times has the same effect as applying it once. Plain `INSERT` isn't idempotent (the second attempt fails). `INSERT ... ON CONFLICT DO NOTHING` is. Deployment systems, migration runners, cron jobs, webhooks — everywhere that "might run twice for reasons beyond your control," idempotence is the defense.

You could also write `on conflict (id) do update set email = excluded.email, ...` to refresh the row on conflict ("upsert" behavior), but for seeds, `do nothing` is simpler: if the row is already there, leave it alone.

### Inserting into `public.profiles`

```sql
insert into public.profiles (id, email, full_name)
values (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  'Test User'
) on conflict (id) do nothing;
```

Same UUID — deliberately. In the profile migration from Module 3, `profiles.id` is a foreign key to `auth.users.id`. That relationship requires the UUIDs to match exactly, and we lock them together by reusing `00000000-0000-0000-0000-000000000001`.

**Wait — doesn't the `handle_new_user` trigger auto-create the profile row?** Great question. The trigger fires on `auth.users` inserts in the normal signup flow. In theory, inserting into `auth.users` in this seed file should fire the trigger too, and the profile would be created automatically.

In practice, there's a subtle wrinkle: depending on migration order and how `pgcrypto` is wired up, the trigger may or may not fire cleanly during seed execution, and debugging that is painful. Explicitly inserting the profile row with the same UUID is **belt and suspenders** — if the trigger fires, the `on conflict (id) do nothing` on the profiles insert quietly swallows the duplicate. If the trigger doesn't fire, our explicit insert creates the row. Either way, `profiles` ends up with one row, and the seed succeeds. That's the value of idempotence.

---

## Step 2: Apply the Seed with `db reset`

Now that the file exists, apply it:

```bash
pnpm supabase db reset
```

You'll see output that ends with something like `Seeding data from supabase/seed.sql...` and then a final success message. Your local database now has:

- One user in `auth.users` with email `test@example.com`, bcrypt-hashed password `password123`.
- One profile row in `public.profiles` with matching `id` and `full_name: 'Test User'`.

### Verify in Supabase Studio

Open Studio at `http://localhost:54323` (the URL is printed by `pnpm supabase start`).

1. **Authentication → Users** — you should see `test@example.com` in the list.
2. **Table Editor → profiles** — you should see a row with `full_name = Test User`.

### Verify by logging in

Visit `http://localhost:5173/login`, enter `test@example.com` / `password123`, and submit. You should land on `/dashboard` (or wherever your authenticated landing page is). If login succeeds, bcrypt hashing and Supabase Auth are both happy with your seed data.

If the login fails, the most likely culprits are:
- `pgcrypto` not enabled (rare on Supabase — it's enabled by default).
- The password in `crypt()` doesn't match what you typed in the form (spaces, capitalization).
- The row didn't actually insert (check Studio to confirm).

---

## Common Mistakes

### Mistake 1: Storing the plain password instead of the hash

```sql
-- ❌ DON'T
values ('...', 'test@example.com', 'password123', ...)
```

Without `crypt()`, you've inserted the literal string `password123` into `encrypted_password`. Supabase Auth expects a bcrypt hash there, so when the user tries to log in, it'll compare the submitted password's bcrypt hash against the stored **plaintext** — mismatch every time. Login fails. Always wrap the password in `crypt('...', gen_salt('bf'))`.

### Mistake 2: Using a random UUID and then wondering why the profile insert fails

If you randomize the UUID in `auth.users` but hardcode a different UUID in `public.profiles`, the profile's foreign key to `auth.users.id` will fail. Either hardcode both (as we do), or insert `auth.users` first and use `currval`/`returning` tricks to capture the new UUID — but at that point you've made your seed file needlessly complex. Hardcode.

### Mistake 3: Forgetting `email_confirmed_at`

```sql
-- ❌ leads to "Email not confirmed" on login
email_confirmed_at = null
```

Supabase Auth, by default, blocks login until the user has confirmed their email. In dev you want instant login, so set `email_confirmed_at = now()` during seed insertion. Without it, your test user exists but can't sign in.

### Mistake 4: Putting real user data in seeds

Don't. Ever. Seed files are committed to git and visible to every collaborator (now and forever). A real customer's email in a seed file is a privacy violation even if you delete it later — it's in the git history. Use obvious fakes: `test@example.com`, `alice@example.com`, etc.

### Mistake 5: Relying on seeds in production

```bash
# ❌ this will NOT run seed.sql
pnpm supabase db push
```

`db push` applies migrations to a remote project; it doesn't run `seed.sql`. If you've accidentally built a feature that assumes seeded data will exist in production, that feature breaks the first time a real customer uses it. Seeds exist locally only — every line of app code must handle the case of an empty production database on day one.

### Mistake 6: Omitting `on conflict (id) do nothing`

```sql
-- ❌ crashes if run a second time
insert into auth.users (...) values (...);
```

The first `db reset` succeeds. Then you make a code change, edit the seed, and `db reset` again — crash, because the UUID already exists. `on conflict do nothing` makes seeds idempotent by default. Add it everywhere.

---

## Principal Engineer Notes

### Note 1: Seed data should reflect the messy reality of production

Here we seed one clean test user. That's fine for now, but in Lesson 4.8 we'll seed 20 contacts with **deliberate** variety: some with null email, some with null phone, some with null company. Real users leave fields blank. Real users type short names and long names. Real users paste emails with trailing spaces.

If your seed data is all "Alice Johnson, alice@example.com, Acme Corp, 555-0101" perfection, you'll never discover that your contact list renders `null` as the literal string `"null"` when the phone field is empty. You'll never discover that your edit form crashes when `email` is `null`. You'll build confidently against fake-clean data, ship to production, and the first real user breaks everything.

Principle: **seed data should be at least as messy as production data**. This is a form of adversarial testing — make your local environment slightly annoying on purpose, so production feels easy.

### Note 2: The seeds-vs-migrations boundary is a security boundary

A seasoned engineer will feel a twinge every time they read `crypt('password123', gen_salt('bf'))`. Why? Because a bad deploy script that runs `seed.sql` against production would create a known-password user in production. The consequences are catastrophic.

Supabase CLI's architecture deliberately prevents this: seeds only run on `db reset`, which is a local-only command. The hosted deploy flow explicitly excludes seeds. This is a **security boundary enforced by tooling**, not just by convention. Trust it — but also understand it, so you don't accidentally undo it by writing a custom deploy script that runs `seed.sql` "to be safe."

Never run seed files on production. Ever. The tooling protects you by default; don't go out of your way to defeat it.

### Note 3: Hardcoded UUIDs vs dynamic UUIDs

We hardcoded `00000000-0000-0000-0000-000000000001`. Tools like Postgres' `gen_random_uuid()` could generate a fresh UUID every time. Why hardcode?

**Reasons to hardcode** (what we do):
- You can reliably reference the ID from other seed inserts (e.g., in Lesson 4.8, every contact's `user_id` references this exact UUID).
- Tests that snapshot database state produce stable snapshots (no random UUIDs breaking diffs).
- Debugging is easier — the UUID is memorable and searchable in logs.

**Reasons to randomize**:
- You can seed multiple test users in parallel without ID collisions (useful for large fixture sets).
- Randomization more closely mimics real user UUIDs.

For a small SaaS like Contactly with one to a few test users, hardcoding is clearly the right call. For larger fixture systems (think: 10,000 seeded rows), tools like `pgtap` or `snaplet` generate stable-but-realistic UUIDs programmatically.

### Note 4: Why bcrypt specifically

Supabase uses bcrypt because bcrypt is **deliberately slow**. A single bcrypt hash takes ~50-200ms, which is fine for a human logging in (they don't notice the delay) but **brutal for attackers** trying to brute-force passwords. A million-password list takes decades to crunch through bcrypt, versus seconds against faster hashes like SHA-256.

The `gen_salt('bf')` call uses bcrypt's default cost factor. Higher cost factors mean slower hashing (more security, slower login). Supabase's default is reasonable; don't mess with it unless you have specific threat modeling needs.

### Note 5: Why not use the Supabase Auth API from a script instead?

You might be wondering: couldn't we write a Node script that calls `supabase.auth.admin.createUser({ email, password })` after `db reset`? Yes, and that's a perfectly valid pattern (and we'll do something like it for more complex seeding later). But for simple cases, SQL seeds have advantages:

- They run **inside** the `db reset` step — no extra commands to chain, no race conditions.
- They're pure SQL — readable by any Postgres developer with no JavaScript context.
- They're fast (no HTTP overhead, no client library).

The one downside: raw SQL insertion bypasses Supabase Auth's validation (e.g., email format checks, password strength). For seeds, that's fine — you control the input. For anything user-facing, never insert into `auth.users` directly; always go through the Auth API.

---

## What's Next

In the next lesson (4.3) we'll add a `contacts` table migration and its RLS policies, so users can only see their own contacts. Then in 4.8 we'll come back to `seed.sql` and add 20 realistic contacts for the test user you created today. The `00000000-0000-0000-0000-000000000001` UUID will reappear as every contact's `user_id`.

You now have a repeatable, idempotent, instantaneous dev environment. Every `pnpm supabase db reset` wipes everything and gives you back a working test user in seconds. This is the foundation every well-run team has — most people just don't realize it until they've lost an afternoon re-creating test users by hand.
