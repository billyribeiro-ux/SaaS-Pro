---
title: '5.7 - Cleanup'
module: 5
lesson: 7
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '07-cleanup'
description: 'Review and tidy your Stripe test environment before building the integration.'
duration: 5
preview: false
---

## Overview

Module 5 introduced a lot of moving parts — dashboard conventions, API versioning, the CLI, Products, Prices, lookup keys. You probably poked at a few things experimentally: triggered some events, created a test product, maybe made a throwaway Price while you were getting the hang of the UI. This last lesson is a five-minute hygiene pass to make sure Module 6 starts on a clean slate.

Specifically: we'll verify the Contactly catalog looks exactly right, archive any stray experimental objects, capture the API keys we've earned into `.env`, and confirm `.env.example` documents the full set for future developers. Short lesson, high return. A tidy environment saves hours of "wait, why is there a $1 test Price in the dashboard?" confusion later.

## Prerequisites

- All prior Module 5 lessons complete.
- `stripe login` still valid (test with `stripe whoami`).

## What You'll Build

- A clean Stripe test dashboard containing exactly one Product ("Contactly Pro") with exactly three active Prices (`contactly_monthly`, `contactly_yearly`, `contactly_lifetime`).
- A `.env` file containing all three Stripe variables populated with real test-mode values.
- A `.env.example` file documenting every Stripe variable so future teammates know what to set.

---

## Step 1: Tour the Test Dashboard

Log into Stripe. Confirm the orange **TEST DATA** banner — you should already have muscle memory for this. If it's not orange, flip to test mode before proceeding.

Walk through each section in order, checking for clutter:

### Products

Navigate to **Products** → **Product catalog**.

You should see exactly one row: **Contactly Pro**. If you see others — "Test Product," "My first thing," anything from earlier experimentation — archive them:

1. Click the product.
2. In the top-right, click the three-dot menu → **Archive product**.
3. Stripe asks for confirmation; confirm.

Archived products don't appear in the active list but persist in case you need to unarchive later. They also cascade: archiving a product archives all its prices.

Inside Contactly Pro, confirm three active prices with the expected lookup keys:

- `contactly_monthly` — $97.00/mo — Active
- `contactly_yearly` — $997.00/yr — Active
- `contactly_lifetime` — $4,997.00 one-time — Active

If any are missing, wrong, or show extra prices you don't recognize, fix now:

- **Missing a price:** add it (same flow as Lesson 5.5).
- **Wrong amount:** since `unit_amount` is immutable, create a new Price with `transfer_lookup_key: true` and archive the old one.
- **Extra prices:** archive them (three-dot menu → Archive).

### Customers

Navigate to **Customers**.

You may see test customers created by your `stripe trigger` runs during Lesson 5.3 (e.g., an auto-generated "Jenny Rosen" or similar placeholder). These are harmless but visually noisy.

You have two options:

- **Leave them.** They don't affect anything, and they'll come in handy for Module 6 testing. Recommended.
- **Bulk delete.** Top-right checkbox → select all → Delete. Only do this if you want a truly pristine start.

No wrong answer. If in doubt, leave them.

### Subscriptions

Navigate to **Subscriptions**. You may see test subscriptions that `stripe trigger` created. Same as customers: harmless, optional to delete.

### Developers → Events

Navigate to **Developers → Events**. You should see the events from your `stripe trigger` runs. These auto-expire after 30 days; you can't manually clear them. Ignore.

### Developers → Webhooks

Navigate to **Developers → Webhooks**. For Contactly we don't configure a permanent webhook endpoint yet — we use the Stripe CLI (`stripe listen`) during development. So this page should be **empty** (no configured endpoints) unless you experimented earlier.

If you see any endpoints listed, review them:

- If an endpoint points at a real public URL you intentionally set up: leave it.
- If it's experimental or obsolete: delete it (three-dot menu → Delete endpoint).

In Module 17 we'll create one permanent endpoint pointing at production. For now, empty is correct.

### Developers → API keys

Navigate to **Developers → API keys**. Confirm you see:

- **Publishable key** (`pk_test_...`) — visible by default.
- **Secret key** (`sk_test_...`) — hidden until you click "Reveal test key."

