---
title: "1.2 - Supabase Local Development"
module: 1
lesson: 2
moduleSlug: "module-01-project-setup"
lessonSlug: "02-supabase-local-development"
description: "Set up a complete local Supabase development environment using Docker and the Supabase CLI."
duration: 15
preview: false
---

## Overview

In this lesson you'll install Docker Desktop, then spin up a complete local copy of Supabase on your own computer. By the end you'll have a working PostgreSQL database, an auth server, a file storage service, a realtime service, and a visual admin interface — all running privately on your machine, for free, with no rate limits.

If you're new to coding, "running a database on your computer" may sound intimidating. It isn't. Modern tools turn a task that used to take a sysadmin a day into a one-line command. Your job is to understand **why** we're doing it this way, so that when something breaks (and it will, eventually), you know where to look.

## Prerequisites

- Lesson 1.1 complete — you have a `contactly/` folder with a running SvelteKit dev server.
- **Docker Desktop installed.** Download from [docker.com](https://www.docker.com/products/docker-desktop/). Install it, open it, and leave it running. You should see the whale icon in your system tray (macOS menu bar / Windows taskbar).
- **A Supabase account** at [supabase.com](https://supabase.com). Free. You won't use it until much later in the course (when we deploy to production), but creating it now saves a step later.

## What You'll Build

After this lesson:
- A full Supabase stack runs locally at `http://localhost:54321` (the API).
- Supabase Studio — a visual database admin panel — runs at `http://localhost:54323`.
- Your `.env` file contains real local credentials.
- You can start, stop, and reset the stack with pnpm scripts.

---

## What Is a Database? (If You're New)

Skip this section if you've used a database before. If not, here's the one-page version.

A **database** is a program whose only job is to store structured data — rows of information, organized into tables — and answer questions about it quickly. A spreadsheet is roughly a database with a pretty UI. A real database handles millions of rows, many users at once, strict data rules, and questions like "give me all contacts added by user X in the last 30 days, sorted by last name."

**PostgreSQL** (usually just "Postgres") is the open-source database we'll use. It has been in active development since 1986, it is extremely reliable, and it's what most modern SaaS companies rely on. Supabase is essentially Postgres plus a set of services bolted on top: auth, storage, realtime, and a web admin UI.

---

## What Is Supabase? (And Why Are We Using It?)

Building a SaaS app requires more than just a database. You also need:

| Problem | Without Supabase | With Supabase |
|---|---|---|
| "Let users sign up and log in" | Write your own auth server, hash passwords, handle password reset flows, manage OAuth. | Call `supabase.auth.signUp()`. |
| "Let users upload avatars" | Set up S3, write upload endpoints, manage permissions. | Call `supabase.storage.from('avatars').upload()`. |
| "Push live updates to all connected clients" | Run a WebSocket server, broadcast changes. | Subscribe to a Postgres table. |
| "Secure each user's data" | Custom middleware in every route. | Row Level Security policies. |

Supabase packages all of this into one product, built around PostgreSQL, and makes it runnable locally via Docker — which is what we're setting up now.

**Why not Firebase?** Firebase uses a proprietary NoSQL database (Firestore). If you outgrow Firebase, you're stuck — there's no obvious migration path. Supabase is built on Postgres, which is portable, standardized, and supported by every hosting provider on earth. If Supabase the company vanished tomorrow, you could copy your data to any Postgres host and keep running.

---

## What Is Docker? (And Why Do We Need It?)

A **container** is a sealed, self-contained mini-computer that runs a specific program. It includes that program and every library, setting, and file the program needs — nothing more. You can start a container, stop it, delete it, and start a fresh one in seconds. You can run ten containers on one computer, each isolated from the others.

**Docker** is the most common tool for running containers. **Docker Desktop** is Docker packaged with a friendly app for macOS and Windows.

When you run `supabase start`, Docker:
1. Downloads pre-built container images for Postgres, the auth server, storage, etc. (About 1.5 GB the first time — faster afterwards because they're cached.)
2. Starts each as an isolated container.
3. Connects them together with an internal virtual network.
4. Forwards specific ports to your machine so you can reach them from your browser.

**Why this matters:** without Docker, installing Postgres + an auth server + storage + realtime means manually installing five different programs, each with their own config files, into your OS. Docker lets you do it in one command and throw it all away just as easily. Your host OS stays clean.

**Check Docker is running.** Open Docker Desktop. If the dashboard shows "Docker Desktop is running", you're ready. If it asks you to update, accept the update. If you see resource warnings, the defaults are fine for this course.

---

## Why Local Development Matters

Most beginner tutorials tell you to point your app at a Supabase cloud project during development. We're not doing that. Here's why:

1. **Rate limits.** A free-tier cloud project caps auth requests, database queries, and storage operations. You'll hit these limits hard during development — each time you reload a page, run a test, or rebuild. Locally, there are no limits.
2. **Offline work.** Your local stack runs without internet. You can build on a plane, in a café with bad WiFi, anywhere.
3. **Safe destruction.** Break a migration? Drop a table? Corrupt seed data? `supabase db reset` gives you a fresh database in ten seconds. If you did this in production, you'd be fired.
4. **Zero cost.** Local is free. Cloud has usage limits (and real monthly bills at scale).
5. **Parity.** Every teammate on Contactly runs the same local stack, from the same migration files. Nobody's database "drifts" because someone clicked around in the UI.

The professional workflow is: **develop locally → test locally → push migrations → deploy to staging → deploy to production.** The local environment is your sandbox.

---

## Installing the Supabase CLI

A **CLI** (Command Line Interface) is a program you run by typing commands in the terminal. The Supabase CLI lets you manage Supabase projects — starting, stopping, creating migrations, generating TypeScript types — from the terminal.

From your `contactly/` project root:

```bash
pnpm add -D supabase
```

**Reading that command:**
- `pnpm` — our package manager.
- `add` — add a new dependency.
- `-D` (short for `--save-dev`) — add it as a **dev** dependency. Dev dependencies are tools only needed during development and building, not when the live app runs in production. The CLI is a build tool; it's a dev dependency.
- `supabase` — the package name.

**Why install the CLI per-project instead of globally?** Installing globally (with `npm install -g supabase`) pins one version on your whole computer. Then one project needs a newer CLI, another needs an older one, and you have a conflict. Per-project installs let each project have its own version. Every teammate who clones Contactly automatically gets the exact same Supabase CLI version via the lockfile.

Verify it's installed:

```bash
pnpm supabase --version
```

Expected output: a version number like `1.x.x` or `2.x.x`. If you see "command not found", run `pnpm install` to re-run the installation.

---

## Initializing Supabase in the Project

```bash
pnpm supabase init
```

This creates a new folder in your project called `supabase/`:

```
supabase/
├── config.toml      ← configuration file for the local stack
└── migrations/      ← empty folder for future SQL migration files
```

**What `config.toml` is:** a text configuration file (TOML is a format similar to INI files). It declares which services to run, which ports they bind to, and settings like default email templates. Open it and scroll through — you'll see sections labelled `[db]`, `[auth]`, `[api]`, `[storage]`, and so on. The defaults are fine for now.

**Commit the `supabase/` folder to git.** It contains real code — migrations are SQL statements that define your database schema. Every teammate needs them.

```bash
git add supabase/
```

(If you haven't run `git init` inside the project yet, do that first: `git init` in the project root. Git setup is briefly covered in Module 0; the rest of the course assumes you have a repository.)

---

## Starting the Stack

With Docker Desktop running, execute:

```bash
pnpm supabase start
```

**First-run:** expect this to take five to ten minutes. Docker will download several container images — Postgres, auth server, storage server, realtime server, Studio, edge functions runtime, and more. Total size is roughly 1.5 GB.

**Subsequent runs:** take 10–30 seconds because Docker caches the images.

When the command completes, you'll see output like:

```
Started supabase local development setup.

         API URL: http://localhost:54321
     GraphQL URL: http://localhost:54321/graphql/v1
  S3 Storage URL: http://localhost:54321/storage/v1/s3
          DB URL: postgresql://postgres:postgres@localhost:54322/postgres
      Studio URL: http://localhost:54323
    Inbucket URL: http://localhost:54324
        anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ...
```

**Copy this entire output somewhere safe.** The anon key is a long string of random-looking characters — you need it for the next step.

### What Each URL Does

A **port** is a numbered channel on your computer for network traffic. Your browser talks to `localhost:5173` for your SvelteKit app; Supabase listens on different ports to avoid conflicts.

| URL | Purpose |
|---|---|
| **`localhost:54321`** | The unified API endpoint. Your app sends queries, auth requests, and storage calls here. Like a front door for all Supabase services. |
| `localhost:54321/graphql/v1` | A GraphQL alternative to the REST API. We don't use GraphQL in this course, but it's there if you want it. |
| `localhost:54321/storage/v1/s3` | An S3-compatible interface to the storage service — lets you use existing AWS S3 tools. |
| **`localhost:54322`** | Direct PostgreSQL access. Use this with database tools like `psql`, TablePlus, or DataGrip to connect directly. You rarely need this; queries usually go through the API. |
| **`localhost:54323`** | **Supabase Studio** — the visual admin panel. Open this in your browser to see tables, run SQL, manage users. |
| **`localhost:54324`** | **Inbucket** — a fake email inbox. Supabase sends all auth emails (signup confirmation, password reset) here locally so you can read them without setting up real email. A game-changer for development. |

### What Each Key Is

Both keys are **JWTs** — JSON Web Tokens, a format for signed payloads. They're long because they contain a header, a claim set, and a cryptographic signature, all base64-encoded.

| Key | What it can do |
|---|---|
| **`anon key`** | The public key. Safe to include in your browser JavaScript. When a logged-in user makes a request, the anon key tells the database "this request is authenticated" — but **Row Level Security (RLS) policies still apply**. Without RLS, the anon key would let anyone read everything; with RLS, it's safe. |
| **`service_role key`** | The admin key. Bypasses **all** RLS policies. Must live only on the server. **Never include it in browser code.** Anyone with this key has full control of your database. |

For local development, the anon and service_role keys are fixed values — every Supabase local install produces the same two keys. They're not secret. But production keys are absolutely secret; treat them accordingly.

---

## Add the Credentials to `.env`

Open `.env` in VSCode and paste the `anon key` from the output above:

```bash
# Supabase
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# App
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_APP_NAME=Contactly
```

We leave the `service_role` key out of `.env` for now. You'll add it in Module 3 when we need server-side admin access.

**Important:** if your SvelteKit dev server is already running from lesson 1.1, stop it (`Ctrl+C` in that terminal) and start it again with `pnpm dev`. SvelteKit reads `.env` at startup; changes don't hot-reload.

---

## Exploring Supabase Studio

Open `http://localhost:54323` in your browser.

Studio is a visual interface to the exact same database your API talks to. It's built by Supabase and shipped as part of the local stack. Everything Studio can do, you can also do via SQL — Studio just makes it faster to inspect and experiment.

Take two minutes and click around:

- **Table Editor** (left sidebar). You'll see a list of schemas. The `public` schema is empty (we haven't created any tables yet). The `auth` schema is hidden from this view by default — a deliberate safety measure, which we'll explain in lesson 1.3.
- **SQL Editor**. A blank page where you can type and run any SQL. Try:
  ```sql
  select now();
  ```
  You should see the current server time. This proves your database is reachable.
- **Authentication** → **Users**. An empty list. When Contactly users sign up (coming in Module 3), they'll appear here.
- **Storage**. Empty buckets list. You'll use this for avatar uploads in a later module.
- **Logs**. A unified view of database, auth, storage, and realtime logs. Priceless when debugging.

---

## Stopping and Resetting — Know Your Three Buttons

### 1. Stop the stack (preserves data)

```bash
pnpm supabase stop
```

This shuts down all the containers gracefully. Your database data survives — Docker volumes persist the data to disk. Restart with `pnpm supabase start` and everything is right where you left it.

Use this when you're done working for the day. It frees RAM and CPU.

### 2. Check status

```bash
pnpm supabase status
```

Shows which services are running right now, their URLs, and reprints the anon / service_role keys. Useful when you've forgotten the keys.

### 3. Full reset (wipes all data)

```bash
pnpm supabase db reset
```

This does something very specific: it **wipes the database** and **re-runs every migration file** in `supabase/migrations/` in order. You'll run this constantly during development — it's the "make the database exactly match my migration files" button.

For a nuclear option that also destroys Docker volumes:

```bash
pnpm supabase stop --no-backup
pnpm supabase start
```

Use this rarely — only when something has gone corrupt.

---

## Wiring the Commands Into `package.json`

Typing `pnpm supabase ...` over and over is tedious. Add these scripts to `package.json` so you can run shorter commands:

Open `package.json` and find the `scripts` block. Replace it (or merge) with:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "lint": "prettier --check . && eslint .",
    "format": "prettier --write .",
    "test:e2e": "playwright test",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:status": "supabase status",
    "db:types": "supabase gen types typescript --local > src/lib/types/database.types.ts"
  }
}
```

**How to read a `package.json` script:** the key is the name (`db:reset`) and the value is the command that runs when you execute `pnpm db:reset`. The `db:` prefix is just a convention — it groups related commands in alphabetical order.

Now the database workflow is:

```bash
pnpm db:start    # Start the local Supabase stack
pnpm db:reset    # Replay migrations from scratch
pnpm db:status   # Show URLs and keys
pnpm db:stop     # Stop at end of day
```

---

## Principal Engineer Notes

1. **Local-first development is a productivity multiplier.** The cost of setting it up (one afternoon) is paid back every hour you develop afterwards. Teams that do all development against staging environments pay compounding overhead every day.

2. **Environment parity matters but is not binary.** Your local Supabase stack is *nearly* identical to production — same Postgres version, same API layer, same auth flows. There are still small differences (e.g., production has real email delivery, rate limits, backups). Never assume "local works" means "production works." You still test in staging before shipping.

3. **Docker is the abstraction boundary.** Your host machine can be macOS, Linux, or Windows — Docker hides that difference. The containers are the same on every developer's laptop and on the CI server. If something works in CI but not locally (or vice versa), suspect `.env` or network differences first, Docker differences last.

4. **Never make schema changes through Studio in a real project.** Studio is for reading data and testing queries. Schema changes go through migration files — commits in git, reviewed in PRs, applied uniformly in every environment. Click-driven schema changes are invisible to your team, unreplayable, and a common cause of "works on my machine" bugs.

5. **The `anon key` / `service_role key` distinction is the center of Supabase's security model.** Learn the rule now: *the anon key goes to the browser; the service_role key stays on the server.* Forgetting this rule even once — in a console.log, a committed config file, or an error message — can compromise your entire database.

---

## Summary

- Installed and started Docker Desktop — the containerization runtime Supabase's local stack runs on.
- Added the Supabase CLI as a per-project dev dependency via `pnpm add -D supabase`.
- Ran `supabase init` to scaffold the `supabase/` folder and `config.toml`.
- Launched the full local Supabase stack with `supabase start`: Postgres, auth, storage, realtime, Studio, and Inbucket.
- Learned what each local port is for: API (54321), direct Postgres (54322), Studio (54323), fake email (54324).
- Understood the two keys: `anon key` (public, respects RLS) and `service_role key` (admin, bypasses RLS).
- Populated `.env` with local Supabase credentials.
- Explored Supabase Studio — Table Editor, SQL Editor, Authentication, Storage, Logs.
- Learned the three key commands: `db:start`, `db:stop`, `db:reset`.
- Added pnpm scripts so the whole team runs the exact same commands with short names.

## Next Lesson

In lesson 1.3 we stop typing and start thinking. You'll learn about Supabase's built-in `auth` schema — why it's off-limits to your code, how `auth.uid()` powers per-row security, and why we always create a separate `profiles` table to hold our app's user data. This is the foundation of secure-by-default database design.
