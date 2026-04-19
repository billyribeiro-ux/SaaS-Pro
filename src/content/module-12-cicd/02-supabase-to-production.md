---
title: '12.2 - Supabase to Production'
module: 12
lesson: 2
moduleSlug: 'module-12-cicd'
lessonSlug: '02-supabase-to-production'
description: 'Create a production Supabase project and push your migrations to it.'
duration: 15
preview: false
---

## Overview

In lesson 12.1 you mapped the pipeline. This lesson makes the first arrow real. By the end, a **hosted** Supabase project exists, its schema matches your local development project byte-for-byte, and you own two keys — an `anon` key for public client code and a `service_role` key for server-only privileged operations — both scoped to production.

We're stepping off the laptop for the first time since Module 1. The local Docker stack has been faithful; it'll continue to be. But the database users will hit when they visit `contactly.app` is a different beast — a multi-tenant Postgres instance running on AWS infrastructure managed by Supabase, with daily backups, point-in-time recovery (on paid tiers), connection pooling, and a status page that engineers you've never met keep green.

Connecting your local migration history to that production project is the ritual this lesson teaches. Get it right and every future `supabase db push --linked` is a trivial three-second operation. Get it wrong (edit prod through the GUI, lose the migrations, fork the schema) and you've just created the worst kind of tech debt: a database you're afraid to touch.

## Prerequisites

