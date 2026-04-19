---
title: "2.1 - Server-Side Environment"
module: 2
lesson: 1
moduleSlug: "module-02-supabase-integration"
lessonSlug: "01-server-side-environment"
description: "Configure environment variables correctly in SvelteKit — understanding the difference between public and private env vars."
duration: 8
preview: false
---

## Overview

This lesson teaches one of the most security-relevant skills in full-stack SvelteKit: how to manage environment variables correctly. The wrong approach — and it's the default in most Node tutorials — leaks secrets to the browser. The correct SvelteKit approach is safer *and* easier. You just need to understand why.

By the end of this lesson you'll know exactly which variables belong on the server only, which are safe in the browser, and how SvelteKit's build system enforces the difference for you.

## Prerequisites

- Module 1 complete — Contactly has Supabase running locally and a `.env` file with some values.

## What You'll Build

- A final `.env` file with all environment variables Contactly needs for the rest of the course (public + server-only).
- A matching `.env.example` checked into git as a template.
- A clear mental model of `$env/static/public`, `$env/static/private`, `$env/dynamic/public`, and `$env/dynamic/private` — when to use each and why.

---

## The Two-Minute Background: What Is an Environment Variable, Really?

Every running program has an **environment** — a dictionary of string key/value pairs inherited from the process that started it. When you open a terminal and type `echo $PATH`, you're reading an environment variable. When Node.js reads `process.env.PORT`, same thing.

The environment is a sensible place to hold configuration because:
- It's not in source code (so it's not committed to git).
- It can differ per machine and per deploy (your laptop's DB URL differs from production's).
- The operating system already has mechanisms to set it.

`.env` files are a developer convenience: a tool (like Vite, or `dotenv`) reads the `.env` file at startup and loads its contents into the process environment, as if you'd typed `export KEY=value` in your terminal beforehand. Your code then reads from `process.env`.

## The Problem With Naive `process.env` Access

Here's a subtle problem you may not have thought about. A SvelteKit app has two very different pieces of code running in very different places:

- **Server code** — runs on a Node.js server (or a Vercel serverless function). Can read secrets, talk to databases, hold API keys.
- **Browser code** — runs on the user's computer, in their browser. Anyone can inspect it, read it, copy it. **Nothing in browser code is secret.**

If you write `const key = process.env.STRIPE_SECRET_KEY` in a file that ends up getting bundled into browser code, your Stripe secret key is now visible to every visitor of your site. Open DevTools → Sources → search → done. **Your secret is stolen.**

The traditional Node ecosystem doesn't protect you from this. It's your job as the developer to know which files are "server" and which are "client" and to never cross the streams. In practice, developers make this mistake all the time — sometimes catastrophically.

**SvelteKit solves this at the framework level.**

---

## SvelteKit's Four `$env` Modules

SvelteKit exposes environment variables through four virtual import paths. Each one behaves differently. Understanding the differences is the core skill of this lesson.

| Module | Values available | Accessible from |
|---|---|---|
| `$env/static/public` | All `PUBLIC_*` vars | Anywhere — server and client |
| `$env/static/private` | All non-prefixed vars | Server code only (build fails if used in client) |
| `$env/dynamic/public` | All `PUBLIC_*` vars | Anywhere |
| `$env/dynamic/private` | All non-prefixed vars | Server code only |

Two axes: **static vs dynamic** and **public vs private**.

### Public vs Private

This is the security axis.

- **Public** — variables prefixed with `PUBLIC_`. SvelteKit considers these safe to expose to the browser. Think: Supabase's public URL, the app name, a public Stripe key, analytics IDs.
- **Private** — variables **without** the `PUBLIC_` prefix. SvelteKit considers these secrets. Think: Stripe secret key, Supabase service role key, database passwords, API tokens.

**SvelteKit enforces the rule at build time.** If any file that gets bundled into the browser imports from `$env/static/private` or `$env/dynamic/private`, the build fails with an error pointing to the file. You literally cannot ship secrets to the browser by accident. That's huge.

### Static vs Dynamic

This is the performance and flexibility axis.