Both are standard. No action needed here beyond noting them — we're about to paste them into `.env`.

---

## Step 2: Capture the API Keys Into `.env`

Open your Contactly project in your editor. Find (or create) `.env` at the project root.

If you don't already have one, create the file:

```bash
touch .env
```

Your `.env` should end up looking like this (full stack — not just Stripe):

```
# Supabase
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=eyJ...     # from `supabase status`
SUPABASE_SERVICE_ROLE_KEY=eyJ...    # from `supabase status`

# Stripe (test mode)
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51Nv7k8KZ...
STRIPE_SECRET_KEY=sk_test_51Nv7k8KZ...
STRIPE_WEBHOOK_SECRET=whsec_abc123...  # from `stripe listen` output
```

### Fill in the three Stripe vars

For each Stripe variable:

1. **`PUBLIC_STRIPE_PUBLISHABLE_KEY`** — copy from dashboard → Developers → API keys → click the copy icon next to the publishable key. Paste into `.env`.
2. **`STRIPE_SECRET_KEY`** — same page, click **Reveal test key**, then the copy icon, paste into `.env`.
3. **`STRIPE_WEBHOOK_SECRET`** — from your running `stripe listen` terminal. Look for the line: `> Your webhook signing secret is whsec_xxxxx`. Copy the `whsec_...` value.

If your `stripe listen` isn't currently running, start it:

```bash
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

Copy the secret, paste into `.env`. Leave the process running.

### Naming conventions — why the `PUBLIC_` prefix matters

SvelteKit enforces an explicit boundary between client-visible and server-only environment variables:

- **`$env/static/public`** — any variable prefixed with `PUBLIC_`. Bundled into client code, visible to anyone viewing the site.
- **`$env/static/private`** — anything without the prefix. Server-only. Importing from client code fails at build time with a clear error.

So:

- `PUBLIC_STRIPE_PUBLISHABLE_KEY` — fine client-side (that's what publishable keys are designed for).
- `STRIPE_SECRET_KEY` — server only. If you accidentally try to `import { STRIPE_SECRET_KEY } from '$env/static/public'`, SvelteKit refuses to build and tells you why.
- `STRIPE_WEBHOOK_SECRET` — server only. Used to verify webhook signatures in the `/api/webhooks/stripe` route.

The prefix isn't cosmetic — it's a compile-time security boundary. Respect it.

---

## Step 3: Confirm `.env` Is Gitignored

Open `.gitignore` at the project root. It should already contain (SvelteKit's default):

```
.env
.env.*
!.env.example
!.env.test
```

If you don't see these lines, add them. The pattern:

- `.env` — ignore the main env file.
- `.env.*` — ignore environment-specific variants (`.env.local`, `.env.production`).
- `!.env.example` — **un-ignore** the example file. The `!` negates the previous pattern. Example files are committed so new contributors know what to set.
- `!.env.test` — similarly un-ignore test-fixture env files if you use them.

**Verify no secrets are tracked** by running:

```bash
git status
```

If `.env` shows up as an untracked or modified file in the output, it's being ignored correctly. If it shows as staged or tracked, something's wrong — investigate immediately. A secret-containing file in git is an incident.

If you already committed `.env` earlier by accident: remove it from tracking (`git rm --cached .env`), add it to `.gitignore`, commit the removal — and then **rotate all the secrets that were in it** because the old values are now in git history forever. (For `sk_test_` this is mostly cosmetic. For `sk_live_` it's a full-blown incident.)

---

## Step 4: Update `.env.example`

`.env.example` is a committed file that documents every variable your app expects, with empty or placeholder values. New developers (including future-you on a fresh clone) reference it to know what to put in their own `.env`.

Open (or create) `.env.example` at the project root:

```
# Supabase
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe (test mode)
# Get from: https://dashboard.stripe.com/test/apikeys
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...

