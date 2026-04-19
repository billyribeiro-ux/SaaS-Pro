---
title: '6.3.1 - Webhook Script'
module: 6
lesson: 3
moduleSlug: 'module-06-stripe-sveltekit'
lessonSlug: '03-1-webhook-script'
description: 'Add a pnpm script so you never have to remember the full stripe listen command.'
duration: 8
preview: false
---

## Overview

This is a short lesson — under 10 minutes — about a small quality-of-life improvement that will pay dividends every single day you work on Contactly. We're going to wrap the Stripe CLI's `stripe listen` command in a `pnpm stripe:listen` script. That's it. One `package.json` change.

Why bother? Because the full command is long, easy to get wrong, and nobody remembers it. By the time you've copy-pasted it from the Stripe docs for the fifth time, you'll have spent more time than writing the script in the first place. And every teammate you onboard to Contactly will thank you for "oh, just run `pnpm stripe:listen`" instead of "let me look up the right `--events` flag…"

The broader lesson is about **scripts as documentation**. Your `package.json` scripts block is the single best place to encode tribal knowledge about "how to run this codebase." We'll talk about it below.

## Prerequisites

- Lessons 6.1, 6.2, 6.3 complete — you have a webhook endpoint at `/api/webhooks/stripe`.
- The Stripe CLI installed. On macOS: `brew install stripe/stripe-cli/stripe`. On Linux/Windows: see [Stripe's CLI install guide](https://stripe.com/docs/stripe-cli#install).
- Logged in to the Stripe CLI: `stripe login` (opens browser, authenticates CLI with your Stripe account).

## What You'll Build

- Add `stripe:listen` to `package.json`'s `scripts`.
- Understand the three-terminal daily workflow: `pnpm dev`, `pnpm supabase start`, `pnpm stripe:listen`.
- Copy the `whsec_...` secret from `stripe listen` output into `.env` as `STRIPE_WEBHOOK_SECRET`.

---

## Step 1: What `stripe listen` Does

When you run `stripe listen --forward-to <url>`, the Stripe CLI:

1. Opens a persistent connection to Stripe's servers.
2. Subscribes to events on your Stripe account (test mode).
3. Every time an event fires, forwards it as an HTTP POST to the `--forward-to` URL.
4. Signs each forwarded request with a **local webhook secret** it generates when the CLI starts up. This is a different secret from production — unique to your local dev session.

This is how you get real Stripe events hitting `localhost:5173` during development. Without `stripe listen`, your local server would never receive events; they'd go to your production endpoint (which doesn't exist yet) or get dropped.

The CLI is, in effect, a **local reverse tunnel** specifically for Stripe events. It's the development-time analog of pointing your production webhook endpoint at `https://contactly.com/api/webhooks/stripe` in the Stripe dashboard.

---

## Step 2: The Full Command (Before We Script It)

Here's the command we'd type every time without a script:

```bash
stripe listen \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed \
  --forward-to localhost:5173/api/webhooks/stripe
```

Let's decode it:

- **`stripe listen`** — the CLI subcommand that starts the forwarding session.
- **`--events ...`** — comma-separated list of event types to subscribe to. This exactly matches the six events we decided on in lesson 6.2. Without this flag, `stripe listen` forwards **every** event on your account — hundreds of types. Noise. Always filter.
- **`--forward-to localhost:5173/api/webhooks/stripe`** — where to POST each event. The port (`5173`) is Vite's default dev server port; if you've changed it, match. The path (`/api/webhooks/stripe`) matches our route file.

Type this once. Copy-paste it the next time you need it. Mistype it on the third try ("was it `customer.subscription.cancelled` or `.deleted`?"). Realize a script would be better.

---

## Step 3: Add the Script

Open `package.json`. Find the `scripts` block. It probably looks like:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest",
    ...
  }
}
```

Add a new entry:

```json
"stripe:listen": "stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed --forward-to localhost:5173/api/webhooks/stripe"
```

Full block after the addition:

```json
{
	"scripts": {
		"dev": "vite dev",
		"build": "vite build",
		"preview": "vite preview",
		"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
		"test": "vitest",
		"stripe:listen": "stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed --forward-to localhost:5173/api/webhooks/stripe"
	}
}
```

A few formatting notes:

- **Single-line JSON script.** JSON doesn't support multi-line strings. The command goes on one line, no matter how long.
- **Colon in the name (`stripe:listen`).** pnpm/npm scripts support colons as a convention for grouping — related scripts share a prefix (`stripe:listen`, `stripe:trigger`, etc.). Purely cosmetic, but good for readability.
- **No `npx`, no `pnpm dlx`.** The Stripe CLI is a system binary installed via Homebrew; we call it directly. If it were a Node package, we'd do `pnpm exec stripe ...` to use the project-local install.

Save. You're done. Run it:

```bash
pnpm stripe:listen
```

Output looks like:

```
> stripe listen --events checkout.session.completed,... --forward-to localhost:5173/api/webhooks/stripe

