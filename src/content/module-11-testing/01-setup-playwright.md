---
title: "11.1 - Setup Playwright"
module: 11
lesson: 1
moduleSlug: "module-11-testing"
lessonSlug: "01-setup-playwright"
description: "Configure Playwright for end-to-end testing with your SvelteKit dev server."
duration: 12
preview: false
---

## Overview

Up to this point you've been verifying Contactly by hand: type an email, click a button, squint at the dashboard. That's fine for the first hundred times — it's not fine for the thousandth. The moment you add a second developer, a CI pipeline, or a deployment that matters, manual verification becomes the single slowest and least reliable part of your workflow.

In this module you'll automate the verification. Specifically, you'll write **end-to-end (E2E) tests** that drive a real browser through Contactly the same way a user would — visiting `/register`, typing into form fields, clicking buttons, and asserting on the resulting URL and DOM. The tool of choice is **Playwright**, and the good news is that `sv create` already installed it when you scaffolded the project back in Module 1. You just haven't used it yet.

This first lesson is pure setup: you'll review the config file, understand what each option does, and run your first (empty) Playwright invocation so you know the tooling is wired up before you write a single `expect()`.

## Prerequisites

- Modules 1 through 10 complete — Contactly runs locally with `pnpm dev`, `/register`, `/login`, `/dashboard`, and `/app/contacts` all working end-to-end.
- Supabase local stack running (`pnpm supabase start`).

## What You'll Build

- A reviewed and explained `playwright.config.ts` with the `webServer` block auto-starting SvelteKit during tests.
- A `tests/` directory convention you'll fill in over the next two lessons.
- The muscle memory for `pnpm exec playwright test`, `--ui`, `--headed`, and the HTML report.

---

## Why E2E Testing — and Why Not Only E2E Testing

Before we touch code, it's worth spending two minutes on the **test pyramid**, because the mistake most developers make with Playwright is treating it as their only testing tool.

```
          ┌──────────────┐
          │     E2E      │  ← few, slow, high-confidence
          ├──────────────┤
          │ Integration  │  ← some, medium speed, medium scope
          ├──────────────┤
          │     Unit     │  ← many, fast, narrow scope
          └──────────────┘
```

- **Unit tests** (Vitest, Module 10) verify one function or one component in isolation. Fast (milliseconds), cheap to write, pinpoint failures to a single file. But they can't tell you whether the form action talks to Supabase correctly, or whether the redirect lands on `/dashboard`.
- **Integration tests** verify a small cluster of collaborating pieces — a form action plus the database client, say. Slower than unit tests, more confidence per test.
- **E2E tests** launch a real browser against a running server and click through the app. Slowest (seconds per test, sometimes tens of seconds), most brittle (timing, selectors, environment), but the only tests that actually prove the whole stack works as a user sees it.

Good coverage is roughly: **many** unit tests, **some** integration tests, **a handful** of E2E tests for the critical flows. In Contactly our E2E suite will cover exactly the flows that, if broken, would make the product useless: signup, login, logout, and core CRUD on contacts. Everything else lives closer to the bottom of the pyramid.

**Rule of thumb:** an E2E test is worth writing when breaking its flow would cause a customer to file a support ticket. Don't E2E-test that a button has the right shade of blue; unit-test that.

---

## Inspecting What `sv create` Gave You

Back in Module 1 when you scaffolded the project, you selected **playwright** from the add-ons list. That did three things:

1. Added `@playwright/test` to `devDependencies` in `package.json`.
2. Created a `tests/` directory with a starter `demo.test.ts` file.
3. Created `playwright.config.ts` at the project root with sane defaults.

Let's verify each piece. Open `package.json` and look for Playwright:

```json
{
  "devDependencies": {
    "@playwright/test": "^1.47.0"
  }
}
```

Exact versions will differ depending on when you ran `sv create`; anything in the 1.40+ range is fine for this course.

Next, check the `tests/` folder:

```bash
ls tests/
```

You should see something like `demo.test.ts`. We'll delete it shortly — it's a scaffold placeholder, not something we'll build on.

Finally, open `playwright.config.ts`. Your version may have extra defaults sprinkled in; we're going to replace it with a clean, opinionated version that matches the rest of this module.

---

## The Canonical `playwright.config.ts`

Replace the contents of `playwright.config.ts` at the **project root** with exactly this:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
})
```

That's the entire file. Fewer than thirty lines, but every one earns its keep. Let's walk through them.

### Line-by-line walkthrough

#### `import { defineConfig, devices } from '@playwright/test'`

`defineConfig` is a type-assistance helper — it accepts the config object and returns it unchanged, but the TypeScript signature means your editor will autocomplete every valid field and underline typos. `devices` is a map of preset viewport + user-agent + device-scale combinations (Desktop Chrome, iPhone 14, etc.) that you spread into the `use` block of a project.

#### `testDir: './tests'`

Playwright will scan this directory for files ending in `.test.ts`, `.spec.ts`, or the patterns in the default `testMatch`. Keep all E2E tests inside `tests/` so your Vitest unit tests (which live alongside the code in `src/`) never get accidentally picked up by Playwright or vice versa.

#### `fullyParallel: true`

By default Playwright runs test **files** in parallel and tests within a file serially. `fullyParallel: true` runs tests **within** a file in parallel too, across worker processes. Great for speed — but it means you cannot assume two tests in the same file share state. If test A creates a contact named "Ada" and test B reads it, B may run before A and fail. Design tests as independent.

#### `forbidOnly: !!process.env.CI`

When writing a test locally you might use `test.only(...)` to focus on a single case. If you accidentally commit that, only the focused test runs in CI — everything else is silently skipped, and your green build is a lie. `forbidOnly: true` causes CI to fail if any `.only` sneaks in. Locally it's `false`, so your focused runs still work.

The `!!` is a standard JavaScript trick to coerce a value to boolean. `process.env.CI` is the string `'true'` (or undefined) in CI environments; `!!'true'` is `true`, `!!undefined` is `false`.

#### `retries: process.env.CI ? 2 : 0`

In CI, retry each failing test up to two times before marking it failed. Locally, no retries — a failure is a failure. Retries in CI paper over **flakes**, the category of tests that sometimes pass and sometimes fail due to timing. Flakes are the enemy; retries buy you time to fix them without blocking deploys.

#### `workers: process.env.CI ? 1 : undefined`

Locally Playwright picks a worker count based on CPU cores (`undefined` means "you decide"). In CI we force one worker — slower, but easier on the (shared) database and less likely to hit race conditions from parallel writes to `public.contacts`. When you move Contactly to a CI runner with an isolated database per worker, you can bump this up.

#### `reporter: 'html'`

After every run, Playwright writes a self-contained HTML report to `playwright-report/`. You'll view it after your first real test run.

#### The `use` block

```typescript
use: {
  baseURL: 'http://localhost:5173',
  trace: 'on-first-retry'
}
```

- `baseURL` — lets you write `page.goto('/login')` instead of `page.goto('http://localhost:5173/login')`. Changing the base URL in one place (e.g., for a staging environment) switches the whole suite.
- `trace: 'on-first-retry'` — Playwright records a **trace** of the first retry of any failing test. Traces are the single most useful debugging tool in the whole framework; we'll come back to them in a minute.

#### `projects`

```typescript
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
]
```

A **project** is a named configuration. You can have one project per browser, or one per device, or one per logged-in user. Tests run once per project — so adding `{ name: 'firefox', ... }` would double your run time.

For Contactly we stick with Chromium. Cross-browser E2E testing is valuable, but it comes at a cost, and for a v1 SaaS app the odds of a bug that exists in Firefox but not Chromium are low. If a real user reports one, you add Firefox to the projects array.

#### The `webServer` block

```typescript
webServer: {
  command: 'pnpm dev',
  url: 'http://localhost:5173',
  reuseExistingServer: !process.env.CI
}
```

This is the config entry that makes the whole thing work without you having to open two terminals.

- `command: 'pnpm dev'` — what to run. Playwright spawns this as a child process.
- `url: 'http://localhost:5173'` — the URL to poll. Playwright hammers this URL until it gets a 200 (or times out) before starting tests. So no test ever runs against a not-yet-ready server.
- `reuseExistingServer: !process.env.CI` — **locally**, if something's already listening on port 5173 (e.g., a `pnpm dev` you had running), Playwright uses it and doesn't start a new one. Much faster feedback loop. In CI we always boot a fresh server; no chance of contaminating it with prior state.

If you want the webServer to always boot cleanly even locally, set `reuseExistingServer: false`. The trade-off is a few seconds of cold start on each test run.

---

## Your First Test Run

Delete the starter demo file so it doesn't clutter the output:

```bash
rm tests/demo.test.ts
```

Now run the suite:

```bash
pnpm exec playwright test
```

What happens:

1. Playwright reads `playwright.config.ts`.
2. It sees `webServer.command` and runs `pnpm dev` in the background.
3. It polls `http://localhost:5173` until it gets a response (or until the default 60s timeout).
4. It scans `tests/` for test files. There are none (we deleted the demo).
5. It prints `No tests found. Exiting with code 0.` and shuts down.