- Lesson 12.1 completed — you understand the pipeline shape.
- Supabase CLI installed locally. Check with `pnpm supabase --version`; you should see something ≥ 1.x. If not: `brew install supabase/tap/supabase` on macOS or [follow platform instructions](https://supabase.com/docs/guides/cli).
- Your local migrations in `supabase/migrations/` are clean — every one runs successfully on `pnpm supabase db reset`. Verify before proceeding.
- A Supabase account (free at supabase.com — GitHub OAuth works).

## What You'll Do

- Create a production Supabase project in the dashboard.
- Generate a Supabase personal access token for the CLI.
- Link your local project to the remote project with `supabase link`.
- Push every migration file to production with `supabase db push`.
- Collect your production URL, `anon` key, and `service_role` key for later use.
- Verify the schema in production matches local.

---

## Step 1: Create the Production Project

Go to [supabase.com](https://supabase.com) and log in. Click **New project**. A form appears.

**Organization:** Supabase groups projects under organizations. If this is your first project, the default personal org works. If you're building something you might bring collaborators or a co-founder onto, create a dedicated "Contactly" org now — moving projects between orgs later is possible but awkward.

**Name:** `contactly-production`. Be explicit. Two months from now when you're creating `contactly-staging`, you'll thank yourself for the clarity.

**Database password:** This is **not** the same as your Supabase account password. It's a password for the Postgres `postgres` superuser role that Supabase creates inside your project's database. You'll need it when the CLI asks.

Critical: **use a real password manager.** Generate a long random string (1Password, Bitwarden, `openssl rand -base64 24`). Copy it. Paste it into the password field. Save it to the manager under the name `Contactly Supabase DB Password (prod)`. If you lose this password, you can reset it from the dashboard — it's not catastrophic — but you will need to re-run `supabase link` afterward, and any automated pipelines that cached the old password will break.

**Region:** Pick the region closest to where most of your users will be. For a US-focused SaaS, `East US (North Virginia)` is the default. For Europe, `West EU (Ireland)` or `Central EU (Frankfurt)`. Latency from app servers (Vercel's edge) to the database adds up — a user in Frankfurt hitting a database in Virginia eats ~80ms per round-trip. Pick once, correctly; moving regions later means migrating data.

**Pricing plan:** Free is fine for launching a small SaaS; Pro ($25/month) gives you point-in-time recovery, longer backup retention, and no auto-pause after a week of inactivity. For a real product you're selling, Pro is table stakes — the backup retention alone is worth the $25 when something goes wrong.

Click **Create new project**. Supabase provisions the infrastructure; this takes 60-90 seconds. You'll land in the dashboard of an empty project with no tables and no users.

---

## Step 2: Grab the Project Ref

While provisioning, note your project ref. In the URL `https://supabase.com/dashboard/project/xyzabcdefgh`, the `xyzabcdefgh` is your project ref — a short random identifier. It's also visible in the project settings (⚙️ → General → Reference ID).

Copy it. You'll use it in the `supabase link` step.

Your production URL is `https://<project-ref>.supabase.co`. So `https://xyzabcdefgh.supabase.co`. This URL is **public** — it appears in client-side code — and safe to share. It's just the address of your database's API endpoint, not an authentication credential.

---

## Step 3: Log In to Supabase from the CLI

The Supabase CLI runs on your laptop and needs to prove to supabase.com that it has the right to push migrations to your project. Authentication happens via a **personal access token** — an API key tied to your account with full CLI privileges.

```bash
pnpm supabase login
```

This opens a browser window. You log in (or confirm you're already logged in). The browser shows a page saying "The Supabase CLI has requested access to your account." You approve. The CLI, running in your terminal, sees a success message.

Under the hood, the CLI has saved a personal access token to `~/.supabase/access-token`. It'll use that token for every subsequent command.

### What if you're in a headless environment?

On a laptop with a browser, `supabase login` is one command. On a server (or inside a CI pipeline, which we'll do in lesson 12.4), there's no browser to open. In those environments, you generate the token manually:

1. Go to [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
2. Click **Generate new token**.
3. Name it (e.g., `Contactly CI Token`). This name is only for your reference.
4. Copy the token immediately — it's shown **once**. If you navigate away without copying, you have to generate a new one. Supabase doesn't store the plaintext.
5. Set it as an environment variable: `export SUPABASE_ACCESS_TOKEN=sbp_...`.

The CLI reads `SUPABASE_ACCESS_TOKEN` automatically if it's set, bypassing the browser flow. We'll do exactly this in CI, where the token gets injected via a GitHub secret.

For your laptop work right now: `pnpm supabase login` and the browser flow is easier. Save the token-in-env trick for lesson 12.4.

---

## Step 4: Link Local to Remote

Now tell the CLI: "this local project directory is associated with this specific remote project."

```bash
pnpm supabase link --project-ref xyzabcdefgh
```

Replace `xyzabcdefgh` with your actual project ref from Step 2.

The CLI prompts for the database password. Paste the password you generated in Step 1 (the one in your password manager, not your Supabase account password). It doesn't echo the input — that's normal.

What does `link` actually do? Three things:

1. Writes a `.temp/project-ref` file with the project ref, so future CLI commands know which remote project to target.
2. Stores the database password in a secure local keychain (via the OS — macOS Keychain, Windows Credential Manager, `libsecret` on Linux) so you don't get prompted for it on every command.
3. Fetches the current state of the remote database (empty, in our case) and reconciles it against your local migration history.

You'll see a success message. At this point your local repo is bidirectionally tied to production — the CLI now knows where to push migrations.

**Important:** `supabase link` is **not** `supabase init`. `init` creates a new project from scratch; `link` connects an existing project. You `link` after you've created the remote project in the dashboard.

---

## Step 5: Push Migrations to Production

The big moment. Your production Supabase is empty — no `profiles`, no `contacts`, no RLS policies, nothing. Your local `supabase/migrations/` folder has every migration file you've written across 11 modules. `supabase db push` applies them all, in timestamp order, to production.

```bash
pnpm supabase db push
```

The CLI prints the list of migrations it's about to apply and asks for confirmation. **Read that list carefully.** If it lists migrations you didn't expect, or is missing ones you did write, something is wrong — don't hit yes.

Example output (yours will have different timestamps):

```
Connecting to remote database...
Applying migration 20260401120000_initial_schema.sql...
Applying migration 20260402150000_profiles.sql...
Applying migration 20260402150100_handle_new_user.sql...
Applying migration 20260418000004_contacts.sql...
Applying migration 20260425143022_subscriptions.sql...
Applying migration 20260510093400_stripe_customers.sql...
...
Finished supabase db push.
```

Total run-time depends on how many migrations you have and their complexity — usually 15-60 seconds.

If any migration fails, Postgres rolls the **entire** `db push` back in a transaction. Your production database either fully matches your migration history or is completely unchanged. There's no half-applied state.

### Why `db push` and not manual SQL?

An alternative to `supabase db push` is connecting to prod with `psql` and running the SQL files by hand. People do this. It's wrong.

The CLI tracks which migrations have been applied by maintaining a `supabase_migrations.schema_migrations` table in your database. Each applied migration adds a row. Next time you run `db push`, it only applies the ones that aren't in that table yet — so running `db push` twice in a row does nothing the second time. Idempotent. Safe.

With manual `psql`, you have to remember which files you ran last time, which ones are new, and apply them in the right order. One mistake and you've either re-run a destructive migration (and lost data) or skipped one (and your schema is broken). The CLI's migration tracking is the entire reason it exists.

---

## Step 6: Verify in the Dashboard

Don't trust; verify.

Open your production project's dashboard → **Database** → **Tables**. You should see every table your migrations create: `profiles`, `contacts`, `subscriptions`, `stripe_customers`, etc.

Click `contacts`. Check:

- Columns match what you expect (id, user_id, first_name, last_name, ...).
- Foreign keys are present (user_id → profiles.id).
- The RLS badge is green (RLS enabled).

Click **Authentication** → **Policies**. Every RLS policy you wrote should be listed. If you see a table with RLS disabled or with zero policies, you have a problem — find it and fix it before moving on, because that table is currently world-readable.

Click **Database** → **Migrations**. The CLI-tracked migration list appears. Every migration you wrote locally should have a "Applied" row here, with timestamps close to when you just ran `db push`.

This five-minute audit is non-negotiable. You cannot deploy an app against a database whose schema you haven't verified eyeball-by-eyeball.

---

## Step 7: Collect the Production Keys

You need three values to connect your deployed SvelteKit app to production Supabase. All three are in the dashboard under **Settings** → **API**.

### 1. Project URL

Format: `https://xyzabcdefgh.supabase.co` (your project ref in place of `xyzabcdefgh`). Copy it.

This is the `PUBLIC_SUPABASE_URL` environment variable your SvelteKit app reads. It's **public** — the client-side JavaScript in the browser uses it to talk to Supabase. Safe to commit to a `.env.example`. Safe to reveal in logs.

### 2. Anon key

Under **Project API keys** → **`anon` `public`**. Copy it. It's a long JWT — starts with `eyJ...`.

This is the `PUBLIC_SUPABASE_ANON_KEY`. Also **public** — it appears in your client-side bundle. It identifies requests as coming from "an anonymous or signed-in user of this project." Combined with RLS policies, it's safe to expose: the worst it can do is what an unauthenticated user could do, which in Contactly is almost nothing (log in, register, maybe view a public landing page).

### 3. Service role key

Under **Project API keys** → **`service_role` `secret`**. Click **Reveal** — it's hidden by default. Copy it. Also a long JWT.

This is the `SUPABASE_SERVICE_ROLE_KEY`. **Never public.** This key bypasses every RLS policy. With it, code can read and write every row in every table as the Postgres superuser. If this key leaks, your entire database is compromised — anyone on the internet with this key can exfiltrate, modify, or delete all customer data.

Where you use it:

- Stripe webhook handlers (server-only, need to write to subscriptions across tenant boundaries).
- Admin scripts you run from your laptop.
- Never in client-side code. Never in a `PUBLIC_` env var. Never in the browser bundle.

Save all three values somewhere safe. A password manager under "Contactly Production Env Vars" is correct. Plaintext in Notion or Google Docs is not. You'll paste these into Vercel's environment variable UI in lesson 12.3.

---

## Step 8: A Sanity-Check Query

Let's prove the production database is alive and responsive. In the dashboard's **SQL Editor**, run:

```sql
select count(*) from public.profiles;
-- Expected: 0 (no users yet)

select count(*) from public.contacts;
-- Expected: 0

select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
-- Expected: the list of every table you expect
```

If the counts are zero and the tables are the expected set, your production database is ready to accept its first user.

---

## Common Mistakes

- **Editing the prod schema via the dashboard GUI.** Studio lets you click "Add column" and mutate tables. Don't. That change lives only in prod — it's not in a migration file — so your next `supabase db push` won't include it. Worse: the next `supabase db reset` locally will wipe it from your local schema. You've now got a prod schema that diverges from your repo, and the CLI will produce inscrutable errors about unreconciled state. **Every change is a migration file, checked into git, applied via `db push`.**
- **Using a weak database password.** `password123` or your name-and-birth-year is a recipe for a brute-forced Postgres. Supabase exposes Postgres via Supavisor (connection pooler) on a public address; if someone finds your project ref, they can attempt to connect. Use 24+ random characters from a password manager.
- **Running `supabase db push` against the wrong project.** You have multiple Supabase projects (development, staging, production) and you accidentally link to prod when meaning to push to staging. Always check the output of `supabase link --status` before pushing. The CLI prints the linked project ref; eyeball it before confirming the push.
- **Forgetting to version-control the migrations folder.** Every migration must be committed to git. A migration that only exists on one dev's laptop is a disaster waiting to happen — when another dev pulls, they can't replay the schema, and when you run `db push` in CI, you're missing the change.
- **Confusing the `anon` key with the `service_role` key.** Both are long JWTs starting with `eyJ`. The payload differs (decode at jwt.io to verify — the `role` claim will say `anon` or `service_role`). Mixing them up means either your app can't authenticate to Supabase (if you use the service role where anon is expected — fine, but wasteful) or, catastrophically, the service role ends up in a `PUBLIC_` env var and gets shipped to every user's browser. Double-check before copying.

---

## Principal Engineer Notes

### Migrations are the source of truth

Not the schema in production. Not the schema in your local Docker. The migration files in `supabase/migrations/` are the source of truth; every database should be reconstructible from replaying those files in order.

This is why `pnpm supabase db reset` works locally — it nukes and replays. This is why `supabase db push` works in production — it applies the missing files. This is why you never, ever edit a production schema through a GUI. The moment you do, reality and the source of truth diverge, and every subsequent action becomes an exercise in reconciling ghosts.

Corollary: once a migration has been applied to production, **never edit that file**. If you need to change what it does, write a new migration that fixes/reverses/augments the old one. Editing an already-applied migration means the timestamp says "applied on 2026-04-01" but the file content is different — next dev who replays from scratch gets a different schema than what's in prod. That path leads to madness.

### Staging environments

We built two Supabase projects in this course: local (via Docker) and production (via supabase.com). Real SaaS teams run a third: **staging**. It's a mirror of production — same cloud region, same Postgres version, same RLS policies — but with fake users and no real customer data.

Why? Two use cases:

1. **Test migrations against production-like data volume** before running them on prod. A migration that takes 10ms on 100 local rows might take 4 hours on 5M production rows, during which the table is locked. Catch that in staging.
2. **Preview potentially breaking changes** with internal QA or a small group of beta testers before rolling to prod.

Contactly doesn't need staging today — it's got zero users. When it has thousands, you'll add a third Supabase project named `contactly-staging` and a third branch protection rule, and your pipeline will have an extra deploy step that pushes to staging first.

### Point-in-time recovery awareness

Supabase's Free tier gives you daily backups retained for 7 days. The Pro tier ($25/mo) adds **point-in-time recovery** — you can restore the database to any moment in the past 7 days, accurate to the second. This is the difference between "oops, I dropped the wrong column at 14:32" being an hour-long inconvenience and a multi-day catastrophe.

When you have real paying customers, Pro tier is non-negotiable. The math is straightforward: one data-loss incident without PITR probably costs more than a lifetime of $25/mo premiums. Budget for it.

### The shape of a safe migration

Production migrations must be **backwards-compatible with the currently-deployed app code**, because for the brief window between `supabase db push` completing and `vercel --prod` deploying the new code, the old code is running against the new schema. Rules that follow:

1. **Adding a column** is always safe (old code ignores it).
2. **Adding a table** is always safe.
3. **Adding an index** is usually safe, but locks the table on older Postgres versions. Use `create index concurrently` for big tables.
4. **Renaming or dropping a column** is **dangerous** — the old code will 500 the instant the column disappears. Do this in two steps: a first migration that adds the new name and keeps the old, a deploy that uses the new name, then a second migration that drops the old name.
5. **Changing a column's type** is often painful. Breaking `text` → `int` without data cleaning breaks things. Plan these carefully, sometimes across multiple deploys.

The unifying principle: the pipeline runs migrations **before** the code deploy, but both old and new code run simultaneously against the new schema for ~30 seconds during the deploy. That window is where bad migrations bite.

### Connection pooling: Transaction vs. Session mode

Supabase exposes Postgres two ways: **direct** (port 5432) and **pooled via Supavisor** (port 6543). Your app connects via the pooler — always. Direct connections are rate-limited on the Supabase side and designed for admin tools, not serverless.

Within the pooler, two modes: **Session** (port 5432 of the pooler) and **Transaction** (port 6543). Transaction mode is what Vercel serverless functions need — each short-lived function instance gets a pooled connection for the duration of its transaction, then releases it. Session mode holds connections longer, which works for long-running processes but exhausts the pool quickly in serverless.

You don't configure this directly — Supabase's connection strings embed it — but when you hit connection-exhaustion errors in production, this is the knob you'll reach for.

---

## What's Next

Production Postgres is live. Next step: a production app to connect to it. In lesson 12.3 you'll install `@sveltejs/adapter-vercel`, update `svelte.config.js`, import the Contactly repo into Vercel, paste the production environment variables we just collected into Vercel's dashboard, and click **Deploy**. Three minutes later, https://contactly-something.vercel.app will be live — running against the production database you built in this lesson.
