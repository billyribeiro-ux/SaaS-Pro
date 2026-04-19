---
title: "4.8 - Seeding Contacts"
module: 4
lesson: 9
moduleSlug: "module-04-crud"
lessonSlug: "08-seeding-contacts"
description: "Add 20 realistic contacts to your seed data so you have a full dataset to develop against."
duration: 8
preview: false
---

## Overview

You've built the contact list, the create flow, the edit flow, and the delete flow. The infrastructure is in place. The one thing you don't have is **data** to test it against. Every time you start the app, you're staring at an empty list, maybe with one or two contacts you created manually. That's enough to verify the happy path works, but it's not enough to find bugs.

This lesson seeds twenty realistic contacts for your test user. Not three — three is too few to exercise pagination, search, sort. Not a thousand — a thousand obscures what's happening when you're trying to eyeball the list. Twenty is the sweet spot: enough to notice pagination edge cases, test search against varied names, and feel how the UI behaves with a real dataset. Few enough that you can still scan the list with your eyes and spot anomalies instantly.

More importantly, the seed contacts are intentionally **messy**: some have null emails, some have null phones, some have null companies, some have two of three fields null. Real users leave fields blank. If your UI assumes every contact has every field, it'll break the moment a real user signs up and only fills in the name. Seed data that reflects production chaos surfaces those assumptions while you're still on your laptop.

## Prerequisites

- Lesson 4.2 complete — `supabase/seed.sql` exists with the test user insert.
- The `contacts` table and its RLS policies exist (from earlier lessons in this module).
- `pnpm supabase start` is running.

## What You'll Build

- A block of 20 `insert into public.contacts` statements added to `supabase/seed.sql`.
- A mix of fully-populated contacts and partially-populated contacts (some nulls).
- A populated dataset ready for pagination, search, empty-state, and edge-case testing.

---

## Why Twenty?

The number matters more than it seems. Here's the decision framework:

**One contact** — enough to verify nothing crashes on a non-empty list. Not enough to test ordering, pagination, the "second page" link, the edit button on row #15, or how the UI behaves when names vary in length.

**Three contacts** — common in beginner tutorials. Barely better than one. You can verify "contacts render in a list," but you can't tell if your pagination works when there are 10+ items and you've set a page size of 10.

**A thousand contacts** — you'd find a lot of performance issues at this scale (N+1 query bugs, missing indexes, memory hogs). But you also can't **read** your list to check it's rendering correctly. Bugs hide in the noise. Tools like Faker generate thousands of contacts for load testing — that's a different use case.

**Twenty contacts** — just right. It's:
- More than a typical "first page" of a paginated list, so pagination gets exercised.
- Few enough that you can scan the list with your eyes in ten seconds.
- Varied enough (if you deliberately vary the data) to stress-test search and filter logic.
- Small enough that the seed runs in milliseconds — no waiting for `db reset`.

In practice, you'll often settle on "a few dozen" for most seeded entities. Ten for a category list. Twenty for contacts. Fifty for messages. Pick a number that's a bit more than your typical page size and reflects realistic variety.

---

## Variety Matters More Than Quantity

Twenty identical contacts ("John Doe, john@example.com, 555-0000") is worse than three varied ones. The goal of seed data isn't volume — it's **coverage**. Your list should include contacts with:

- All fields populated (the "happy path" row).
- Null email (user didn't know the email yet).
- Null phone (contact is work-only, no personal phone).
- Null company (freelancer, family member, someone not attached to a business).
- Two fields null (an incomplete contact someone was halfway through adding).
- Different first-name/last-name lengths (to stress the UI's text-wrapping).
- A mix of alphabetical starting letters (to exercise sort algorithms).

Every null you include is a bug detector. The UI that renders `null` as the literal string `"null"` in the phone column **fails visibly** only when you have a contact with no phone. Without that row, the bug hides until a real user shows up with no phone — and then it's in production.

Realistic messy data is a form of adversarial testing. You're saying to your own code: "here, handle this ugly input; if you can't, fail now while I can fix it."

### Keeping examples ASCII

Real users have names with accented characters (José, François), non-Latin scripts (李), and emoji (seriously, people put emoji in name fields). You eventually want seeds that exercise UTF-8 handling throughout your stack: database column encoding, form input parsing, URL encoding of names, PDF export, etc.

For this lesson we'll keep names ASCII for simplicity. Once the basic app works, consider adding a handful of non-ASCII seeds to catch encoding regressions — but know that doing so might uncover issues unrelated to Contactly's logic (fonts, CSS truncation, third-party libraries that don't handle UTF-8 well). One thing at a time.

---

## Step 1: Open the Seed File

Open `supabase/seed.sql`. The first part (from Lesson 4.2) creates the test user in `auth.users` and `public.profiles`. We're going to **add** to this file — append the contacts block to the end, keeping the user/profile inserts at the top.

Your seed file should currently look roughly like this (from Lesson 4.2):

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

Append the contacts block below it.

---

## Step 2: Add the Contacts Seed Block

Append this to the bottom of `supabase/seed.sql`:

```sql
-- Seed 20 realistic contacts for test user
insert into public.contacts (user_id, first_name, last_name, email, phone, company) values
('00000000-0000-0000-0000-000000000001', 'Alice', 'Johnson', 'alice@example.com', '555-0101', 'Acme Corp'),
('00000000-0000-0000-0000-000000000001', 'Bob', 'Williams', 'bob@example.com', '555-0102', 'TechStart Inc'),
('00000000-0000-0000-0000-000000000001', 'Carol', 'Davis', 'carol@example.com', null, 'DataCo'),
('00000000-0000-0000-0000-000000000001', 'David', 'Martinez', null, '555-0104', null),
('00000000-0000-0000-0000-000000000001', 'Emma', 'Anderson', 'emma@example.com', '555-0105', 'BuildRight LLC'),
('00000000-0000-0000-0000-000000000001', 'Frank', 'Taylor', 'frank@example.com', null, 'SalesForce Partners'),
('00000000-0000-0000-0000-000000000001', 'Grace', 'Thomas', null, '555-0107', 'CloudNine'),
('00000000-0000-0000-0000-000000000001', 'Henry', 'Jackson', 'henry@example.com', '555-0108', 'RetailHub'),
('00000000-0000-0000-0000-000000000001', 'Isabel', 'White', 'isabel@example.com', '555-0109', null),
('00000000-0000-0000-0000-000000000001', 'James', 'Harris', 'james@example.com', null, 'MediaWorks'),
('00000000-0000-0000-0000-000000000001', 'Karen', 'Clark', null, '555-0111', 'FinanceFirst'),
('00000000-0000-0000-0000-000000000001', 'Liam', 'Lewis', 'liam@example.com', '555-0112', 'AutoGroup'),
('00000000-0000-0000-0000-000000000001', 'Mia', 'Lee', 'mia@example.com', '555-0113', 'HealthPlus'),
('00000000-0000-0000-0000-000000000001', 'Noah', 'Walker', null, null, 'EduLearn'),
('00000000-0000-0000-0000-000000000001', 'Olivia', 'Hall', 'olivia@example.com', '555-0115', 'GreenTech'),
('00000000-0000-0000-0000-000000000001', 'Paul', 'Allen', 'paul@example.com', null, null),
('00000000-0000-0000-0000-000000000001', 'Quinn', 'Young', 'quinn@example.com', '555-0117', 'LegalEdge'),
('00000000-0000-0000-0000-000000000001', 'Rachel', 'King', null, '555-0118', 'PropServices'),
('00000000-0000-0000-0000-000000000001', 'Sam', 'Wright', 'sam@example.com', '555-0119', 'ConsultPro'),
('00000000-0000-0000-0000-000000000001', 'Tina', 'Scott', 'tina@example.com', '555-0120', 'CreativeStudio');
```

Twenty rows. Let's understand each piece of it.

---

## Walkthrough

### The `user_id` hardcode

```sql
'00000000-0000-0000-0000-000000000001'
```

Every row's `user_id` is the same UUID — the test user we created in Lesson 4.2. This is the same hardcoded UUID we discussed then. Because we reused it, every contact is owned by the test user. When you log in as `test@example.com`, the contacts page loads these 20 rows.

If you seeded **multiple** test users (maybe one with a free plan, one with pro), each user would get their own block of contacts with a different `user_id`. For Contactly, one test user is enough.

### The multi-row insert syntax

```sql
insert into public.contacts (user_id, first_name, last_name, email, phone, company) values
('00000000-0000-0000-0000-000000000001', 'Alice', 'Johnson', 'alice@example.com', '555-0101', 'Acme Corp'),
('00000000-0000-0000-0000-000000000001', 'Bob', 'Williams', 'bob@example.com', '555-0102', 'TechStart Inc'),
...
```

One `INSERT` statement with many tuples. This is faster than 20 separate inserts (one round-trip, one parse, one plan, one transaction log entry) and keeps the file compact. For larger seed sets (hundreds or thousands), you'd use `COPY` or a `SELECT ... UNION ALL` pattern, but at 20 rows, multi-row insert is perfect.

### The variety in nulls

Scan the data carefully:

| Name | Email | Phone | Company | Scenario |
| --- | --- | --- | --- | --- |
| Alice | yes | yes | yes | Fully populated |
| Bob | yes | yes | yes | Fully populated |
| Carol | yes | **null** | yes | No phone |
| David | **null** | yes | **null** | No email, no company |
| Emma | yes | yes | yes | Fully populated |
| Frank | yes | **null** | yes | No phone |
| Grace | **null** | yes | yes | No email |
| Henry | yes | yes | yes | Fully populated |
| Isabel | yes | yes | **null** | No company |
| James | yes | **null** | yes | No phone |
| Karen | **null** | yes | yes | No email |
| Liam | yes | yes | yes | Fully populated |
| Mia | yes | yes | yes | Fully populated |
| Noah | **null** | **null** | yes | Only name + company |
| Olivia | yes | yes | yes | Fully populated |
| Paul | yes | **null** | **null** | Only name + email |
| Quinn | yes | yes | yes | Fully populated |
| Rachel | **null** | yes | yes | No email |
| Sam | yes | yes | yes | Fully populated |
| Tina | yes | yes | yes | Fully populated |

Count of null fields: 5 emails null, 5 phones null, 3 companies null. Some rows have multiple nulls (David, Noah, Paul). The "name only" case isn't in this set, but you could easily add one if you wanted to exercise that specifically.

This distribution is **intentional**, not random. When you test your UI, you want to see:

- Rows with every field filled — the best case.
- Rows with one field missing — common case.
- Rows with two or more fields missing — rare but real.
- Rows that might look identical except for one null — the "how does our UI differentiate" case.

Every null is a question your UI has to answer: what's shown in its place? An em dash? A placeholder like "No email"? Nothing at all? If you test with only fully-populated contacts, you never answer the question. By the time a real user without a phone signs up, the answer has been made for you — badly.

### The `phone` column storing strings with dashes

```sql
'555-0101'
```

We're storing phone numbers as strings, not integers. This is critical for phone data: leading zeros matter (`0123 456 789`), international formats vary (`+44 20 1234 5678`), and users type dashes and spaces and parentheses. Phone numbers are **not numbers** — they're identifiers that happen to be digits.

The seed uses dashes (`555-0101`) because that matches common US formatting. In a real app, you'd likely normalize phones server-side (strip formatting, store E.164 format like `+15550101000`) and re-format for display. That's beyond Contactly's scope for this module; the seed mimics what a user might type.

### Alphabetical first names

Alice, Bob, Carol, David, Emma, Frank, Grace, Henry, Isabel, James, Karen, Liam, Mia, Noah, Olivia, Paul, Quinn, Rachel, Sam, Tina — A through T.

This isn't strictly necessary, but it's nice: when your contact list sorts alphabetically (a common default), the rendered order matches the seed order, which makes screenshots and mental modeling easier. If you default-sorted by creation date, these would all appear in insertion order (same result, since insertion order follows alphabetical). It's a tiny convenience — once your list has search and filter features, the alphabetical bias is moot.

---

## Step 3: Run `db reset`

Apply the updated seed:

```bash
pnpm supabase db reset
```

Watch the output. You should see migrations run, then the seed file execute. The final lines should indicate success.

### Verify in Studio

Open `http://localhost:54323`:

1. **Table Editor → contacts** — you should see 20 rows, all with `user_id = 00000000-0000-0000-0000-000000000001`.
2. Look for null values in the email, phone, and company columns. They should be visibly `NULL` (or blank, depending on Studio's display).

### Verify in the app

1. Log in at `/login` with `test@example.com` / `password123`.
2. Navigate to `/contacts`.
3. You should see all 20 contacts. Pay attention to how nulls render — does your UI show "No email" or a blank cell or the literal string "null"? If it's the last one, you have a bug to fix.

The fact that this moment revealed a potential bug is exactly the point of seeded variety.

---

## Common Mistakes

### Mistake 1: Storing phones as integers

```sql
-- ❌ DON'T
phone bigint
```

Leading zeros get stripped (`0123 -> 123`). Dashes and parentheses cause insert failures. International prefixes fail (`+1...` is not a number). Phone numbers go in `text` columns. Period.

### Mistake 2: Hardcoding emails that collide with real usage

Your seeds use `alice@example.com`, `bob@example.com`. That's fine — `example.com` is IANA-reserved and no real person owns those addresses. Avoid using:

- Gmail/Yahoo/iCloud addresses ("alice@gmail.com" — a real person might own this).
- Addresses on your own domain unless you own them specifically for testing.
- Your coworkers' real email addresses for "realism" (DO NOT DO THIS).

`example.com`, `example.org`, `example.net`, and the `.test` TLD are all safe for testing.

### Mistake 3: All contacts owned by different user IDs

```sql
-- ❌ scattered ownership, nothing loads when you log in
('random-uuid-1', 'Alice', ...)
('random-uuid-2', 'Bob', ...)
```

If each contact has a different `user_id`, none of them belong to your test user. Log in as `test@example.com`, go to `/contacts`, see an empty list. Always hardcode `user_id` to match the test user.

### Mistake 4: Forgetting `on conflict` (edge case)

Our contacts insert doesn't have `on conflict do nothing`. Why? Because `contacts` uses a random primary key (typically `id uuid default gen_random_uuid()`), so running the seed twice would produce **different** UUIDs for what's semantically the "same" seeded contact. There's no natural conflict to resolve.

**In practice**, `db reset` wipes everything before seeds run, so running the seed twice would produce 40 rows, not 20 — but only if you somehow ran seeds twice without a reset, which isn't the normal workflow. If this matters for your setup (maybe you're scripting multiple seed passes), add a `where not exists` clause or a unique constraint to handle it.

### Mistake 5: Putting real customer data in seeds to "make it realistic"

```sql
-- ❌ AND NEVER
('test-user-id', 'John', 'Smith', 'real-customer@their-company.com', ...)
```

Seed files are in git. Real data in git is a privacy leak, and the git history makes it effectively permanent. Stick with fake names, fake emails on reserved domains, fake companies. It looks less realistic, but "realistic" is secondary to "legally and ethically safe."

### Mistake 6: Forgetting to re-run `db reset` after editing seed

Seeds don't auto-apply. Edit the seed file, run `pnpm supabase db reset`. Without the reset, the database still has the old seed data (or no seed data if you just created the file). Easy to forget, instant mystery bugs.

---

## Principal Engineer Notes

### Note 1: Deterministic seeds vs random faker data

Two philosophies for seeding:

**Deterministic seeds** (what we do): hardcoded names, hardcoded UUIDs, same output every time. Pros: tests that snapshot the database stay stable; developers see the same data, which makes collaboration easier ("what's happening with Alice's record?" — both devs see the same Alice). Cons: data doesn't feel realistic; all names are short Western European names.

**Faker-generated seeds**: a library like [@faker-js/faker](https://fakerjs.dev) generates random but realistic names, emails, and companies on every run. Pros: more realistic variety, surfaces weird character handling bugs, scales to thousands of records. Cons: tests that compare exact data break on every reset; debugging "why is Alice broken?" is impossible because there's no Alice.

Rule of thumb: **deterministic seeds for development workflows, faker-generated for load tests and stress tests**. Contactly uses deterministic; Module 11 (testing) will bring faker in for data-rich test fixtures.

### Note 2: Keeping seed data small and fast

`db reset` should feel instant — ideally under a second for the seed step. If your seed file grows to thousands of rows, you'll notice:

- `db reset` takes longer → developers avoid running it → they work against stale state → bugs.
- Tests that rely on seed data run slower → CI pipeline times grow → iteration slows.

Keep the seed small. If you need lots of data for specific tests, generate it on-demand in those tests (setup hooks), not in the global seed.

### Note 3: Versioning seed changes alongside migrations

A subtle coordination problem: you add a `birthday` column in a new migration, but you forget to update the seed. Next `db reset`, the seed succeeds (because `birthday` is nullable) but has no interesting birthday data. The UI you built to display birthdays renders emptily during testing, and you think your feature is broken.

Or worse: you **remove** a column in a migration, and the seed still references it. `db reset` fails because the `insert` references a column that no longer exists. Every developer on the team is blocked until someone fixes the seed.

**Discipline**: when you change schema, update the seed in the same commit. Treat them as one change. `git status` right before committing should show both `supabase/migrations/*` and `supabase/seed.sql` if you've touched columns.

### Note 4: The "test data reveals coverage gaps" principle

Every variation in seed data corresponds to a test case you're implicitly running against your UI. If your seed has no null phones, you've never tested "how does this UI handle null phones." That's a gap.

Keep a mental (or explicit, in a comment) list of what your seed covers:

```sql
-- Seed coverage:
-- - Fully populated contacts: 10
-- - Null email: 5
-- - Null phone: 5
-- - Null company: 3
-- - Multiple nulls: 3
-- - Not yet covered: long names (>50 chars), non-ASCII names, duplicate first+last name
```

When a bug report comes in ("names wrap weirdly for 'Elizabeth Montgomery-Worthington'"), you add a long-name seed. The bug gets fixed and stays fixed — because next time you run `db reset`, the test data catches any regression.

### Note 5: Seed data as living documentation

A well-crafted seed file doubles as **documentation of your domain model**. A developer joining the project can open `seed.sql` and see:

- "Oh, contacts can have null phone, null email, or null company. OK."
- "Oh, the test user is user_id 00000...001. OK."
- "Oh, profiles and auth.users share the same UUID. OK."

These invariants are discoverable **without** reading migrations, without running the app, without pinging a teammate. The seed file is a two-minute orientation for new contributors.

Invest in your seed file. It pays for itself every time someone new joins the team.

### Note 6: When to move beyond SQL seeds

`seed.sql` works great until you hit cases like:

- "I need to create a user with a real bcrypt-hashed password." (SQL can do this with `crypt()`, we already do.)
- "I need to upload 10 avatar images to Supabase Storage." (SQL can't do this directly.)
- "I need to simulate a complete onboarding flow: user signs up, creates a workspace, invites teammates." (SQL can, but becomes brittle.)

At that point, you move to a **seed script** written in TypeScript that uses `supabaseAdmin` (the client you built in Lesson 4.4) to make real API calls. The seed script is invoked after `db reset` — either manually or via a `pnpm seed` command in your `package.json`.

For Contactly's current scope, SQL is enough. But know that the pattern evolves, and there's no shame in moving from `seed.sql` to `seed.ts` as needs grow.

---

## What's Next

With 20 realistic contacts loaded, the rest of Module 4 (Lesson 4.9 and onward) becomes much more satisfying to build and test. You'll see pagination work with real data. You'll see your search box filter across real names. You'll find edge cases you didn't know existed. That's the productivity multiplier of good seed data.

This also closes the loop on Lesson 4.2. We created a test user; we created a profile; now we created 20 contacts owned by that user. The `00000000-0000-0000-0000-000000000001` UUID you typed three lessons ago is now the root of a full local dataset you can develop against forever.