# From: stripe listen --forward-to localhost:5173/api/webhooks/stripe
STRIPE_WEBHOOK_SECRET=whsec_...
```

Notes:

- **Leave values empty or use obvious placeholders** (`pk_test_...`). Do not put real values here — `.env.example` is committed.
- **Add comments** explaining where each value comes from. "Get from Stripe dashboard" is more helpful than silence.
- **Match every variable in `.env`.** If you add a new variable to `.env` later, update `.env.example` in the same commit. Drift between the two is a classic onboarding bug.
- The default `PUBLIC_SUPABASE_URL` is fine as-is because all local dev uses the same URL.

Commit `.env.example` to git. Leave `.env` uncommitted.

---

## Step 5: Verification Checklist

Before closing this module, walk through this checklist. Every item should be true.

- [ ] Stripe dashboard is in **test mode** (orange banner).
- [ ] **Products** shows exactly one active product: Contactly Pro.
- [ ] Contactly Pro has **three active prices** with lookup keys `contactly_monthly`, `contactly_yearly`, `contactly_lifetime`.
- [ ] The three prices are $97/mo, $997/yr, $4,997 one-time respectively.
- [ ] **Developers → Webhooks** has no permanent endpoints configured (we use the CLI for dev).
- [ ] `stripe listen --forward-to localhost:5173/api/webhooks/stripe` is running (or can be started on demand).
- [ ] `.env` contains `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` with real test-mode values.
- [ ] `.env.example` documents all three variables with placeholder values and helpful comments.
- [ ] `.env` is in `.gitignore`.
- [ ] `git status` does not show `.env` as a tracked file.

If every box is checked, Module 5 is complete. You have a Stripe account configured, a tidy catalog, the CLI ready, and your secrets in the right place.

---

## Common Mistakes

### Mistake 1: Committing `.env`

Classic. You work for an hour, run `git add .`, commit "first pass at Stripe setup," push. Three seconds later you realize your secret key is on GitHub.

**Damage control:**

1. **Immediately** rotate the secret key: Stripe dashboard → Developers → API keys → Roll key.
2. Remove `.env` from git: `git rm --cached .env`.
3. Add to `.gitignore` if not already.
4. Commit.
5. **Rewrite git history** if you pushed to a private repo and you're confident no one else pulled: `git filter-repo --path .env --invert-paths`. If it's a public repo or others have pulled, accept that the history is compromised; rotation is your main defense.
6. Scan for other secrets that might've been included — SUPABASE_SERVICE_ROLE_KEY, etc. Rotate those too if uncertain.

Avoid via `.gitignore` first.

### Mistake 2: Leaving `sk_test_` in `.env.example`

`.env.example` is committed. If you accidentally paste a real value into it, that value is now in your git history. For `sk_test_` this is not catastrophic (test mode isolated), but it teaches a bad habit.

Always use placeholders in `.env.example`. Use `_...` or actual angle-bracket hints like `<your-key-here>` to make the placeholder obvious.

### Mistake 3: Forgetting to update `.env.example` when adding new variables

You add a new `STRIPE_CUSTOMER_PORTAL_URL` to `.env` in a later module but forget to update `.env.example`. A teammate pulls, copies `.env.example` to `.env`, doesn't have the new variable, gets a confusing runtime error.

**Defense:** whenever you add to `.env`, add to `.env.example` in the same commit. Make it a habit. Some teams even enforce it with a pre-commit hook (compare keys between the two files; fail if mismatch).

### Mistake 4: Archiving instead of deleting when cleaning up

This is backwards from earlier advice, but: for **test-mode experimental clutter** that has no historical value (no real transactions, no customer associations), it's fine to **delete** rather than archive. Stripe allows delete on untouched objects. Test mode is disposable.

In **live mode** and for any object with transaction history, always archive. The distinction is hygienic: test mode is a sandbox, live mode is ledger.

### Mistake 5: Leaving `stripe listen` running in the wrong account

You switched Stripe accounts at some point (maybe you have a personal account and a client account). `stripe listen` kept running in the old account, silently forwarding events that no longer apply to your current project.

**Defense:** `stripe whoami` before important testing sessions. If the account is wrong, `stripe logout && stripe login` to re-pair.

### Mistake 6: Mixing `whsec_` values from different listener sessions

Two terminal windows ran `stripe listen` at different times, generating two different `whsec_` values. You copied the first into `.env`, but the current session uses the second. Every webhook fails signature check.

**Defense:** one listener at a time, and whenever you restart it, re-copy the secret into `.env`. Consider a small shell script that does both — `./scripts/stripe-dev.sh` starts the listener, captures the `whsec_`, writes it to `.env` via sed. Removes the manual step.

---

## Principal Engineer Notes

### Hygiene as a discipline, not a phase

Cleanup isn't something you do at the end of a project; it's something you do continuously. Every Friday, spend 15 minutes tidying: archive unused Prices, delete test customers, remove stale webhook endpoints, update documentation, prune log retention. Ten times a year this adds up to a couple of days of hygiene — saving days or weeks of "wait, what is this?" confusion.

Senior engineers build this into their week. Junior engineers learn it the hard way — by inheriting a codebase that nobody tidied for three years and spending their first month untangling it.

### Reviewable PRs start with clean environments

When you open a PR in Module 6 that says "wire up the /api/checkout route to Stripe," a reviewer should be able to pull the branch, paste values from `.env.example` into their own `.env`, and run the code without surprises. They shouldn't need to ask "what lookup keys does your Stripe account have?" or "did you include the webhook secret?"

A clean `.env.example` and a documented Stripe catalog are the difference between reviewable and unreviewable PRs. Invest in them now.

### Archive-don't-delete as audit-friendly default

For any data with real-world consequences (Prices used in transactions, Customers with payment history, Subscriptions that generated invoices), deletion destroys auditable history. Archiving preserves it. This isn't Stripe-specific — it's a general principle for financial and regulated systems.

Contactly isn't regulated (yet), but the habit generalizes. In your own Postgres tables, prefer `deleted_at timestamptz` (soft delete) over true `DELETE` for any row with downstream financial, legal, or compliance weight. Hard deletes should require more justification than soft deletes, not the other way around.

### Documenting the "why" alongside the "what"

Notice `.env.example` includes comments like `# Get from: https://dashboard.stripe.com/test/apikeys`. That's not decoration; it's pointing the reader at the source of truth. A new engineer reading the file doesn't have to guess "where does a Stripe webhook secret come from?" — the answer is right there.

