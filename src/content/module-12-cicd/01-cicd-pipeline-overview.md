---
title: '12.1 - CI/CD Pipeline Overview'
module: 12
lesson: 1
moduleSlug: 'module-12-cicd'
lessonSlug: '01-cicd-pipeline-overview'
description: "Understand the CI/CD pipeline we're building — from git push to live production deploy."
duration: 10
preview: false
---

## Overview

Eleven modules in, Contactly is a working SaaS on your laptop. Users can register, log in, manage contacts, subscribe to paid plans via Stripe, and export their data. It's tested end-to-end with Playwright, type-safe, and linted. Every feature runs green against the local Supabase stack on port 54321.

None of that matters until strangers can use it.

Module 12 is the bridge from "it works on my machine" to "it's live at contactly.app, three thousand miles from my laptop, surviving a push from a teammate at 2am without me there to babysit it." That bridge is a **CI/CD pipeline** — a chain of automated steps that turns a `git push` into a production deploy with no human in the loop.

This first lesson doesn't ship code. It teaches you the **shape** of the pipeline we're about to build, so every subsequent step makes sense as part of a whole. Read this once, refer back to it as you work through 12.2 through 12.6, and the pieces will click together.

## Prerequisites

- Modules 1-11 complete — Contactly is fully featured locally.
- A GitHub account and the Contactly codebase pushed to a repo (public or private both work).
- `pnpm`, Node 22, and the Supabase CLI installed locally.
- A credit card (Vercel and Supabase both have generous free tiers, but production requires a payment method on file).

## What You'll Understand by the End

- What the letters CI and CD actually stand for — and why that distinction matters.
- The canonical flow: `git push main` → GitHub Actions → type-check → database migrate → Playwright → Vercel deploy.
- Why automated tests run _before_ deploy, not after, and what happens when you get that ordering wrong.
- The four tools we compose (GitHub Actions, Supabase CLI, Playwright, Vercel CLI) and why we chose these specific four.
- Principal-engineer concepts: continuous delivery vs. continuous deployment, blue-green + canaries, rollback strategies, and why deployment frequency is the single most-predictive DORA metric.

---

## What CI/CD Actually Is

The acronym CI/CD gets thrown around loosely. Let's be precise.

**CI — Continuous Integration** is the discipline of merging small changes into the main branch many times a day, with each merge triggering an automated suite of checks (build, type-check, unit tests, integration tests, linters). The goal: catch breakage within minutes of the commit that caused it, while the offending code is still fresh in the author's head.

Before CI, teams worked on branches for weeks and integrated at the end — a painful ritual called "merge hell." CI inverts that. You integrate constantly. The pipeline tells you, usually within five minutes of pushing, whether your change composes correctly with everyone else's.

**CD — Continuous Delivery** is the discipline of keeping the main branch in a **deployable state** at all times. Every commit on main is, in theory, a release candidate. You may not ship it today, but you **could** ship it today, with confidence, because CI just proved it doesn't break anything.

**CD — Continuous Deployment** is the stronger sibling. It says: if CI passes on main, deploy it. Automatically. No human gate. No release manager. No "can I push to prod?" Slack message. The pipeline owns the last mile.

The distinction between continuous delivery and continuous deployment is a policy choice, not a technical one. Both use the same pipeline. Continuous deployment removes a button-press at the end. We'll build **continuous deployment** in this module — Contactly pushes to main, and three minutes later production is running the new code, no human intervention required.

Most mature teams land on continuous delivery with a manual approval step for production because regulated industries (banking, healthcare, government) require a sign-off. For a B2B SaaS like Contactly, continuous deployment is the norm and the right default.

---

## The Shape of Our Pipeline

Here's the pipeline as a picture. Memorize this diagram — every lesson in this module implements one of these arrows.

