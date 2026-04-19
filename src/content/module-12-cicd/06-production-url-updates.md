---
title: '12.6 - Production URL Updates'
module: 12
lesson: 6
moduleSlug: 'module-12-cicd'
lessonSlug: '06-production-url-updates'
description: 'Update all URLs that reference localhost to point to your production domain.'
duration: 8
preview: false
---

## Overview

Last lesson of the module. Contactly is technically live — the code runs in production, the database is production, Stripe charges real money. But the plumbing has tiny leaks. A few URLs in the system still say "localhost:5173" or point at your first Vercel auto-URL instead of the real production domain. Those leaks show up as subtle failures: a password-reset email that links to localhost, a Stripe success redirect that 404s, an OAuth callback that bounces the user to a stale URL.

This lesson plugs the leaks. By the end, every URL in every system — Supabase Auth config, Stripe success/cancel URLs, email templates, environment variables — speaks the same production domain. The round trips just work.

The pattern we use is **canonical URL indirection through `PUBLIC_APP_URL`**. Every absolute URL in Contactly's code is built from this one env var. Change it in one place, and every downstream URL follows. No hunting through source for hardcoded strings.

## Prerequisites

- Lessons 12.1-12.5 completed.
- You know your final production domain. This might be:
  - The Vercel auto-URL (`https://contactly-xyz.vercel.app`) — fine for launch.
  - A custom domain (`https://contactly.app`) — better, and what we'll assume below.
- Access to the Supabase production project dashboard.
- Access to your Stripe live-mode dashboard.

## What You'll Update

- `PUBLIC_APP_URL` in Vercel's environment variables.
- Supabase Auth URL Configuration (Site URL + Redirect URLs).
- Stripe success/cancel URLs in your Checkout session creation code (already driven by `PUBLIC_APP_URL`, we'll verify).
- A full end-to-end verification: register → verify email → subscribe → cancel subscription → sign out.

---

## Step 1: The Canonical URL Pattern

Before touching anything, understand the pattern you're enforcing.

Contactly's code has exactly one absolute URL: `PUBLIC_APP_URL`. Everything else is a path built on top of it. Your Stripe success URL is `${PUBLIC_APP_URL}/billing/success`. Your password-reset email link is `${PUBLIC_APP_URL}/auth/reset-password?token=...`. Your Supabase OAuth redirect is `${PUBLIC_APP_URL}/auth/callback`.

This indirection matters because absolute URLs appear in **many** places:

- SvelteKit's `+page.server.ts` constructing Stripe Checkout URLs
- Email templates (password reset, verify account, billing receipts)
- Supabase Auth's redirect validation (prevents open-redirect attacks)
- Stripe webhook URLs (though we set that directly in lesson 12.5)
- OAuth callback URLs registered with providers (Google, GitHub)
- Open Graph / SEO meta tags for social previews

If each of those pulls from its own hardcoded string, updating your domain means a manual hunt through multiple files and three SaaS dashboards. You'll miss one. With the `PUBLIC_APP_URL` pattern, you update it **once in Vercel**, redeploy, and every URL-generating code path automatically picks up the new value.

Let's verify the pattern is followed consistently, then update the values.

---

## Step 2: Audit Your Code for Hardcoded URLs

Quick sanity check. Search your codebase for hardcoded URL strings:

```bash
# Find localhost references
grep -rn "localhost:5173" src/

# Find vercel.app hardcoded
grep -rn ".vercel.app" src/

# Find http:// explicitly (should be rare — mostly dev flags)
grep -rn "http://" src/

# Find direct https:// literals
grep -rn "https://" src/ | grep -v "node_modules"
```

Expected output: zero hardcoded app URLs in `src/`. Stripe URLs (`https://js.stripe.com/v3/`), Supabase docs (`https://supabase.com/...`), and similar are fine — those aren't your app's URLs. The thing you're hunting is `'http://localhost:5173/billing/success'` or `'https://contactly-xyz.vercel.app'` appearing as a literal.

If you find any, replace them with references to `PUBLIC_APP_URL`:

```typescript
// Before (bad)
success_url: 'http://localhost:5173/billing/success?session_id={CHECKOUT_SESSION_ID}',

// After (good)
import { PUBLIC_APP_URL } from '$env/static/public'

success_url: `${PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
```

Commit any cleanup to main before proceeding — you want production running the clean code when you update the env var.

---

## Step 3: Update `PUBLIC_APP_URL` in Vercel

Go to your Vercel project → **Settings** → **Environment Variables**. Find `PUBLIC_APP_URL`.

**Current value:** likely `https://contactly-xyz.vercel.app` from when we set it up in lesson 12.3, or still unset.

**New value:** your final production domain.

- If you're using the Vercel auto-URL for launch: leave it as `https://contactly-xyz.vercel.app` (no change needed).
- If you've set up a custom domain: `https://contactly.app` (or whatever you chose).

**Scope:** Production only.

**Preview scope:** you can also set a `PUBLIC_APP_URL` for Preview that points at… what, exactly? Preview URLs are per-deploy (`https://contactly-git-pr-42-yourname.vercel.app`), so a static value won't work.

Vercel provides `VERCEL_URL` automatically for preview deploys — the current deploy's URL. In preview environments, derive `PUBLIC_APP_URL` at runtime:

```typescript
// src/lib/server/app-url.ts
import { PUBLIC_APP_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';

export function getAppUrl(): string {
	// Vercel sets VERCEL_URL on preview deploys (and production, but we prefer
	// the explicit PUBLIC_APP_URL in production for stability).
	if (env.VERCEL_ENV === 'production') {
		return PUBLIC_APP_URL;
	}
	if (env.VERCEL_URL) {
		return `https://${env.VERCEL_URL}`;
	}
	return PUBLIC_APP_URL || 'http://localhost:5173';
}
```

This helper picks the right URL for each environment automatically. Replace any `PUBLIC_APP_URL` imports in server code with `getAppUrl()`. Client-side code keeps using `PUBLIC_APP_URL` directly (since it's always the production build's value).

Save the Vercel env var change. Trigger a redeploy (push a trivial commit, or click Redeploy on the latest deploy).

---

## Step 4: Update Supabase Auth URL Configuration

Supabase Auth has two URL-related settings you must keep in sync with your app URL.

Go to your Supabase production project → **Authentication** → **URL Configuration**.

### Site URL

Single value. The canonical origin Supabase uses for all redirects — confirmation emails, password resets, magic links, OAuth callbacks.

- Current (probably): `http://localhost:3000` or similar default.
- New: `https://contactly.app` (or your domain).