Apply this everywhere. `package.json` scripts with comments. Migration file headers explaining the business rationale. Config entries with URLs to the relevant docs. Every pointer you leave is an hour your future teammates don't have to spend googling.

### The cost of a leaked key, reiterated

The single most expensive mistake you can make in this module is leaking `sk_live_`. We're in test mode for the whole course, so it's hard to do accidentally — but the habits you build now (gitignore, env-var hygiene, rotation discipline) transfer directly to live-mode work.

Practice like you play. Every time you handle `sk_test_` with care — not pasting it in Slack, not screenshotting it, not sharing it in chats — you're rehearsing the muscle memory you'll need when you handle `sk_live_`. Don't skip the reps.

---

## Summary

- Walked through every relevant Stripe dashboard section and archived/cleaned any experimental clutter.
- Verified Contactly Pro has exactly three active Prices with the expected lookup keys.
- Captured `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` into `.env` with real test-mode values.
- Documented all three variables in `.env.example` with placeholders and source pointers.
- Verified `.env` is gitignored and never tracked.
- Internalized hygiene as a continuous discipline, archive-don't-delete as the audit-friendly default, and the critical importance of secret hygiene even in test mode.

## What's Next

Module 5 complete. You've built zero lines of app code so far — and that was the point. Every Stripe integration that skips the conceptual grounding you just did spends three times as long debugging later. With the dashboard tidy, the catalog modeled, the lookup keys named, and the env wired up, you're ready for the meat of the billing integration.

**Module 6 — Stripe Checkout** starts next. You'll install `stripe@22` into the project, create a `src/lib/server/stripe.ts` factory that reads `STRIPE_SECRET_KEY` and pins `apiVersion: '2026-03-25.dahlia'`, build a `/api/checkout` SvelteKit route that looks up the selected Price by key and creates a Checkout Session, wire up the pricing page to redirect customers to Stripe's hosted checkout, and verify the success/cancel flow end to end. The conceptual work you just did maps one-to-one onto the code you're about to write — every decision there will feel like "ah, that's why 5.6 told me that."

Let's go.