```
  Developer
     │
     │ git commit + git push
     ▼
┌────────────────────────────────────┐
│   GitHub (source of truth)         │
│   - main branch                    │
│   - pull requests                  │
└────────────────────────────────────┘
     │
     │ webhook: "push to main"
     ▼
┌────────────────────────────────────┐
│   GitHub Actions runner            │
│   (fresh Ubuntu VM, 4 vCPU)        │
│                                    │
│   Step 1  Checkout code            │
│   Step 2  Install pnpm + Node 22   │
│   Step 3  pnpm install             │
│   Step 4  svelte-check (types)     │
│   Step 5  supabase db push         │
│   Step 6  playwright install       │
│   Step 7  playwright test          │
│   Step 8  vercel --prod            │
└────────────────────────────────────┘
     │                     │
     │ migrate             │ deploy
     ▼                     ▼
┌──────────────┐    ┌──────────────┐
│  Supabase    │    │   Vercel     │
│  (Postgres   │    │  (SvelteKit  │
│   + Auth +   │    │   serverless │
│   Storage)   │    │   functions) │
└──────────────┘    └──────────────┘
     ▲                     ▲
     │                     │
     └──────── users ──────┘
              https://contactly.app
```

Let's walk the arrows top to bottom.

### `git push main` → GitHub

You push a commit. That's the only action a human takes. Every subsequent step is automated by the pipeline we write in this module.

The `main` branch is sacred. Nothing gets merged to main without passing the pull request pipeline (same steps, minus the deploy). Branch protection (lesson 12.4) enforces this at the platform level — GitHub literally refuses pushes to main that haven't been through a passing PR.

### GitHub → GitHub Actions runner

GitHub, the source-hosting platform, detects the push and spawns a **runner** — a clean Ubuntu virtual machine with Docker, Node, Git, and a handful of other tools preinstalled. Our `.github/workflows/deploy.yml` file tells the runner exactly what commands to execute.

GitHub Actions is free for public repositories and generous for private ones (2,000 runner-minutes/month on the free tier, which covers small teams). The runner is ephemeral — it gets destroyed after the job completes. Every build starts from a known clean state.

### Type check

