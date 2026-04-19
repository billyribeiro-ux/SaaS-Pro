---
title: "4.1 - Contacts Table & RLS Policies"
module: 4
lesson: 1
moduleSlug: "module-04-crud"
lessonSlug: "01-contacts-table-rls"
description: "Create the contacts table — the core data model of Contactly — with full Row Level Security."
duration: 12
preview: false
---

## Overview

This is the lesson where Contactly stops being a login wrapper and starts being a real product. We're building the `contacts` table — the heart of the app. Everything that follows (list, create, edit, delete, search, billing, exports) hangs off this table.

But we're not just making a table. We're making a **multi-tenant** table. A single `contacts` table in Postgres will hold every contact for every user who ever signs up — Alice's contacts, Bob's contacts, the CEO of a Fortune 500 company's contacts, all sharing the same rows of physical storage. The database mechanism that keeps Alice from seeing Bob's data isn't a clever `WHERE` clause in our application code — it's **Row Level Security (RLS)** enforced by Postgres itself, at the row level, on every query, no matter where the query comes from.

Get this lesson right and data isolation is a property of the database. Forever. Get it wrong and you'll leak customer data the first time a junior engineer writes a query without the right filter.

## Prerequisites

- Module 3 complete — users can register, log in, log out, see their account.
- Local Supabase running (`pnpm db:start`) and Studio accessible at `localhost:54323`.
- Comfortable with the migration workflow from Module 1.

## What You'll Build

- A new migration file creating the `contacts` table.
- Nine columns covering identity, ownership, personal info, and audit trail.
- A foreign key to `profiles(id)` with cascade-on-delete.
- Four RLS policies — one each for SELECT, INSERT, UPDATE, DELETE.
- Regenerated TypeScript types so `supabase.from('contacts')` autocompletes perfectly.

---

## Step 1: Why Multi-Tenant Needs Row-Level Security

Before we write any SQL, let's be clear on what we're defending against. Contactly is what's called **shared-database multi-tenancy**: one Postgres instance, one `contacts` table, many users sharing it. The alternatives are:

- **Database-per-tenant**: every user gets their own database. Great isolation, absurd operational cost at scale.
- **Schema-per-tenant**: every user gets their own Postgres schema inside a shared database. Middle ground. Still expensive.
- **Shared schema, shared tables**: every user's data lives in the same tables, distinguished by a `user_id` column. Cheapest, simplest — **and what we're using**.

Shared-schema multi-tenancy is the pattern behind Notion, Linear, Stripe Dashboard, GitHub, and most modern SaaS. It's the right choice. But it has one gotcha: every single query must filter by `user_id`. Miss one query — one `select * from contacts` without a `where` — and every user can see every other user's data.

The naive defense is "we're careful in our application code." That defense fails the first time:
- A developer forgets a `.eq('user_id', ...)` filter.
- A background job runs a query from the wrong context.
- A SQL injection vulnerability lets an attacker bypass WHERE clauses.
- An API endpoint accidentally returns too many columns.

Postgres gives us a better defense: **Row Level Security**. You turn it on for a table, you write policies describing who can do what, and from that moment on Postgres **physically refuses** to return rows that don't match those policies — even to queries that forgot the WHERE clause. It's database-layer enforcement, not application-layer discipline.

Let's look at what RLS does in pseudo-SQL. Without RLS:

```sql
select * from contacts;
-- Returns EVERY row for EVERY user. Apocalypse.
```

With RLS enabled and a policy `using (auth.uid() = user_id)`:

```sql
select * from contacts;
-- Postgres transparently rewrites this to:
-- select * from contacts where user_id = auth.uid()
-- Returns only rows owned by the currently authenticated user.
```

The WHERE clause is **added for you, invisibly, by the database**, on every query — even ones written carelessly. RLS is belt-AND-suspenders: you still filter in your app code for clarity and performance, but the database guarantees correctness even if the app forgets.

This is the single most important Postgres feature for SaaS. Your app's security posture is essentially "RLS is either on or you're dead." It's on in Contactly.

---

## Step 2: Create the Migration File

We make a new migration with the Supabase CLI. Never edit the database through Studio's GUI — every change must be a migration, version-controlled, replayable, peer-reviewable.

```bash
pnpm supabase migration new create_contacts_table
```

This creates a new file under `supabase/migrations/` with a timestamp-prefixed name like `20260418120000_create_contacts_table.sql`. The timestamp ensures migrations run in the exact order they were created — no matter who on your team wrote what when.