- **Static** (`$env/static/*`) — Values are **baked into the build at build time**. When you run `pnpm build`, the SvelteKit compiler literally replaces `PUBLIC_SUPABASE_URL` with the literal string `"http://localhost:54321"` in the output bundle. Fast, no runtime lookup, and allows dead-code elimination (if a conditional evaluates to false based on the env value, the branch is dropped from the bundle).
- **Dynamic** (`$env/dynamic/*`) — Values are read from the process environment **at runtime**, each time they're accessed. Slower, but you can change them without rebuilding — useful for the same compiled artifact running across dev/staging/production with different values.

For Contactly we use **static** everywhere. Our values don't change after build, and we benefit from the build-time optimizations. We'll explicitly note any exception.

### Putting it together — four use cases

- **`$env/static/public`** → public values known at build time. Your Supabase URL, your app name.
- **`$env/static/private`** → secret values known at build time. Your Supabase service role key, your Stripe secret key.
- **`$env/dynamic/public`** → public values that vary per deploy of the same build artifact. Rare.
- **`$env/dynamic/private`** → secret values that vary per deploy of the same build artifact. Occasionally useful (e.g., one Docker image → many tenants).

For Contactly: `$env/static/public` and `$env/static/private` are all you need.

---

## What `process.env` and `import.meta.env` Do in SvelteKit (And Why You Don't Use Them)

- **`process.env`** — Works in SvelteKit server code (because Node.js provides it), but bypasses the `PUBLIC_` prefix rule and the build-time safety net. If you write it in a file that ends up in the browser bundle, you'll get a runtime error or leak.
- **`import.meta.env`** — Vite's own environment abstraction. Works, but also sidesteps SvelteKit's rules. Uses a different prefix convention (`VITE_`) that conflicts with SvelteKit's (`PUBLIC_`).

**Rule: always use SvelteKit's `$env` modules. Never use `process.env` or `import.meta.env` directly in a SvelteKit project.** The `$env` modules are the correct, safe, checked way.

---

## Contactly's Full `.env` File

Open `.env` and set its final contents:

```bash
# -----------------------------------------------------------------------------
# Supabase — public (safe to expose to browser)
# -----------------------------------------------------------------------------
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# -----------------------------------------------------------------------------
# Supabase — server-only (NEVER expose to browser)
# -----------------------------------------------------------------------------
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# -----------------------------------------------------------------------------
# App — public
# -----------------------------------------------------------------------------
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_APP_NAME=Contactly
```

Fill in the real values from `pnpm db:status` output. The service role key is the second long JWT labelled `service_role key:`.

### And the matching `.env.example`

```bash
# Supabase (from `pnpm db:status`)
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_APP_NAME=Contactly
```

Note the missing values after the `=` signs. `.env.example` lists the **shape** of the environment, not the values. A new team member clones Contactly, copies `.env.example` to `.env`, fills in their own values, and starts developing.

### Verify your `.gitignore`

One more time, because this is where people accidentally commit secrets:

```
.env
.env.*
!.env.example
```