```bash
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

This is the first real check. It runs the Svelte/TypeScript compiler against every file and fails if a type is wrong. A `string` getting passed where a `number` is expected. A missing property on a `$props()` destructure. An import that points nowhere.

Type check is **fast** — typically under a minute — and catches a huge category of bugs without running a single line of business logic. Running it first means a broken type fails the pipeline early, saving the minutes it would take to spin up the database and run Playwright.

### Database migrate

```bash
supabase db push --linked
```

This is the scary-looking step that isn't actually scary if you've been disciplined about migrations. Every schema change in Contactly is a timestamped SQL file in `supabase/migrations/`. `supabase db push --linked` connects to the **production** Supabase project and applies any migrations that haven't been applied yet.

It's idempotent — running it twice does nothing the second time. It's transactional — if a migration fails mid-way, Postgres rolls it back. And it happens **before** the app deploy, so the database is always one step ahead of (or equal to) the code that will query it. Deploy code that expects column X but run the migration after? That code crashes for every user until the migration catches up. Migration first, code second. Always.

### Install Playwright + run tests

```bash
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test
```

Playwright spins up real Chromium, navigates Contactly running against a dedicated **test** Supabase project (not prod), and exercises critical user flows: register, log in, create contact, upgrade to paid, etc. If any of those fail, the pipeline stops and the deploy never happens.

Note the key detail: Playwright points at a **separate** Supabase instance from production. You never want CI tests to mutate production data. Lesson 12.4 explains how we configure that via `PUBLIC_SUPABASE_URL_TEST` and `PUBLIC_SUPABASE_ANON_KEY_TEST` secrets.

### Deploy to Vercel

```bash
pnpm exec vercel --prod --token=$VERCEL_TOKEN
```

If — and only if — every step above passed, Vercel gets the green light. The Vercel CLI bundles the SvelteKit app with `@sveltejs/adapter-vercel`, uploads the build to Vercel's edge network, and swaps traffic over to the new version. Within about 30 seconds, https://contactly.app is running your new code.

The last line of the pipeline is a link in the GitHub Actions logs to the deployed URL. From push to production: typically 3-5 minutes total.

---

## Why Tests Must Come Before Deploy

A lot of junior pipelines have this ordering:

```
git push → deploy → tests → rollback if tests fail
```

That's wrong. It's called "deploy and pray." Here's why it fails:

1. **Users are the test subjects.** Between deploy and the test suite finishing, real traffic is hitting the broken build. That's seconds to minutes of 500 errors depending on your suite's length — long enough for an angry support ticket.
2. **Rollback isn't free.** Rolling back means re-deploying the previous version, which takes another 30 seconds. During that window, users are on a broken build. Double your exposure.
3. **It normalizes broken deploys.** When rollback is part of the flow, the team stops treating a failed deploy as a crisis. Quality slips.

The correct ordering is:

```
git push → tests → deploy → monitor
```

Tests **gate** the deploy. If tests fail, nothing ships. The users never see the bug because the deploy never happened. The team treats a red pipeline as "fix before moving on" — because you can't move on; main is locked by branch protection until someone un-breaks it.

Our pipeline enforces this with a simple conditional:

```yaml
- name: Deploy to Vercel
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  run: pnpm exec vercel --prod ...
```

The `if:` clause means "only run this step when all previous steps passed AND we're on the main branch." Pull requests run through the same pipeline but skip the deploy step. That's how PRs get tested without ever touching production.

---

## Tools in the Stack, and Why These Four

We use four tools. Each was chosen after real alternatives were considered.

### GitHub Actions (CI platform)

Alternatives: CircleCI, Buffalo, Jenkins, GitLab CI, Buildkite, Dagger.

We pick GitHub Actions for three reasons:

- **Co-located with the repo.** Your workflow YAML lives in the repo, version-controlled next to the code. Every PR that changes the pipeline is reviewable.
- **Free for small teams.** Public repos are unlimited; private repos get 2,000 minutes/month free. For a solo SaaS that's months of builds.
- **Huge ecosystem of pre-built actions.** `actions/checkout`, `pnpm/action-setup`, `supabase/setup-cli` — pre-packaged steps maintained by the community and platform vendors. You compose instead of scripting from scratch.

### Supabase CLI (schema deploys)

We use `supabase db push --linked` to apply migrations. The alternative would be something like running raw `psql` against the production database, or using a third-party migration tool like Atlas or Flyway. The Supabase CLI is tightly integrated with our stack — it knows about Supabase's `auth` schema, storage, edge functions — so it's the right tool for a Supabase-hosted project. You wouldn't use it for a bare RDS Postgres; for that, Flyway/Atlas/Prisma Migrate are the right tools.

### Playwright (end-to-end tests)

Alternatives: Cypress, Selenium, Puppeteer, WebDriverIO.

Playwright wins on:

- **Multi-browser out of the box** — Chromium, Firefox, and WebKit with one API.
- **Fastest of the modern stack** — parallelization built in, no flaky waits.
- **Made by the team that wrote Puppeteer.** They fixed Puppeteer's ergonomic warts.

You set up Playwright in Module 9. This module wires it into CI.

### Vercel CLI (deploy target)

Alternatives: Netlify, Cloudflare Pages, AWS Amplify, self-hosted with Docker + Fly.io/Railway.

Vercel wins on:

- **First-class SvelteKit support.** The maintainers of SvelteKit and Vercel collaborate on `@sveltejs/adapter-vercel`. Features land in SvelteKit and Vercel supports them the same week.
- **Edge + serverless mix.** Static assets go to a global CDN; server routes become serverless functions; edge-runtime routes go to POPs near users. All from one deploy.
- **PR preview deployments free.** Every pull request gets its own `https://contactly-git-pr-123-yourname.vercel.app` URL. Reviewers click a link and see the change running live. No local setup required.

Hard constraint for this course: we use `@sveltejs/adapter-vercel` and `pnpm`. If you want to later self-host on Fly.io or AWS Lambda, you swap the adapter and the deploy step — the rest of the pipeline stays identical. That's by design.

---

## The Three Environments

A mental model that will save you grief: every SaaS has three environments. You'll have all three by the end of this module.

| Environment    | Purpose         | Data                | Who sees it  |
| -------------- | --------------- | ------------------- | ------------ |
| **Local**      | Daily dev work  | Your seed data      | You          |
| **CI / Test**  | Playwright runs | Ephemeral test data | The pipeline |
| **Production** | Real users      | Real customer data  | The internet |

Each environment has its own Supabase project, its own Stripe keys (test-mode vs. live-mode), its own `PUBLIC_APP_URL`. Keeping them rigorously separate is the prerequisite for sleeping at night. One shared `.env` file across all three is how Stripe's test webhook fires against live customer records and your metrics dashboard lights on fire.

Lesson 12.2 creates production Supabase. Lesson 12.5 creates production Stripe keys. Lesson 12.6 threads the production URLs through.

---

## Common Mistakes

