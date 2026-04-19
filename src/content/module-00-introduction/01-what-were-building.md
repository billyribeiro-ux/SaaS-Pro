---
title: "What We're Building"
module: 0
lesson: 1
moduleSlug: "module-00-introduction"
lessonSlug: "01-what-were-building"
description: "A walkthrough of Contactly, the SaaS app you'll build across the course."
duration: 5
preview: true
---

# What We're Building: Contactly

Meet **Contactly** — the product we'll ship together. It is a multi-tenant
contact management SaaS aimed at freelancers and small-team operators who
need a personal CRM without the enterprise bloat.

`[live demo: link coming soon]`

Contactly is intentionally narrow in scope. It does one thing — manage
contacts — and does it well enough that a real person would pay for it.
Every feature we build earns its keep by either being core to that job, or
by being a piece of SaaS plumbing you'll need for any product you ship
next.

## The user story

A user lands on the marketing page, picks a plan, pays, lands in the app,
and starts adding contacts. If they exceed their plan's contact limit,
they hit a ceiling. If they cancel, they keep read-only access until the
period ends. If their card fails, they get a grace period and a nudge to
update payment details.

That's it. But getting every one of those interactions right is a
surprising amount of work.

## Features

Here is everything Contactly ships with:

### Authentication

- Email + password sign-up and sign-in, backed by Supabase Auth.
- Server-side session handling via `@supabase/ssr` — cookies, not
  localStorage — so SSR pages know who you are.
- Password reset flow over email.
- Sign out that clears the session on both the client and server.

### Contact management (CRUD)

- Create, read, update, and delete contacts.
- Each contact has: first name, last name, email, phone, company, notes.
- Search and filter on the list view.
- Pagination that works with server-rendered data.
- Row-level security so tenants never see each other's data — enforced at
  the database level, not just in application code.

### Subscription tiers

Three tiers, with deliberate price points:

- **Monthly** — **$97/month**, recurring.
- **Yearly** — **$997/year**, recurring.
- **Lifetime** — **$4,997**, one-time payment.

Each tier has a contact-count limit. The exact limits are set in code
(you'll wire them up in module 10), but the shape is: Monthly has the
lowest cap, Yearly has a higher cap, Lifetime is effectively uncapped.

### Stripe Checkout

- Hosted Stripe Checkout for all three plans.
- Returns the user to the app with a clean success/cancel URL.
- Webhooks on `checkout.session.completed` flip the user's subscription
  state server-side, idempotently.

### Stripe Customer Portal

- Users manage their own subscription: upgrade, downgrade, cancel, update
  card, view invoices.
- All tier transitions propagate back through webhooks. The app does not
  trust client state for billing decisions — ever.

### Access-control gates

- Premium-only routes are guarded by a server-side check that reads the
  user's current subscription from the database.
- Gated UI elements (e.g. a "bulk import" button) render a tier-appropriate
  upsell when the user doesn't qualify.
- Access rules live in a single, testable module. We write unit tests for
  them.

### Tier-enforced rate limits

- Contact-count limits are enforced on write. A user on the Monthly plan
  who tries to create their 501st contact gets a polite error, not a
  broken database row.
- The limit check runs server-side, inside the same transaction as the
  insert, so it can't be bypassed by a concurrent request.

## What the user sees

Roughly, the app has six pages:

1. **Marketing** (`/`) — public landing page with pricing.
2. **Sign up** (`/signup`) and **Sign in** (`/signin`).
3. **Contacts list** (`/app/contacts`) — the main workbench.
4. **Contact detail/edit** (`/app/contacts/[id]`).
5. **Billing** (`/app/billing`) — shows current plan, opens Customer
   Portal.
6. **Account** (`/app/account`) — change password, sign out.

Every page is server-rendered. There is no SPA shell. Navigations feel
fast because SvelteKit's client-side router takes over after the first
load, but the initial render is always HTML.

## What's NOT in scope

Scope discipline is the difference between a shipped product and a
half-finished prototype. Here's what we are **not** building, by design:

- **Teams / multi-seat accounts.** Every user is a single-tenant. Adding
  teams would balloon the auth and billing models. That's a v2 feature.
- **SSO (Google, GitHub, SAML).** Email/password only. Social auth is a
  one-evening add-on once you understand the Supabase flow; we'll gesture
  at it in the final module.
- **An admin panel.** We'll query the database directly via Supabase
  Studio when we need to. Building a proper admin UI doubles the surface
  area of the app.
- **Real email deliverability infrastructure.** We use Supabase's built-in
  email for auth flows. Swapping in Resend or Postmark is mechanical
  once you have the rest working.
- **Webhooks for end users.** Contactly itself doesn't expose webhooks
  outward. We consume Stripe's webhooks; we don't publish our own.
- **Mobile apps.** The responsive web app is the only client.

Everything on the "not in scope" list is the kind of feature that makes a
demo impressive but a course unfinishable. Resist the temptation to add
them until you've shipped v1.

## Your deliverable

By module 14, you will have a deployed Contactly instance running on your
own Vercel project, with your own Stripe test account wired up, your own
Supabase project serving the database, and a GitHub repo that runs tests
on every pull request. It will be yours. You can point a domain at it,
switch Stripe to live mode, and take payments from real customers on the
same afternoon.

That is the finish line. Let's get you there.