Save. This one value wires up every outbound email to link to your production domain.

### Redirect URLs (allowlist)

Below Site URL. A list of patterns. Supabase's auth flows refuse to redirect to any URL not in this list — this is an **open-redirect defense**. Without the allowlist, an attacker could construct a malicious link like `https://contactly.app/auth/callback?next=https://evil.com` and steal auth tokens.

Add these patterns (one per line):

```
https://contactly.app
https://contactly.app/**
https://*.vercel.app/**
http://localhost:5173
http://localhost:5173/**
```

Walk through each:

- **`https://contactly.app`** — exact match for the production domain origin.
- **`https://contactly.app/**`\*\* — any path under your production domain.
- **`https://\*.vercel.app/**`** — any Vercel preview URL. Without this, preview deploys can't complete auth flows because Supabase refuses to redirect to them. The `\*` wildcard covers any preview subdomain.
- **`http://localhost:5173`** and **`http://localhost:5173/**`** — allows local dev. Critical; otherwise `pnpm dev` breaks because Supabase refuses to redirect back to localhost.

You can also add specific staging domains if you have them. Aim to be **specific enough to be safe, inclusive enough to cover all real environments**.

### Email templates (optional)

Still in Authentication → **Email Templates**. Each template (Confirm signup, Magic link, Reset password, etc.) has HTML you can customize. The default uses `{{ .SiteURL }}` as a placeholder — which is now your production URL, so defaults work.

If you customized templates with hardcoded URLs, go back and replace them with `{{ .SiteURL }}` or `{{ .ConfirmationURL }}`. The placeholders get filled in per-email based on Site URL and Redirect URL config.

---

## Step 5: Verify Stripe Success/Cancel URLs

Your Stripe Checkout session creation code should be constructing success and cancel URLs from `PUBLIC_APP_URL`. Confirm by looking at wherever you create Checkout sessions (probably `src/routes/api/checkout/+server.ts` or a similar route):