Zero tests pass, zero fail. But the tooling is alive. You've proven:

- `@playwright/test` is installed.
- The config compiles.
- The webServer integration boots SvelteKit.

That's enough for one lesson.

**Flag cheat-sheet you'll use in the next two lessons:**

| Command | What it does |
|---|---|
| `pnpm exec playwright test` | Headless run of every test. |
| `pnpm exec playwright test --ui` | Interactive time-travel UI — step through tests, re-run individually. |
| `pnpm exec playwright test --headed` | Headless-off: you watch a real browser window click through. |
| `pnpm exec playwright test auth.test.ts` | Run only matching files. |
| `pnpm exec playwright test -g "user can log in"` | Run only tests whose title matches the pattern. |
| `pnpm exec playwright show-report` | Open the HTML report from the last run. |

The `--ui` mode is worth singling out. It launches a little Playwright-branded app that shows your test tree, lets you pick any test and re-run it in isolation, and — critically — shows you a **timeline of every action** the test took, with a DOM snapshot at each step. First time you use it, everything clicks. Spend five minutes exploring it once you've written a real test in 11.2.

---

## The Trace Viewer — Your New Superpower

Let me talk about traces separately, because they are the single biggest productivity lever Playwright offers and most newcomers ignore them.

With `trace: 'on-first-retry'` set, when a test fails and retries, Playwright records:

- Every action (click, fill, goto) with the exact selector used.
- A full DOM snapshot **before and after** every action.
- Network requests and responses.
- Console logs.
- Screenshots and a video.

You open the trace with:

```bash
pnpm exec playwright show-trace trace.zip
```

(Playwright prints the path at the end of a failing run, or you can download it from the HTML report.)

Inside the viewer you get a scrubbable timeline. Click the `page.click('button[type="submit"]')` step and you see the DOM at exactly that moment — which element was clicked, what was visible, what the URL was. You scroll one step forward and see the post-click state.

This is the kind of debugging experience that used to require `console.log` everywhere, manual reproduction in dev tools, and prayer. With traces, you don't guess — you watch the test fail, scrub the timeline, and spot the bug in under a minute.

**For the rest of this module: any time a test fails unexpectedly, your first move is to open the trace. Not re-run. Not add logs. Open the trace.**

---

## Common Mistakes