> Ready! You are using Stripe API Version [2026-03-25.dahlia]. Your webhook signing secret is whsec_1A2B3C4D5E6F... (^C to quit)
```

That `whsec_...` is what we need next.

---

## Step 4: Copy the Secret Into `.env`

The `whsec_...` shown in the output is **your local webhook signing secret for this session**. Every event the CLI forwards is signed with it. Our webhook endpoint (`+server.ts` from lesson 6.3) verifies every incoming event against `STRIPE_WEBHOOK_SECRET`.

Update `.env`:

```bash
# .env
STRIPE_SECRET_KEY=sk_test_51ABC...
STRIPE_WEBHOOK_SECRET=whsec_1A2B3C4D5E6F...  # ← paste the value from stripe listen
```

Important details:

- **This secret changes every time `stripe listen` restarts.** The CLI generates a new one on each invocation. So every time you restart the listen session, you have to update `.env` and restart your dev server for it to pick up the new value.
- **This is not your production webhook secret.** Production uses a different `whsec_...` — the one you'll configure in the Stripe dashboard when you deploy. They're unrelated keys for unrelated environments.
- **Restart the dev server after changing `.env`.** SvelteKit's `$env/static/private` reads values at build time; Vite hot-reloads many things, but env variable changes require a full restart. `Ctrl+C` on `pnpm dev`, then `pnpm dev` again.

Optional: pass `--api-key` to `stripe listen` to pin it to a specific Stripe account if you have multiple. Not needed if you only have one test account.

---

## Step 5: Your New Daily Workflow — Three Terminals

During Module 6 and beyond, your local dev environment requires three processes running in parallel. Open three terminals (or three tmux panes, or three VS Code integrated-terminal tabs — whatever you like).

### Terminal 1: Your app

```bash
pnpm dev
```

Starts Vite on `localhost:5173`. Your app is running.

### Terminal 2: Your database

```bash
pnpm supabase start
```

Boots a local Docker-based Postgres + Supabase stack. Studio at `localhost:54323`. API at `localhost:54321`.

Already running from Module 1? Great, leave it running. Supabase's local stack persists between sessions until you `supabase stop` it.

### Terminal 3: Stripe webhook forwarding

```bash
pnpm stripe:listen
```

Starts the Stripe CLI forwarding tunnel. Any test-mode event on your Stripe account (manual trigger, checkout test, API call) is now forwarded to your running `pnpm dev`.

### Test it end-to-end

With all three terminals running, in a fourth terminal (or just your shell), trigger a test event:

```bash
stripe trigger checkout.session.completed
```

In terminal 3, you'll see:

```
2026-04-18 14:22:07   --> checkout.session.completed [evt_1A...]
2026-04-18 14:22:07  <--  [200] POST http://localhost:5173/api/webhooks/stripe
```

In terminal 1 (`pnpm dev`), your `console.log('Checkout completed:', session.id)` fires. You just received and processed a real Stripe event locally.

That's the whole loop. From now on, every feature you build that involves Stripe — checkout sessions, subscription changes, failed payments — flows through this three-terminal setup.

---

## Common Mistakes

### Mistake 1: Forgetting to update `STRIPE_WEBHOOK_SECRET` after restarting `stripe listen`

The CLI prints a **new** secret every session. If you started listen at 9am, left for lunch, restarted listen at 1pm, the new secret is different from the one in `.env`. All events will fail signature verification until you update.

Rule: **any time `stripe listen` starts, copy its printed `whsec_...` into `.env` and restart `pnpm dev`.**

### Mistake 2: Not restarting `pnpm dev` after changing `.env`

SvelteKit inlines `$env/static/private` values at build time. Changing `.env` while `pnpm dev` is running has no effect on already-evaluated modules. Ctrl+C, restart.

If you see "Invalid signature" errors in your webhook logs despite having the right secret, this is the cause 9 times out of 10.

### Mistake 3: Running `stripe listen` without `--events`

Omit `--events` and the CLI subscribes to **every** event on your account. Your terminal floods with events for things you don't handle. Every one of them makes a request to your endpoint, which logs "Unhandled event type: ..." and returns 200. Noisy, slow, annoying.

Always filter with `--events`. The script does this for you.

### Mistake 4: Using the production webhook secret locally

If you've already set up a production webhook in the Stripe dashboard, you have a `whsec_...` for it. Do **not** use that one in local `.env`. It won't verify — locally, Stripe signs events with the per-session secret from `stripe listen`, not the dashboard-provided one. Use the session-local secret.

In production, reverse: use the dashboard-provided secret there, not your local session secret.

### Mistake 5: Port mismatch

If you've changed Vite's port (e.g., running on `5174` because `5173` is taken), update the script:

```json
"stripe:listen": "stripe listen --events ... --forward-to localhost:5174/api/webhooks/stripe"
```

Or pass it via env var. For simplicity, keep the default port when you can.

### Mistake 6: Expecting `stripe:listen` to work in CI

CI environments don't have your Stripe login and shouldn't. Use `stripe trigger` with a pre-configured mock endpoint, or — better — write unit tests for the webhook handler that bypass the live CLI entirely. We'll do that in a later module.

---

## Principal Engineer Notes

### 1. Scripts as documentation

Your `package.json` scripts are the canonical "how to run this codebase" reference. A new engineer joins, clones the repo, opens `package.json`, and sees:

```json
{
	"scripts": {
		"dev": "...",
		"build": "...",
		"check": "...",
		"test": "...",
		"stripe:listen": "..."
	}
}
```

In 30 seconds they know the main entry points. That's documentation — zero-maintenance, always up to date (because if the script breaks, the onboarding engineer breaks with it, and they fix it).

Resist putting ops knowledge in README files and wikis. Those go stale within weeks. Scripts, because they're executed, stay fresh.

### 2. Scripts vs. Makefiles vs. shell aliases

Each has a niche. Rough rule of thumb:

- **`package.json` scripts** — the right default for Node/pnpm projects. Cross-platform (Windows users can run them too, via Git Bash or pnpm's shell handling). Obvious to anyone familiar with the JS ecosystem.
- **Makefiles** — preferred for polyglot projects (e.g., a repo with Go + TypeScript + Python where you want unified `make test`). More powerful — supports dependencies between targets, file-timestamp-based incremental runs. But harder for Node-only engineers to discover.
- **Shell aliases** — personal productivity, not shared. Never put a critical ops step behind an alias; it's invisible to your teammates.

For Contactly, `package.json` scripts are perfect. If the project grows to include native bindings or Rust services, revisit.

### 3. The developer experience flywheel

One-command workflows compound. Today `pnpm stripe:listen` saves 20 seconds per invocation. Call it 10 times a day × 365 days = **20 hours per year, per engineer, saved on Stripe webhook alone**. Multiply by the dozens of other scripts you'll add (database reset, seed data, type generation, linting, formatting…) and the total is substantial.

Even more important: **less friction means more experimentation**. When running a thing costs 20 seconds of typing and mental context-switching, you avoid running it. When it costs a 3-character alias, you run it constantly. That's the gap between "I should probably test this" and "I'll just test this, takes two seconds."

Build the flywheel. Early. For every repeated dev-loop action. Your future self and every teammate thanks you.

### 4. Name scripts after intent, not implementation

`stripe:listen` is good. `dev:webhooks` would also be good. `stripe_forwarding_with_filtered_event_types` is bad.

Script names are read more often than the commands inside them. Optimize for the reader. A script name should answer "what do I use this for?" — not "what does it run underneath?"

### 5. Commit your scripts to source control, always

`package.json` is version-controlled. So are the scripts inside. When you add `stripe:listen`, it's immediately available to every teammate on their next `git pull`. No separate setup step, no "here's my local alias, copy this to your `.zshrc`" Slack message.

This is another reason to put ops knowledge in `package.json` rather than local shell files. The team's collective knowledge lives in one shared, versioned location.

### 6. Keep `.env.example` in sync

If you added `STRIPE_WEBHOOK_SECRET` to `.env` (for local use), you should also add **a commented placeholder** to `.env.example` (for onboarding):

```bash
# .env.example
STRIPE_SECRET_KEY=sk_test_...        # from https://dashboard.stripe.com/test/apikeys
STRIPE_WEBHOOK_SECRET=whsec_...      # printed by `pnpm stripe:listen`
```

A new engineer clones the repo, copies `.env.example` to `.env`, fills in the real values, and is running the full stack in minutes. `.env.example` is — you guessed it — scripts-as-documentation for the environment layer.

---

## Summary

- Added `pnpm stripe:listen` to `package.json` so the full Stripe CLI command lives in one place.
- Learned the three-terminal daily workflow: `pnpm dev` (app), `pnpm supabase start` (database), `pnpm stripe:listen` (Stripe events).
- Copied the session-local `whsec_...` from `stripe listen` output into `.env` as `STRIPE_WEBHOOK_SECRET`.
- Tested the pipeline with `stripe trigger checkout.session.completed` and saw the event land in our webhook handler.
- Saw why `package.json` scripts are a team's most valuable documentation surface.

## What's Next

Lesson 6.4 closes out Module 6 with the architectural decision that ties everything together: **what Stripe data do we actually store in Supabase, and why?** We'll sketch the four core tables — `products`, `prices`, `customers`, `subscriptions` — and the sync contract that keeps them fresh from webhooks. Module 7 then picks up where 6.4 leaves off and writes the migrations, types, and service functions.