- **Thinking CI/CD is one thing.** CI and CD are two disciplines. You can do CI without CD — many teams do. You can't do CD without CI (deploying without testing is a recipe for 2am pages). Get CI solid first; CD is the reward.
- **Running the deploy before the tests.** See the "deploy and pray" discussion above. Tests gate deploys. Always. If your pipeline's deploy step isn't inside an `if: success()` equivalent, fix it.
- **Sharing one Supabase project across environments.** Dev, CI, and prod on the same database means Playwright's `DELETE FROM contacts WHERE user_id = 'test'` fires against real customer rows if the test fixture is wrong. Three separate projects. Non-negotiable.
- **Putting secrets in the YAML.** `VERCEL_TOKEN: abc123` inline in `deploy.yml` is a leaked secret the instant the repo goes public (or gets cloned by a contractor you later fire). Secrets live in GitHub's encrypted secret store and get injected via `${{ secrets.NAME }}`.
- **Assuming CI runners have state.** Each run is a fresh VM. `node_modules` isn't cached unless you cache it. Your local `.env` isn't there. Anything your pipeline needs must be declared in the YAML or pulled from secrets.

---

## Principal Engineer Notes

### Continuous delivery vs. continuous deployment

We touched on this above; it's worth internalizing. **Continuous delivery** means every commit is shippable; a human chooses when to ship. **Continuous deployment** means every passing commit ships automatically, no human in the loop. Trade-offs:

- Continuous deployment forces you to have excellent test coverage and feature flags, because there's no "wait and think" phase. A bad commit is live in minutes.
- Continuous delivery lets you batch commits into a release, write release notes, coordinate with marketing, etc. — at the cost of slower feedback and bigger scary deploys.

Most SaaS teams shipping fast are on continuous deployment for the main product, gated by feature flags for anything risky. Contactly lands there by the end of this module.

### Blue-green and canary deploys

Vercel's deploy model is effectively blue-green by default. A new deploy goes up on fresh serverless infrastructure; DNS flips; the old deploy lingers for a minute so in-flight requests drain. If anything explodes in the first few seconds, you click "Promote" on the previous deploy and roll back in under 30 seconds.

Canary deploys — sending 5% of traffic to the new version, then 25%, then 100% over an hour — are a step beyond. Vercel supports them via their router rules. Contactly doesn't need canaries at its current scale (single-digit queries-per-second) but you should know the pattern exists for when you grow. The rule: canary anything that changes a database write path; full-rollout anything that's purely UI. Scale-adjusted risk.

### Rollback strategy

The best rollback is the one you never use because your tests caught the bug. The second-best rollback is atomic and fast. Our stack gives you both:

- **Vercel rollback:** one click in the dashboard, or `vercel rollback` CLI. Takes 10 seconds. Swap traffic back to the previous deploy. This handles "the code has a bug" 95% of the time.
- **Supabase migration rollback:** **there is no automatic rollback for a migration.** You have to write a new migration that reverses the bad one. This is why every migration you write should be backwards-compatible with the previous deployed version of the code — add columns, don't remove them; add tables, don't drop them; deprecate fields, don't repurpose them.
- **Point-in-time recovery:** Supabase Pro offers PITR up to 7 days back. Nuclear option. Use only for data corruption, not code bugs.

The painful truth: database rollbacks are hard, which is why schema-migration hygiene is the most important discipline in the pipeline. One bad migration can take hours to unwind.

### Deployment frequency as a DORA metric

DORA — the DevOps Research & Assessment team — studies what separates elite engineering orgs from low performers. Their research (published in the book _Accelerate_) identifies four key metrics. The single most predictive one is **deployment frequency**.

- **Elite performers** deploy multiple times per day.
- **High performers** deploy between once per day and once per week.
- **Medium performers** deploy between once per week and once per month.
- **Low performers** deploy less than once per month.

The counter-intuitive finding is that elite performers also have the **lowest** change-failure rate and **fastest** mean-time-to-restore. Shipping faster does not mean shipping buggier — it means the team has invested in the pipeline, tests, and feature flags needed to ship safely in small batches.

Our pipeline is the prerequisite infrastructure for joining the elite tier. Once this module ships, you can deploy Contactly ten times today if you want. Whether you choose to is a product decision, not a platform one.

---

## What's Next

The abstract shape is in your head. Time to make it concrete. In lesson 12.2 you'll create a real Supabase project on supabase.com (the hosted version, not the local Docker stack), link it to your repo with the Supabase CLI, and push every migration from `supabase/migrations/` into production Postgres. Ten minutes of ops work, and your production database exists.
