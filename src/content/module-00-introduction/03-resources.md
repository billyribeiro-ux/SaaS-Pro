---
title: "Resources"
module: 0
lesson: 3
moduleSlug: "module-00-introduction"
lessonSlug: "03-resources"
description: "Every tool, doc, and external resource referenced across the course."
duration: 2
preview: true
---

# Resources

This lesson is a reference card. Bookmark it. Every external tool, doc,
and spec we touch across the course is linked here, grouped by where it
fits in the stack. If a lesson tells you to "check the docs," this is the
page it means.

Links go to official documentation only. Where I'm not sure the canonical
URL is stable, the item is listed without a link; search the official
site for the current one.

## Languages & runtimes

The foundations. Install these once and forget about them — until a
breaking upgrade.

- [Node.js](https://nodejs.org) — JavaScript runtime. Use Node 20 or
  newer; the course and the Vercel adapter both target 20+.
- [pnpm](https://pnpm.io) — the package manager we use throughout. Fast,
  disk-efficient, and handles the monorepo-adjacent layout SvelteKit
  likes. Use pnpm 10 or newer.
- [TypeScript](https://www.typescriptlang.org) — strict mode is
  non-negotiable. TypeScript 5 or newer is assumed.

## Framework & UI

The shape of the application layer.

- [SvelteKit docs](https://svelte.dev/docs/kit) — the meta-framework.
  Routing, server endpoints, form actions, and load functions all live
  here.
- [Svelte 5 runes](https://svelte.dev/docs/svelte/what-are-runes) — the
  reactivity primitives we use in every component: `$state`, `$derived`,
  `$effect`, and `$props`.
- [Svelte docs](https://svelte.dev/docs/svelte) — the component language
  itself, if you need a refresher on blocks, snippets, or transitions.
- [Tailwind CSS v4 docs](https://tailwindcss.com/docs) — the styling
  system. We use v4, which has a different config story to v3; pay
  attention to the upgrade notes if you're coming from v3.
- [mdsvex](https://mdsvex.pngwn.io) — markdown-in-Svelte. This is how the
  course content itself is rendered, and what you'll use if you add a
  blog to Contactly later.

## Database & auth

Supabase is both our database and our auth provider. Learn the CLI early
— it's the difference between a painful migration workflow and a smooth
one.

- [Supabase docs](https://supabase.com/docs) — the product docs. Auth,
  database, RLS policies, and edge functions are all here.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
  — run Postgres locally, generate types from your schema, push
  migrations to production.
- [@supabase/ssr](https://supabase.com/docs/guides/auth/server-side/sveltekit)
  — the cookie-based auth helper we use for SvelteKit. Do not reach for
  `@supabase/supabase-js` on the server directly for auth; `ssr` is the
  right wrapper.
- [PostgreSQL docs](https://www.postgresql.org/docs/current/) — the
  underlying database. You'll spend more time here than you expect once
  you're writing RLS policies.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
  — Supabase's guide to RLS. The multi-tenant safety net we build on.

## Payments

Stripe is the densest part of the course. Get comfortable with the CLI
and the webhook testing flow early.

- [Stripe docs](https://docs.stripe.com) — the entire Stripe product
  surface. We focus on Billing, Checkout, and Customer Portal.
- [Stripe API reference](https://docs.stripe.com/api) — the endpoint-by-
  endpoint reference. Keep this open while you're writing integration
  code.
- [Stripe CLI](https://docs.stripe.com/stripe-cli) — forwards live
  webhooks to `localhost` for development, triggers test events, and
  scaffolds sample webhook handlers.
- [Stripe webhooks guide](https://docs.stripe.com/webhooks) — the
  conceptual guide. Read this before you write your first webhook
  handler; it will save you a week of confusion about idempotency.
- [Stripe Checkout](https://docs.stripe.com/payments/checkout) — the
  hosted checkout we use for initial plan purchase.
- [Stripe Customer Portal](https://docs.stripe.com/customer-management) —
  the self-service subscription management surface.
- [Stripe Node.js library](https://github.com/stripe/stripe-node) — the
  SDK we use on the server. We target v22 in this course.

## Deployment

Where Contactly actually runs, and how it gets there.

- [Vercel docs](https://vercel.com/docs) — the hosting platform.
  Zero-config SvelteKit, serverless functions, environment variables,
  and preview deployments.
- [Vercel adapter for SvelteKit](https://svelte.dev/docs/kit/adapter-vercel)
  — the adapter that ships our app to Vercel. Configuration notes for
  edge vs. Node runtimes live here.
- [GitHub Actions docs](https://docs.github.com/en/actions) — the CI/CD
  runtime. The reference for workflow syntax, runners, secrets, and
  reusable actions.
- [GitHub Actions marketplace](https://github.com/marketplace?type=actions)
  — where you'll find the `actions/setup-node`, `pnpm/action-setup`, and
  similar helpers we compose workflows from.

## Testing

Two runners, two layers. Don't conflate them.

- [Playwright](https://playwright.dev) — the end-to-end framework. Real
  browsers, real network, real cookies. We use it for the sign-up,
  checkout, and access-control flows.
- [Playwright for SvelteKit](https://playwright.dev/docs/intro) — the
  getting-started docs. The config we ship is a thin layer on top of
  the defaults.
- [Vitest](https://vitest.dev) — the unit-test runner. Fast, Vite-native,
  and understands TypeScript out of the box. We use it for pure logic:
  access rules, price maths, validators.
- [Testing Library](https://testing-library.com) — not something we lean
  on heavily, but useful if you want to write DOM-level component tests
  alongside the end-to-end suite.

## Keep this page open

The single biggest force multiplier in this course is reading the
official docs before you read a Stack Overflow answer. Every link above
is maintained by the people who ship the thing. When a lesson contradicts
the docs, the docs are usually right — and when they're not, it's worth
knowing exactly where the difference is.