```typescript
// src/routes/api/checkout/+server.ts
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';
import { getAppUrl } from '$lib/server/app-url';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia'
});

export async function POST({ request }) {
	const appUrl = getAppUrl();
	const session = await stripe.checkout.sessions.create({
		// ... other params
		success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${appUrl}/billing`
	});
	// ...
}
```

If your success/cancel URLs are hardcoded, fix them now. Stripe Checkout validates redirect URLs loosely (as long as they're HTTPS they work), so a hardcoded stale URL doesn't error — it just 404s the user after they pay, which is worse than erroring.

Commit, push, let the CI pipeline deploy. The new URLs are live the moment the deploy finishes.

---

## Step 6: End-to-End Verification

The final test. You've updated three systems. Do one complete user journey through production to verify every piece works.

### Flow 1: Sign-up → email verification

1. Visit `https://contactly.app` (your production domain).
2. Register with a fresh email (use `+test1@gmail.com` — Gmail treats `foo+anything@gmail.com` as `foo@gmail.com` for delivery).
3. Check your inbox. You should get a verification email with a link.
4. **Inspect the link.** It should point at `https://contactly.app/auth/confirm?...` — not localhost, not a stale Vercel URL. If it's wrong, Supabase Site URL is misconfigured.
5. Click the link. You land on `/auth/confirm`, get redirected to the dashboard, logged in.

### Flow 2: Subscribe → Stripe redirect