Open the new file. It's empty. We're about to fill it.

---

## Step 3: The Schema — Column by Column

Here's the full table definition. We'll break it apart right after.

```sql
-- supabase/migrations/20260418000004_contacts.sql

create table public.contacts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  company text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
```

### `id uuid default gen_random_uuid() primary key`

A UUID — universally unique identifier — is a 128-bit random string. The odds of two UUIDs ever colliding across the universe's machines are astronomically low (the birthday paradox kicks in after ~2.7 quintillion generations).

We pick UUIDs over integer IDs for three reasons:

1. **No information leak.** An integer ID lets anyone who sees `/contacts/42` know you have at least 42 contacts. UUIDs reveal nothing.
2. **Offline-friendly.** Clients can generate UUIDs locally before the row hits the database. Useful for sync/offline-first apps (not Contactly today, but future-you might want this).
3. **Migration-friendly.** If you ever shard or replicate, integer primary keys collide. UUIDs don't.

`gen_random_uuid()` is a Postgres function (available via the pgcrypto extension, which Supabase enables by default) that generates a v4 UUID. `default gen_random_uuid()` means: if an insert doesn't specify `id`, Postgres generates one.

`primary key` means: unique, not-null, and automatically indexed. Primary key creates a B-tree index — lookups by `id` become O(log n) instead of O(n).

### `user_id uuid references public.profiles(id) on delete cascade not null`

This is the ownership column. Every contact **belongs to** exactly one profile. Let's break down each piece:

- `user_id uuid` — the column type matches `profiles.id`. Mismatched types break foreign keys.
- `references public.profiles(id)` — foreign key constraint. Postgres refuses to insert a `contacts` row whose `user_id` doesn't match an existing `profiles.id`. No orphan contacts can exist.
- `on delete cascade` — when a profile is deleted, every contact belonging to it is automatically deleted. We'll dig into this in a moment.
- `not null` — every contact **must** have an owner. A contact with `user_id` = null would be visible to no one (the RLS policy requires `auth.uid() = user_id`), so it would be a garbage row. `not null` prevents it.

#### Why `references profiles(id)` and not `references auth.users(id)`?

`auth.users` is Supabase's internal auth table. You should never directly reference it from your application tables. Reasons:

1. `auth` schema is managed by Supabase. They could restructure it in a future version.
2. Your app code shouldn't know about auth internals — it should deal with a domain concept (a "profile" / "user" in your app's terms).
3. Referencing `profiles` means `contacts` automatically benefits from any additional constraints or logic you put on `profiles` later.

In Module 1 you set up `profiles` with `id uuid references auth.users(id)`. That's the correct indirection. `contacts.user_id` points to `profiles.id`, which points to `auth.users.id`. Your app code only ever sees `profiles`.

#### What `on delete cascade` actually does

Say Alice deletes her Contactly account. Supabase deletes her row from `auth.users`. That triggers `profiles`'s `on delete cascade` (set up in Module 1): her profile row gets deleted too. That, in turn, triggers `contacts`'s `on delete cascade`: every contact where `user_id = alice_uuid` gets deleted.

All in one transaction. All automatically. No orphaned data. No manual cleanup scripts. This is how you implement "account deletion" without writing application code — the database does the work.

The alternative, `on delete restrict`, would **refuse** to delete the parent profile while child contacts exist, forcing you to delete contacts manually first. That's useful for audit-heavy systems (e.g., "never delete a customer who has orders"). For Contactly, cascade is correct — when the user leaves, their data leaves with them. GDPR right-to-erasure, satisfied by one DDL keyword.

### `first_name text not null, last_name text not null`

Two required fields. Every contact has at least a name.

`text` (not `varchar(100)`) — Postgres's preferred string type. It has no fixed length, but it's not slower than `varchar` — behind the scenes they're the same type. Length caps in the database layer are legacy baggage from other RDBMSs; in Postgres, cap lengths in application code (our Zod schemas in the next lesson).

`not null` — if you don't supply a value, the insert fails. Prevents the UI from silently creating blank contacts.

### `email text, phone text, company text`

Three optional fields. No `not null`, so they can hold NULL. NULL in SQL is the "we don't know" value — different from empty string.

We'll handle the distinction in our server action later: if the user submits an empty email field, we convert it to NULL before inserting. That way, `email IS NULL` means "no email" and `email = ''` never happens.

### `created_at timestamptz default now() not null`

`timestamptz` — "timestamp with time zone." Stores the UTC instant, not a wall-clock time. Read the Postgres docs on time zones sometime; it's one of those topics that seems simple and isn't.