- **Committed `test.only(...)`** — and your CI is configured without `forbidOnly`. Every other test silently skipped for a week until someone noticed. Keep `forbidOnly: !!process.env.CI`.
- **No `webServer` block, relying on a manually started `pnpm dev`** — works locally, breaks the first day you set up CI. Always configure `webServer`; setting `reuseExistingServer: true` gives you the best of both worlds.
- **`baseURL` points at production or staging** — and the first `page.goto('/register')` tries to create a real user in your real database. `baseURL` must always point at a local or ephemeral environment for automated runs. Production smoke-tests are a different thing and live in a separate config.
- **`testDir: '.'`** — Playwright now crawls your `src/` and `node_modules/` looking for `.test.ts` files. Startup takes a minute, your Vitest tests get double-run (and fail because Playwright can't render Svelte components). Keep `testDir: './tests'`.
- **Forgot to delete `demo.test.ts`** — first real CI run fails with a confusing error from the scaffold file. Clean out scaffolding before writing anything real.

---

## Principal Engineer Notes

1. **E2E tests have the worst cost/value curve of any testing layer, but the highest ceiling.** A single E2E for the registration flow catches a broken hooks.server.ts, a broken Supabase client, a broken trigger, a broken redirect, and a broken dashboard — five bugs in one test. That's the ceiling. The cost is that same test might take 8 seconds to run, occasionally flake, and need updating when the form markup changes. Spend your E2E budget on flows that actually matter to users; use unit and integration tests for everything else.

2. **Treat flakes like any other bug.** A flaky test is not "almost passing" — it's broken. Every flake is a race condition, a missing `await`, a selector that matches two elements, or an assumption about parallelism. Retrying in CI is a tourniquet, not a fix. Write an issue for every flake you see, even if you re-run and it passes.

3. **The `webServer` abstraction hides a subtlety: test data contamination.** You're running real `pnpm dev` against your real local Supabase. Every test that creates a user or contact leaves residue. For the next two lessons we'll use timestamped emails to sidestep uniqueness collisions, but the long-term answer is **database reset between runs** — a `supabase db reset` or a global-setup hook that truncates public tables. Keep this in the back of your mind; you'll feel the pain before you solve it.

4. **CI flakiness has three common causes: timing, parallelism, and resource limits.** Timing flakes are fixed by replacing `waitForTimeout` with `expect(...).toBeVisible()` — wait for the thing, not a duration. Parallelism flakes are fixed by running with `workers: 1` in CI or by giving each worker its own database schema. Resource flakes are fixed by giving your CI runner more RAM or more CPU; Playwright's webServer plus Supabase plus your test process is a heavy stack on a free-tier GitHub runner.

5. **Invest in your first trace-viewer win.** Once a dev on your team has used the trace viewer to debug a real failure, they'll never go back to log-based debugging for E2E. Schedule it: next time a Playwright test fails on anyone's machine, pair for five minutes and open the trace together. The habit sticks.

---

## Summary

- Confirmed that `sv create` already installed `@playwright/test` and scaffolded `playwright.config.ts`.
- Replaced the scaffold config with a clean, opinionated version: single chromium project, HTML reporter, trace on retry, auto-launching `pnpm dev` as the `webServer`.
- Understood every config field line by line — `testDir`, `fullyParallel`, `forbidOnly`, `retries`, `workers`, `reporter`, `use.baseURL`, `use.trace`, `projects`, `webServer`.
- Ran `pnpm exec playwright test` with zero tests to verify the tooling pipeline is alive.
- Learned the handful of flags you'll use daily: `--ui`, `--headed`, `-g`, `show-report`, `show-trace`.
- Internalized the test pyramid: E2E is a scalpel, not a hammer — reserve it for flows that would cause support tickets if broken.

## Next Lesson

In lesson 11.2 you'll write your first real Playwright tests — full end-to-end coverage of the auth flows you built back in Module 3. You'll see `test.describe`, locators, `expect().toHaveURL()`, and the timestamp-email trick for keeping parallel tests from stepping on each other. By the end of it, a full pass of `pnpm exec playwright test` will prove that registration, login, logout, and route protection all work without you clicking a single thing.