Run `git status`. `.env` should **not** appear. `.env.example` should appear (as tracked or untracked, depending on whether you've committed it before).

---

## How to Import Env Vars in Code

You won't write the imports until the next lessons, but here's the reference you'll keep coming back to:

```typescript
// ✅ Server-side secret — only in hooks.server.ts, +page.server.ts, src/lib/server/*, API routes
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'

// ✅ Public value — anywhere (server OR browser)
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

// ❌ Don't do this — works but bypasses the safety net
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

// ❌ Don't do this either — wrong abstraction layer
const url = import.meta.env.VITE_SUPABASE_URL
```

### Where is "server code" in SvelteKit?

Exactly these places. Memorize the list:

1. `src/hooks.server.ts`
2. `src/lib/server/**/*` — by convention and enforced by SvelteKit
3. `*.server.ts` files (including `+page.server.ts`, `+layout.server.ts`)
4. `+server.ts` — API routes (GET/POST/etc.)
5. Files only imported from the above

Everything else — `+page.svelte`, `.svelte` components, `+page.ts`, `+layout.ts`, anything in `src/lib` that isn't under `src/lib/server` — may end up in the browser bundle. Treat it as untrusted territory for secrets.

If you import from `$env/static/private` anywhere outside that server list, `pnpm build` fails with an error like:

```
Cannot import $env/static/private into public-facing code
```

That's the safety net working. Don't try to silence the error — move the import into server code.

---

## SvelteKit Validates Env Vars at Build Time

One more killer feature. If your code imports `PUBLIC_SUPABASE_URL` from `$env/static/public` but your `.env` file doesn't define it, `pnpm build` will fail with a clear error:

```
"PUBLIC_SUPABASE_URL" is not exported by "$env/static/public"
```

No missed-config deploy that silently crashes in production. The build catches it.

This is the same check you'd have to write manually in plain Node — "before starting, verify every required env var is set". SvelteKit does it for you, at the right moment, for every `import`.

---

## Why Not Commit Real Values to `.env.example`?

A tempting shortcut: put the local Supabase anon key in `.env.example` since it's the same for everyone and "not really secret." Don't do this.

1. **Muscle memory matters.** The rule "`.env.example` holds no real values" is simple and universal. Creating exceptions — "but this one value is fine" — erodes the discipline.
2. **Values drift.** Someone runs a newer Supabase CLI that generates different keys, updates `.env` but forgets `.env.example`, confusion ensues.
3. **Future you may swap environments.** Copying the same file to a cloud project, your "harmless" local value is now actively wrong.

Keep `.env.example` as pure shape; every real value lives in `.env` locally or in your deployment platform's secret store (Vercel dashboard, for example).

---

## Principal Engineer Notes

1. **Secret management is a boundary discipline.** The boundary is: code that runs on your server can read secrets; code that runs elsewhere cannot. Every architecture decision in this space should preserve that boundary with zero ambiguity. `$env/static/private` is the clearest line SvelteKit can draw.

2. **Build-time checks are the best checks.** A runtime error means you ship something broken and find out in production. A build error means you can't ship. Always prefer the former to the latter when the information is available at build time — SvelteKit's env system is a textbook example.

3. **`.env` is local-dev convenience. Production secrets go in a secret manager.** In Module 13 we deploy to Vercel, and you'll set these same variables via the Vercel dashboard (which encrypts them and scopes them per environment). Do not `scp` a `.env` to a server. Do not commit a `.env.production`. Secret managers exist for a reason.

4. **Naming is part of security.** SvelteKit's `PUBLIC_` prefix is a perfect example: the rule is in the *name*, so you can see it at the call site. Apply the same thinking to your own code — a boolean flag called `isTrusted` is better than a comment saying "remember this means trusted."

5. **Secret rotation is mandatory, eventually.** Every secret in production should be rotatable without downtime. Our architecture supports this because the app reads env values at startup; a deploy with new values and a graceful restart cycles the secret. When you build Contactly for real customers, add `docs/SECRETS.md` listing each secret, its rotation procedure, and its last-rotated date. This is not optional at scale.

---

## Summary

- SvelteKit exposes environment variables through **four virtual modules**: `$env/static/public`, `$env/static/private`, `$env/dynamic/public`, `$env/dynamic/private`.
- The **`PUBLIC_` prefix** is the security marker. Public values go to the browser; private values stay on the server.
- SvelteKit **enforces the public/private split at build time**. Importing `$env/static/private` from client code fails `pnpm build`.
- **Static** values are inlined at build time (fast, optimization-friendly). **Dynamic** values are read at runtime.
- **Never use `process.env` or `import.meta.env` directly** in a SvelteKit project. Use the `$env` modules.
- **Server code is a specific set of files**: `hooks.server.ts`, `src/lib/server/**`, `*.server.ts`, `+server.ts`.
- `.env` is gitignored and holds real values. `.env.example` is committed and holds only shape.
- Contactly's final env: Supabase URL + anon key (public), service role key (private), app URL + name (public).

## Next Lesson

Now that your env vars are correctly split, we install the Supabase JavaScript SDKs (`@supabase/supabase-js` and `@supabase/ssr`) and regenerate typed definitions from the database schema. After lesson 2.2, your code will be able to talk to Supabase with full TypeScript safety.