`default now()` — if the insert doesn't specify `created_at`, Postgres fills in the current moment automatically. Every contact gets a creation timestamp for free.

`not null` — belt-and-suspenders. With the default, you can't omit it anyway, but explicit not-null documents intent.

### `updated_at timestamptz default now() not null`

Same as above. But this one needs to change **every time the row is updated**. We'll add a trigger for that in a moment — or rather, we already have one (`set_updated_at`) from Module 1. We can reuse it.

---

## Step 4: Enable RLS

The schema is written. Now we light up RLS.

```sql
alter table public.contacts enable row level security;
```

This single line is catastrophically important. Run it and one of two things happens:

1. **If no policies exist:** The table becomes completely invisible to everyone except the table owner (the Postgres superuser). Even authenticated users see nothing. Every `select` returns zero rows. Every `insert`/`update`/`delete` is rejected with a policy error.

2. **If policies exist:** Each query is filtered through every applicable policy. Rows that pass are returned; rows that don't are silently filtered out.

So after `enable row level security`, the table is locked by default. We have to explicitly grant access via policies. This is exactly what we want: **deny by default, allow by policy**.

If you ever see "I enabled RLS and my app stopped working" — that's the feature, not a bug. Write the policies.

---

## Step 5: Writing the Four Policies

RLS policies are per-operation: SELECT, INSERT, UPDATE, DELETE. Each policy is named, attached to one operation type, and contains either a `using` expression (which rows are visible) or a `with check` expression (which rows can be written) or both.

### Policy 1 — SELECT

```sql
create policy "Users can view own contacts"
  on public.contacts for select
  using (auth.uid() = user_id);
```

Let's dissect piece by piece:

- `create policy "Users can view own contacts"` — the policy's human-readable name. Shows up in Studio and error messages. Pick descriptive names; they're documentation.
- `on public.contacts` — which table this applies to.
- `for select` — this policy applies only to SELECT statements. An INSERT, UPDATE, or DELETE is governed by its own policies.
- `using (auth.uid() = user_id)` — the predicate. For every row Postgres considers returning, it evaluates this expression. If it's true, the row is visible; if false, the row is invisible. `auth.uid()` is a Supabase helper function that returns the currently authenticated user's UUID (from the JWT claim `sub`).

The effect: when Alice (UUID `alice-uuid`) runs `select * from contacts`, Postgres returns only rows where `user_id = 'alice-uuid'`. Bob's contacts are filtered out — not hidden, not 403'd, just **invisible**, as if they didn't exist.

### Policy 2 — INSERT

```sql
create policy "Users can create own contacts"
  on public.contacts for insert
  with check (auth.uid() = user_id);
```

INSERT uses `with check`, not `using`. Here's the distinction:

- **`using`** — applies to **existing rows**. "Which of the rows Postgres is about to return/modify/delete should be allowed?"
- **`with check`** — applies to **new or updated row values**. "Is the new data being written to the table permitted?"

For INSERT, there are no existing rows — you're creating fresh data. So `with check` guards what the user is **writing**: the new row's `user_id` column must equal `auth.uid()`. If Alice tries to insert a row with `user_id = bob-uuid`, Postgres rejects it with a policy violation error.

This is exactly why our server action will set `user_id` from `locals.getUser()`, never from form input. The database refuses bad values; the server code ensures we always send good values. Two layers of defense.

### Policy 3 — UPDATE

```sql
create policy "Users can update own contacts"
  on public.contacts for update
  using (auth.uid() = user_id);
```

UPDATE uses `using` (by default). The policy says: "for each existing row the UPDATE statement would modify, check that `auth.uid() = user_id` before allowing the change."

So Alice's attempt to `update contacts set first_name = 'hacked' where id = bob_contact_id` becomes, internally:

```sql
update contacts set first_name = 'hacked'
  where id = bob_contact_id
    and auth.uid() = user_id
    -- which is user_id = 'alice-uuid'
    -- but Bob's contact has user_id = 'bob-uuid'
    -- so no rows match; update affects 0 rows
```

Alice's query succeeds but updates zero rows. Bob's contact is untouched.

You **can** also add `with check` to UPDATE to prevent changing `user_id` mid-update (stopping Alice from updating her own contact and re-assigning it to Bob). For a polished production schema you'd write:

```sql
create policy "Users can update own contacts"
  on public.contacts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

The simpler version (without `with check`) is what we're using, which is fine because we never expose the `user_id` field in forms. The policy assumes you're not letting the user edit `user_id` — a reasonable assumption, and one our form reinforces by not even having the field.

### Policy 4 — DELETE

```sql
create policy "Users can delete own contacts"
  on public.contacts for delete
  using (auth.uid() = user_id);
```

Same shape as UPDATE. Alice can only delete rows where `user_id = alice-uuid`. Bob's rows are filtered out before the DELETE touches them.

---

## Step 6: The Full Migration

Here's the complete file one more time:

```sql
-- supabase/migrations/20260418000004_contacts.sql

create table public.contacts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  company text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.contacts enable row level security;

create policy "Users can view own contacts"
  on public.contacts for select
  using (auth.uid() = user_id);

create policy "Users can create own contacts"
  on public.contacts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own contacts"
  on public.contacts for update
  using (auth.uid() = user_id);

create policy "Users can delete own contacts"
  on public.contacts for delete
  using (auth.uid() = user_id);
```

(If you want updated_at to auto-update, you could also add a trigger reusing the `set_updated_at` function from Module 1:
```sql
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();
```
We'll rely on application code to set `updated_at = new Date().toISOString()` during updates — same effect, less magic.)

---

## Step 7: Apply the Migration

```bash
pnpm supabase db reset
```

`db reset` does three things:
1. Drops and recreates the local Postgres database.
2. Replays every migration in `supabase/migrations/` in order.
3. Runs `supabase/seed.sql` (empty for now — we'll populate it in 4.2).

You should see output ending in `Finished supabase db reset on branch main.` Check Studio at `http://localhost:54323` → Database → Tables. `contacts` should appear with the columns you defined. Click **RLS policies** and confirm all four policies exist.

---

## Step 8: Regenerate TypeScript Types

Supabase can generate TypeScript types from your actual database schema. Since we just changed the schema, we need to regenerate.

```bash
pnpm supabase gen types typescript --local > src/lib/types/database.types.ts
```

Let's unpack this command:

- `pnpm supabase gen types typescript` — invokes the type generator, TypeScript output mode.
- `--local` — use the running local database (not a hosted project).
- `> src/lib/types/database.types.ts` — redirect stdout into our types file, overwriting its contents.

Now `database.types.ts` contains an accurate `Database` type reflecting the `contacts` table. When you later write `supabase.from('contacts')`, TypeScript knows the column names and types — typos get flagged at build time, not in production.

Re-run this command every time you change a migration.

---

## Step 9: Quick Smoke Test in Studio

Let's verify RLS works with our own eyes before moving on. In Studio → SQL Editor:

```sql
-- Insert a test contact assuming Alice's UUID is 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
insert into public.contacts (user_id, first_name, last_name)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test', 'Contact');

-- Query as Alice (logged in with her JWT)
select * from public.contacts;
-- Should see 1 row

-- Query as Bob (different JWT)
select * from public.contacts;
-- Should see 0 rows, even though Alice's row is in the table
```

You can also test via the Supabase client by logging in as one user, creating contacts, logging in as another, and confirming you see nothing from the first user. RLS is transparent — no error messages, no 403s, just zero rows.

---

## Common Mistakes

### Mistake 1: Forgetting `enable row level security`

```sql
create table public.contacts (...);
-- (no enable row level security)
create policy "..." on public.contacts ...;
```

Policies without RLS enabled are **decorative**. Postgres happily lets anyone see every row because the table isn't RLS-protected. The policies exist, but they aren't enforced.

Always `alter table ... enable row level security` right after `create table`. Make it muscle memory.

### Mistake 2: Using `user_id` with no foreign key

```sql
user_id uuid not null, -- no references!
```

You can insert any random UUID. Delete a user? Their contacts become orphans pointing at nothing. The database is no longer consistent. Always use `references` for relationships.

### Mistake 3: Referencing `auth.users` directly

```sql
user_id uuid references auth.users(id) on delete cascade,
```

It works — but it leaks the auth layer into your domain model and couples you to Supabase internals. Go through `profiles`. Your future self thanks you when you migrate auth providers or restructure internals.

### Mistake 4: `using` where you need `with check` (or vice versa)

```sql
-- INSERT policy with `using` — this is a no-op
create policy "Users can create own contacts"
  on public.contacts for insert
  using (auth.uid() = user_id);
```

For INSERT, the predicate goes in `with check`, not `using`. The table has zero existing rows to evaluate `using` against. The policy allows every insert because it applies to no rows.

Mnemonic: `using` is about rows that **already exist**; `with check` is about rows you're **writing or modifying to be**.