1. Logged in as the test user, navigate to billing, click Upgrade.
2. Stripe Checkout opens. Use a real card (you'll refund yourself).
3. Complete payment. Stripe redirects to your `success_url`.
4. **Inspect the success URL.** Should be `https://contactly.app/billing/success?session_id=cs_...`. If it's wrong, either `PUBLIC_APP_URL` is stale or your Checkout session code isn't using it.
5. You land on the success page, see a confirmation, the user's plan is upgraded.

### Flow 3: Password reset → email link

1. Sign out. Go to login page. Click "Forgot password."
2. Enter the test email. Submit.
3. Check inbox for password-reset email.
4. **Inspect the reset link.** Should be `https://contactly.app/auth/reset?token=...`. If it points anywhere else, fix Supabase Site URL.
5. Click, reset password, sign in with the new password.

If all three flows work end-to-end, every URL-related system is correctly configured for production. Refund yourself the Stripe charge. Delete the test user from Supabase (optional — or keep it as your production QA account).

Contactly is done. Real users can sign up and pay. You shipped.

---

## Common Mistakes

- **Forgot to redeploy after updating `PUBLIC_APP_URL`.** Env var changes only take effect on the next build. Vercel's running deploy keeps the old inlined value. Always redeploy after env var updates.
- **Missed an http:// vs https:// swap.** Production must be HTTPS (browsers refuse mixed content and many APIs demand it). `PUBLIC_APP_URL=http://contactly.app` would break Stripe, Supabase OAuth, and more. Always `https://` in production.
- **Trailing slash inconsistency.** `https://contactly.app` and `https://contactly.app/` are different strings. Stripe accepts either; some systems don't. Pick one (conventionally: no trailing slash) and be consistent.
- **Added the wildcard wrong in Supabase Auth.** `https://*.contactly.app` matches subdomains (`api.contactly.app`) — probably not what you want. `https://contactly.app/**` matches paths under the exact domain — usually what you want. Read the Supabase docs on wildcard syntax carefully.
- **Set `PUBLIC_APP_URL` for Production only but not Preview.** Preview deploys end up with an undefined `PUBLIC_APP_URL`, which SvelteKit renders as `undefined` in URLs (`https://undefined/billing/success`). Either set a Preview value or use the `getAppUrl()` pattern that falls back to `VERCEL_URL`.
- **Hardcoded `https://localhost` in a `.env.example`.** Future developers copy `.env.example` to `.env`, get a hardcoded URL that doesn't work for them. Use `http://localhost:5173` as the example default, documented as the dev convention.

---

## Principal Engineer Notes

### Environment parity

The central discipline behind this whole module: **production, staging, and development should differ only in the values of configuration, never in the shape of configuration**. Every env var that exists in prod should exist in dev; every code path that runs in dev should run in prod.

The `PUBLIC_APP_URL` pattern is one small piece of this. The broader discipline:

- Same OS (Linux in prod → use Linux/WSL in dev if possible, or at least match Node version).
- Same dependencies (no "dev-only" debug tools that make your dev flow differ from production).
- Same env var shape (dev `.env` has the same keys as prod, with different values).
- Same data model (test and prod Supabase are migrated from identical migration files).
- Same auth flow (don't have a "skip auth" toggle in dev — it masks bugs that only appear in prod).

The 12-Factor App manifesto (Heroku, ~2011) codified this. It's still the gold standard for cloud-native apps. Read it if you haven't.

### `PUBLIC_APP_URL` as senior-level indirection

The surface-level rule ("never hardcode URLs, use env vars") is taught early. The senior-level insight is **why** — and when to break it.

You use `PUBLIC_APP_URL` because:

1. The same code runs in three environments. Each needs a different URL.
2. Domains change. You might rebrand from Contactly to ContactPro in a year. Custom domains get added and removed. One env var change is cheaper than a codebase-wide find-and-replace.
3. The URL is a contract with external systems (Stripe, Supabase). Changing it requires updating them too; centralizing makes the dependency graph visible.

You **don't** use `PUBLIC_APP_URL` for:

1. Relative same-origin fetches. `fetch('/api/contacts')` is simpler and faster than `fetch(PUBLIC_APP_URL + '/api/contacts')`. Browsers resolve same-origin relative URLs correctly.
2. Static assets handled by the framework. SvelteKit's `$app/paths` provides `base` and `assets` for the asset path, which handles CDN prefixes correctly.
3. URLs that don't need to be external-facing (admin tools, internal webhooks).

The rule: centralize external-facing absolute URLs. Leave internal/same-origin URLs alone.

### Preview URL handling as a pattern

The `getAppUrl()` helper showed one pattern — sniff `VERCEL_ENV` and `VERCEL_URL` to construct the right URL dynamically. This pattern scales beyond Vercel:

- On Netlify: `DEPLOY_URL` and `URL` env vars.
- On Cloudflare Pages: `CF_PAGES_URL`.
- On a custom host: you construct it from the request itself (`X-Forwarded-Host` header in the load balancer).

The shape is always the same: production is a fixed configured value; non-production environments derive their URL from the host's env. Abstract it into one helper and every URL-generating code path uses the same resolution logic.

### Email deliverability and sender domains

Out of scope for this module, but worth flagging: Supabase sends auth emails from a default Supabase sender (`noreply@mail.supabase.io` or similar). These have poor deliverability — most land in spam, especially for recipients on corporate email.

For production, configure **custom SMTP** in Supabase → Settings → Auth. Connect a sender like Postmark, SendGrid, Resend, or AWS SES. Set up SPF, DKIM, and DMARC records for your sending domain. Deliverability improves dramatically — the difference between "spam folder" and "inbox" for your signup emails.

We skipped this to keep the module focused. Budget a half-day for email setup when you have your first real users.

### Monitoring and alerting post-launch

You've shipped. Now what?

Minimum viable monitoring for a new SaaS:

1. **Uptime monitoring.** Use [UptimeRobot](https://uptimerobot.com), [Better Uptime](https://betterstack.com/better-uptime), or similar. Pings `https://contactly.app` every minute. Alerts (email/SMS/Slack) if non-200 for 2+ minutes.
2. **Error tracking.** Sentry or Axiom. Captures JS errors, server errors, and stack traces. Free tier covers low-volume apps.
3. **Webhook monitoring.** Alert if Stripe webhook delivery fails more than 1% over an hour.
4. **Supabase dashboard check-ins.** Once a week, review database size, active users, slow query log.

Without monitoring, you rely on user reports to discover outages. That's fine for week 1; untenable by week 4.

### Post-launch hygiene

The module is done, but the work isn't. Post-launch checklist:

- **Terms of Service and Privacy Policy** live. Stripe and most payment providers require both.
- **Cookie consent banner** if your audience includes EU users. Even if you only use strictly-necessary cookies, GDPR requires disclosure.
- **Accessibility pass.** Run [axe DevTools](https://www.deque.com/axe/devtools/) against your production site. Fix high-priority issues before marketing.
- **Backups tested.** Trigger a backup restore in a throwaway Supabase project. Confirm data is recoverable.
- **Runbook.** Write down "what to do if:" scenarios — DB is down, Vercel is down, Stripe webhooks are failing. Future-you (at 3am) will thank present-you.

---

## What's Next

The module is complete. Contactly is a shipped SaaS. The pipeline runs itself. You sleep through deploys.

Module 13 onwards leaves the pipeline behind and focuses on what comes after launch: product polish, analytics, growth features, advanced Stripe operations, and the operational heartbeat of a real SaaS. But you've already crossed the hardest threshold — from "a project on my laptop" to "a product on the internet that charges money." Everything after this is iteration.

Push a change to main. Watch the pipeline run. See the deploy land. That feedback loop is the thing that separates shipped products from side projects. You now own it.
