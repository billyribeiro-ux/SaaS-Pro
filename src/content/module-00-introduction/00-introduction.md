---
title: "Introduction"
module: 0
lesson: 0
moduleSlug: "module-00-introduction"
lessonSlug: "00-introduction"
description: "Welcome to SaaS-Pro. What this course is, what you'll build, and the stack you'll ship on."
duration: 3
preview: true
---

# Welcome to SaaS-Pro

Welcome. If you're here, you probably already know how to build a CRUD app.
You've followed framework tutorials, you've wired up a database, maybe you've
even shipped something to production. But there's a gap between "I can build
an app" and "I can operate a software-as-a-service business," and that gap
is what this course is about.

## The mission

The mission of SaaS-Pro is simple: **ship a real SaaS, end-to-end, with no
hand-waving.**

Most tutorials stop at "here's how to add a user table." This one doesn't.
By the end, you will have:

- A multi-tenant application running on production infrastructure.
- Real authentication, with email/password and session management.
- A Stripe billing integration that actually handles the messy bits:
  failed payments, subscription upgrades, lifetime plans, and webhooks that
  survive restarts.
- Access-control gates that enforce which features users can use based on
  their subscription tier.
- Automated tests that run in CI on every pull request.
- A deployment pipeline that pushes database migrations to production and
  rolls out the app without you touching a server.

No steps are skipped. No "imagine we had a billing system" moments. You
will touch every file that a production SaaS needs, and you will understand
why each one exists.

## What you're shipping

The project we build together is called **Contactly** — a hosted contact
management SaaS. We'll walk through its feature set in the next lesson, but
in broad strokes: users sign up, pay, manage contacts, and get cut off when
they exceed the limits of their plan. It's small enough to finish, big
enough to be genuinely non-trivial.

## The stack

Every line of code you write in this course targets a production stack
that's in active use today. Here's what you'll learn:

- **SvelteKit 2** — the meta-framework. We use its server routes, form
  actions, and load functions throughout.
- **Svelte 5 with runes** — all components use the new runes API
  (`$state`, `$derived`, `$effect`, `$props`). No legacy reactive
  statements.
- **TypeScript strict mode** — no `any` escape hatches, no implicit
  anything. The compiler is your first line of defence.
- **Supabase** — managed Postgres, row-level security, and auth sessions.
  We use `@supabase/ssr` for cookie-based auth that works with
  server-rendered routes.
- **Stripe v22** — subscriptions, Checkout, Customer Portal, webhooks, and
  idempotency keys. The Stripe work is the densest part of the course and
  the piece most tutorials get wrong.
- **Tailwind CSS v4** — the new engine, configured for SvelteKit. All
  styling is utility-first; we don't ship a component library.
- **Vercel** — deployment target. Edge-friendly, zero-config for
  SvelteKit, good enough for the product we're building.
- **Playwright** — end-to-end tests. We write real browser tests for the
  sign-up, checkout, and access-control flows.
- **Vitest** — unit tests for pure logic (access rules, price maths,
  utility functions).
- **GitHub Actions** — CI on every pull request, and a deploy pipeline
  that gates production changes on green tests.

That's eleven named technologies. Every one of them has earned its spot;
nothing is there for resume padding.

## The shape of the course

The course is organised into **14 modules** and roughly **73 lessons**. Each
module is a cohesive chunk — "get auth working," "wire up Stripe," "lock
down premium features." Inside a module, lessons are short and focused.
Most are under 15 minutes.

The modules are ordered so that you always have a working app at the end
of each one. You don't need to finish module 13 before anything compiles.
You can pause at any module boundary and have something you can show to a
friend.

Here's the arc:

- **Module 0** — you're reading it. Orientation and expectations.
- **Module 1** — SvelteKit project setup, TypeScript strict, Tailwind,
  Prettier, ESLint.
- **Module 2** — Supabase integration: local dev, migrations, typed client.
- **Module 3** — user authentication with `@supabase/ssr`.
- **Module 4** — CRUD for contacts, with row-level security.
- **Module 5** — Stripe concepts: accounts, products, prices, test mode.
- **Module 6** — Stripe wired into SvelteKit: Checkout, Customer Portal,
  webhooks.
- **Module 7** — billing as a service: the subscription state machine.
- **Module 8** — the pricing page, with live tier data.
- **Module 9** — checkout and billing flows, end to end.
- **Module 10** — access control: gating routes and features by tier.
- **Module 11** — testing strategy: unit, integration, end-to-end.
- **Module 12** — CI/CD: pull-request checks, production deploys, database
  migrations on release.
- **Module 13** — UX extras: toasts, loading states, empty states, the
  polish that makes an app feel shipped.
- **Module 14** — thank you, and where to go next.

## How to use this course

Read the lesson, then do the work. Every lesson has a concrete goal — code
you write, commands you run, a decision you make. Skipping ahead is
allowed, but the modules are cumulative; if module 10's access control
seems confusing, the answer is almost always in module 7.

When something breaks, post in the course Discord (we'll cover how to
join in lesson 0.2). Always include the lesson reference. That's the
fastest way to unblock yourself.

Let's get started.