### Mistake 5: Editing tables via Studio GUI

Studio lets you right-click a table and change columns. **Don't.** Changes you make via the GUI aren't written to a migration file — they only live in your local database. When you deploy to production, the schema isn't applied. Your code breaks in production.

Rule: all schema changes are migrations. If Studio is easier for you to think in, use it as a GUI to **write SQL**, then copy the SQL into a migration file. Never click "Save" on the GUI.

### Mistake 6: Skipping type regeneration

Change the schema, don't regenerate types, keep coding. TypeScript is happy because it still thinks the old schema is in effect. You get runtime errors in production that never surfaced in dev.

Run `pnpm supabase gen types typescript --local > src/lib/types/database.types.ts` every time you change a migration. Consider adding it to a `pnpm db:sync` script so it's one command.

---

## Principal Engineer Notes

### Notes on RLS performance

RLS adds a WHERE clause to every query. For indexed columns (like `user_id`, which is indexed because it's a foreign key), the cost is negligible — Postgres's query planner folds the policy predicate into the WHERE and uses the index normally.

For unindexed policy predicates, RLS can be catastrophic. A policy like `using (auth.uid() = owner_id)` without an index on `owner_id` means every query does a full table scan.

**Rule:** any column referenced in an RLS policy should be indexed. `user_id` being a foreign key gives us the index for free. If you add a policy later that predicates on a non-FK column, add an index for it.

### Notes on service-role escape hatches

The `service_role` key **bypasses RLS entirely**. When you use `supabaseAdmin` (the client we'll build in 4.4), policies don't apply. This is intentional — it's how webhooks and admin operations cross tenant boundaries.

But it's also a sharp knife. Any query made via `supabaseAdmin` that forgets `where user_id = ...` leaks every user's data. Defense-in-depth: keep `supabaseAdmin` usage rare, grep-able, and code-reviewed. Most of your code should use `locals.supabase`, where RLS does the heavy lifting.

### Notes on policy readability

You can — and should — write more complex policies than `auth.uid() = user_id`. Real SaaS policies look like:

```sql
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members
    where team_id = contacts.team_id
      and user_id = auth.uid()
      and role in ('admin', 'editor')
  )
)
```

That policy implements "a contact is visible to its owner OR to members of the team the contact is associated with, if the member has at least 'editor' role." Full team-based sharing. No app code needed — the database enforces it uniformly across every query path.

The lesson: RLS isn't just for ownership; it's a general-purpose authorization engine. Build team/org features here, not in your route handlers.

### Notes on `deleted_at` (soft deletes)

Our `contacts` table uses hard deletes — a deleted row is gone forever. Many enterprise apps use **soft deletes**: add a `deleted_at timestamptz` column, nullable, and update the policies to `using (auth.uid() = user_id and deleted_at is null)`. "Delete" becomes an UPDATE that sets `deleted_at = now()`; the row is hidden but recoverable.

Tradeoffs: soft deletes enable undo and audits, but complicate queries (every query needs the `deleted_at is null` filter — which RLS handles for you if you bake it into the policy), balloon storage, and create GDPR complexity (real erasure still means a hard delete). For Contactly, hard deletes match user expectations ("when I delete a contact, they're gone"). For a bank's ledger, soft deletes would be mandatory.

### Notes on audit columns beyond created/updated

Production schemas often add:

- `created_by uuid` — who created the row (might differ from `user_id` in team scenarios)
- `updated_by uuid` — who last modified it
- `version int` — optimistic concurrency control; bumped on every update

Each column adds a few bytes per row and a layer of defensibility when something weird happens in production logs. We're starting minimal and will layer on as the course progresses.

### Notes on multi-column policies and dependent data

If `contacts` gained a `team_id` column and the team-membership rule above, you'd also want an index on `(team_id, user_id)` in `team_members`. The rule of thumb: write your policies first, then examine every query the policy evaluates against, and add indexes for the policy's predicates. Policies that require a JOIN in their predicate will perform queries within queries — you pay for that.

---

## What's Next

We have a contacts table with airtight RLS. But a hot-off-the-press local database has zero rows. The contacts list will be a sad empty state. The dashboard will have nothing to render. We can't visually iterate on UI with no data.

Lesson 4.2 wires up `supabase/seed.sql` so every `db reset` automatically creates a test user (`test@example.com` / `password123`) ready to log in. Then in 4.8 we'll seed 20 realistic contacts for that user. By the end of this module you'll type `pnpm db:reset` and have a fully populated development environment with one command.
