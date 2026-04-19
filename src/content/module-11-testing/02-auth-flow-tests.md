---
title: '11.2 - Auth Flow Tests'
module: 11
lesson: 2
moduleSlug: 'module-11-testing'
lessonSlug: '02-auth-flow-tests'
description: 'Write end-to-end tests for registration, login, and logout flows.'
duration: 18
preview: false
---

## Overview

With Playwright wired up in 11.1, this lesson writes your first meaningful tests. The target is the **authentication surface** — the handful of user journeys that, if broken, render Contactly unusable: a visitor can register, an existing user can log in, logged-out users can't reach protected routes, and a logged-in user can log out.

By the end you'll have a single `tests/auth.test.ts` file with four tests, all of which pass against your local dev server. More importantly, you'll understand the four building blocks that power every Playwright test you'll ever write: **`test.describe` groups**, the **`page` fixture**, **locators**, and **`expect` assertions**.

## Prerequisites

- Lesson 11.1 complete — `playwright.config.ts` is in place and `pnpm exec playwright test` runs (even with zero tests).
- Module 3 complete — `/register`, `/login`, and the logout button in the navbar all work.
- Supabase local stack running (`pnpm supabase start`) and `pnpm dev` works manually.
- A **seed user** exists in Supabase Auth with email `test@example.com` and password `password123`. You can create one manually from Supabase Studio's Auth → Users → Add user form.

## What You'll Build

- `tests/auth.test.ts` with four tests covering register, login, route protection, and logout.
- A working mental model of locators, assertions, and test isolation.

---

## The Four-Test Plan, Before We Open the Editor

There are twenty things you could test in the auth flow. Password strength validation, email confirmation, "forgot password" emails, OAuth providers, session expiration, token rotation. If you tried to E2E-test all of them, you'd burn a week and end up with a thousand-line file nobody maintains.

Instead, pick the **thinnest set of flows** that gives you meaningful coverage:

1. **`user can register`** — proves the public signup path works end-to-end: form renders, action executes, Supabase user is created, trigger fires, redirect lands on `/dashboard`.
2. **`user can log in`** — proves an existing user can authenticate: form submits, Supabase verifies credentials, session cookie is set, redirect lands on `/dashboard`.
3. **`protected routes redirect to login`** — proves your `hooks.server.ts` + route guard logic actually blocks unauthenticated access.
4. **`user can log out`** — proves the session can be destroyed: login, click log out, redirect to `/login`.

Four tests. Each one covers a genuinely different code path. Together, if all four pass, the chance that auth is silently broken is close to zero.

Everything that isn't here (password reset, OAuth, email confirmation) either isn't built yet or is covered by a mix of unit tests on the form action and manual verification the first time you configure it. That ratio is right.

---

## Create the Test File

Create the file `tests/auth.test.ts` at the project root and paste the whole thing in. We'll walk through it top to bottom afterwards.

```typescript
// tests/auth.test.ts
import { test, expect } from '@playwright/test';

const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'password123!';

test.describe('Authentication', () => {
	test('user can register', async ({ page }) => {
		await page.goto('/register');
		await page.fill('input[name="full_name"]', 'Test User');
		await page.fill('input[name="email"]', TEST_EMAIL);
		await page.fill('input[name="password"]', TEST_PASSWORD);
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL('/dashboard');
	});

	test('user can log in', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[name="email"]', 'test@example.com');
		await page.fill('input[name="password"]', 'password123');
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL('/dashboard');
	});

	test('protected routes redirect to login', async ({ page }) => {
		await page.goto('/dashboard');
		await expect(page).toHaveURL(/\/login/);
	});

	test('user can log out', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[name="email"]', 'test@example.com');
		await page.fill('input[name="password"]', 'password123');
		await page.click('button[type="submit"]');
		await expect(page).toHaveURL('/dashboard');

		await page.click('button:has-text("Log out")');
		await expect(page).toHaveURL('/login');
	});
});
```

That's seventy lines including blanks. Small, focused, readable. Now the walk-through.

---

## Imports and Constants

```typescript
import { test, expect } from '@playwright/test';

const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'password123!';
```

- **`test`** is the function you call to declare a test. **`expect`** is the assertion library. Both come from `@playwright/test`, not from a separate package — Playwright bundles its own `expect` so the assertions know how to wait for asynchronous DOM changes.
- **`TEST_EMAIL`** uses a template literal with `Date.now()` — the current Unix timestamp in milliseconds. Every time the test file is loaded, you get a unique string like `test-1713401729573@example.com`. This matters because Supabase Auth enforces uniqueness on email. If you ran `pnpm exec playwright test` twice with a hardcoded email, the second run would fail with "User already registered." Timestamping sidesteps the problem with one line of code.
- **`TEST_PASSWORD`** is a constant so you don't repeat the string. The `!` at the end satisfies any future password-complexity rule you might add without touching the test.

**Important subtlety:** `Date.now()` runs **once**, when the file is first imported. All tests in the file share the same `TEST_EMAIL` value for that run. That's fine here because only one test (`user can register`) uses the new email. The other tests use the hardcoded seed account `test@example.com`. If two tests both needed to register, you'd call `Date.now()` inside each test (or use Playwright's `test.beforeEach` to generate a fresh email per test).

---

## `test.describe` — Grouping Tests

```typescript
test.describe('Authentication', () => {
	test('user can register', async ({ page }) => {
		// ...
	});
	// more tests
});
```

`test.describe(name, fn)` wraps related tests under a shared label. It does four useful things:

1. **Organizes the HTML report.** Without describe blocks, every test is top-level and the report is a flat list of hundreds of items. With describes, you get a tree: `Authentication > user can register`, `Contacts > user can create a contact`.
2. **Scopes hooks.** A `test.beforeEach` declared inside the describe only runs before tests in that block, not across the whole file.
3. **Scopes configuration.** You can call `test.describe.serial(...)` to force tests in a block to run one at a time (rarely needed, but occasionally life-saving).
4. **Readability.** A coworker opening the file sees "ah, these four tests all verify the auth surface." No ambiguity.

The name is arbitrary prose. Use sentence case, describe the subject not the test. `'Authentication'` is good. `'auth tests'` is redundant (every test is a test). `'Should handle auth edge cases'` is vague.

---

## The `page` Fixture and the `async ({ page }) => { ... }` Pattern

```typescript
test('user can register', async ({ page }) => {
```

Every Playwright test is an **async function** that destructures fixtures from its first argument. The most common fixture is `page` — a fresh browser page (tab) that Playwright opens for this test and closes when the test ends.

**Why a fresh page per test?** Isolation. If one test signs a user in, the next test starts with zero cookies, zero local storage, and a clean DOM. No test can leak state into another. That's the difference between a test suite you trust and one you fight with.

Other fixtures you'll meet later: `context` (a browser context with cookies/storage — we'll use this in 11.3 to persist login), `request` (an API-only client for backend calls), `browser` (shared across tests in a worker).

---

## Walk-through: `user can register`

```typescript
test('user can register', async ({ page }) => {
	await page.goto('/register');
	await page.fill('input[name="full_name"]', 'Test User');
	await page.fill('input[name="email"]', TEST_EMAIL);
	await page.fill('input[name="password"]', TEST_PASSWORD);
	await page.click('button[type="submit"]');
	await expect(page).toHaveURL('/dashboard');
});
```

Line by line:

- **`await page.goto('/register')`** — navigates to `http://localhost:5173/register` (the `baseURL` from `playwright.config.ts` is concatenated in). `goto` **waits** for the page load event by default, so the next line doesn't run until the form is rendered.
- **`await page.fill('input[name="full_name"]', 'Test User')`** — finds the first `<input>` whose `name` attribute is `full_name` and types "Test User" into it. `fill` clears the field first and then types — it's safer than `type` for forms that might have placeholder text leaking in.
- The next two `fill` calls do the same for email and password.
- **`await page.click('button[type="submit"]')`** — finds and clicks the submit button. Because only one form is on the page with exactly one submit button, the CSS selector is unambiguous.
- **`await expect(page).toHaveURL('/dashboard')`** — asserts the URL is `/dashboard`. This is a **retrying** assertion: Playwright polls the URL for up to 5 seconds (configurable) until it matches or times out. You don't need to manually wait for the redirect; `expect` does it for you.

That last point is one of the most important things to internalize. **Playwright's `expect` is not like Jest's `expect`.** Jest's version checks once and fails immediately. Playwright's retries until the condition is true or the timeout elapses. That's why the test can click submit and assert on URL in the next line — there's no explicit `waitForNavigation`. The assertion itself is the wait.

---

## Walk-through: `user can log in`

```typescript
test('user can log in', async ({ page }) => {
	await page.goto('/login');
	await page.fill('input[name="email"]', 'test@example.com');
	await page.fill('input[name="password"]', 'password123');
	await page.click('button[type="submit"]');
	await expect(page).toHaveURL('/dashboard');
});
```

Structurally identical to `user can register`. The differences:

- Goes to `/login` instead of `/register`.
- Uses a **hardcoded seed account** `test@example.com` instead of a timestamped one.
- Only fills email and password; no name field on the login form.

The seed account dependency is the spicy detail. This test will fail the first time you run it if `test@example.com` doesn't exist in Supabase Auth. You have two options:

1. **Manual seed** — create the user once via Supabase Studio. Cheap, works, fragile (nobody else knows it needs to exist; new environments break).
2. **Automated seed** — a script (`scripts/seed-test-user.ts`) that uses the Supabase admin API to ensure the user exists before tests run. Robust, reproducible, more work.

For this course we go with option 1 because it matches where a solo founder would realistically land. In a team setting with real CI, move to option 2 — it pays for itself the first time a new engineer can't figure out why their tests fail.

---

## Walk-through: `protected routes redirect to login`

```typescript
test('protected routes redirect to login', async ({ page }) => {
	await page.goto('/dashboard');
	await expect(page).toHaveURL(/\/login/);
});
```

Two lines, both load-bearing.

- **`await page.goto('/dashboard')`** — tries to visit a protected route with no auth state. The fresh page has no cookies, so `locals.getUser()` (from Module 3's `hooks.server.ts`) returns null, and the route guard triggers a redirect.
- **`await expect(page).toHaveURL(/\/login/)`** — asserts the final URL matches the regex `/\/login/` — any URL containing `/login`. We use a regex instead of the literal string `'/login'` because your real redirect may include a `?redirectTo=/dashboard` query parameter, and an exact match would fail.

When in doubt, prefer the regex for URL assertions with query parameters. For URLs where the full path matters and no query is expected, the string form is clearer.

---

## Walk-through: `user can log out`

```typescript
test('user can log out', async ({ page }) => {
	await page.goto('/login');
	await page.fill('input[name="email"]', 'test@example.com');
	await page.fill('input[name="password"]', 'password123');
	await page.click('button[type="submit"]');
	await expect(page).toHaveURL('/dashboard');

	await page.click('button:has-text("Log out")');
	await expect(page).toHaveURL('/login');
});
```

This test is a small composition: log in first (the familiar four-line pattern), assert we landed on the dashboard (so we know we're actually logged in before testing logout), then click the logout button and assert we're back on `/login`.

The notable piece is the logout selector:

```typescript
await page.click('button:has-text("Log out")');
```

`:has-text("...")` is a **Playwright selector extension** (it's not valid CSS — real CSS has no such pseudo-class). It says "a button element whose text content contains 'Log out'." Case-insensitive, trims whitespace, substring match.

Why use `:has-text` here instead of `button[type="submit"]` or a CSS class? Because the navbar has multiple buttons — the logout button is one of several — and `type="submit"` isn't meaningful for a button that's not inside a form. The text label is the most stable identifier available. (In the next section we'll discuss why role-based locators would be even better.)

---

## Running the Tests

```bash
pnpm exec playwright test
```

With Supabase running, `pnpm dev` not already running (or running — `reuseExistingServer` handles both), and the seed user present, you should see:

```
Running 4 tests using 4 workers
  4 passed (6.2s)

To open last HTML report run:
  pnpm exec playwright show-report
```

Open the report:

```bash
pnpm exec playwright show-report
```

You'll see all four tests green. Click one to drill into its steps, each with a duration and (if you'd enabled screenshots) a snapshot.

For the fun of it, run the suite with the UI:

```bash
pnpm exec playwright test --ui
```

And then with a visible browser:

```bash
pnpm exec playwright test --headed
```

Watching a real Chrome window type into fields and click buttons is a surprisingly effective way to build confidence in what your tests actually do.

---

## Verifying the Tests Actually Test Something

A green test tells you nothing unless you've seen it go red for the right reason. Do this once:

1. Break `/register`'s redirect — in `src/routes/(auth)/register/+page.server.ts`, change `redirect(303, '/dashboard')` to `redirect(303, '/nope')`.
2. Run `pnpm exec playwright test -g "user can register"`.
3. Watch it fail with `Expected: toHaveURL("/dashboard"). Received: "/nope"`.
4. Revert the change. Run again. Green.

That red-green cycle is the only real proof your test has teeth. Do it the first time you write a new test, then trust the suite.

---

## Common Mistakes

- **Relying on a seed user that might not exist.** The `user can log in` test fails mysteriously if `test@example.com` hasn't been created. Document the requirement (README section, prose in the test file) or — better — use a setup script that asserts the user exists and creates it if missing.
- **Using a hardcoded registration email.** Second test run: "User already registered." Either timestamp it (`` `test-${Date.now()}@example.com` ``) or wipe Supabase Auth between runs. Timestamping is simpler.
- **Forgetting `await`.** Every `page.*` and `expect` returns a Promise. An un-awaited promise lets the test finish before the browser has done anything, and the whole suite becomes a lottery. TypeScript will warn you with `@typescript-eslint/no-floating-promises` if you've enabled it — enable it.
- **Asserting on text that changes.** If your dashboard shows "Welcome, Test User!" and you assert on exactly that text, any copy change breaks the test. Assert on URLs, on roles, on stable elements — not on marketing prose.
- **Not clearing cookies between tests.** Actually, Playwright does this for you automatically because each test gets a fresh context. But developers new to Playwright sometimes try to do it manually and break things. Trust the isolation.
- **`button[type="submit"]` matches multiple buttons.** If your page has two forms, the CSS selector is ambiguous and Playwright errors with "strict mode violation." Either scope the locator (`page.locator('form#register').locator('button[type="submit"]')`) or use `getByRole` (below).

---

## Principal Engineer Notes

1. **Timestamp emails vs. seed users vs. per-test users — pick based on blast radius.** Timestamps work great for one-off happy-path tests (register and forget). Seed users work for read-heavy flows that need a known state. Per-test user creation (either via a Supabase admin call in a `beforeEach` or a fixture) is the gold standard for large suites — every test is fully independent, and you pay for it with slower setup. Contactly at this scale does fine with the first two; when you grow past twenty E2E tests, revisit.

2. **`test.beforeEach` is tempting but often wrong.** It runs before every test in the block — convenient for "log in before each test." But it means every test pays the login cost (~2 seconds per test). For auth-gated tests, prefer **`storageState`** (lesson 11.3), which logs in **once** and reuses the session cookie across all tests.

3. **Prefer role-based locators over CSS for the long term.** The tests in this lesson use `input[name="..."]` and `button[type="submit"]` because they're concise and match what the HTML already shows. They're fine for a class project. For production, migrate to `page.getByRole('textbox', { name: 'Email' })` and `page.getByRole('button', { name: 'Sign in' })`. These locators mirror what a screen reader "sees" — they survive class renames, they break loudly if your accessibility regresses (a button without an accessible name fails the locator, and screen readers fail their users), and they double as an accessibility smoke test.

4. **Parallelism-safety is a test design discipline, not a config setting.** With `fullyParallel: true`, any test can run alongside any other in the same file — including against the same Supabase project. If two tests both insert a contact named "Ada Lovelace," you have a data-collision bug waiting to fire. The fix is to make every piece of test data unique (timestamps, UUIDs, random words) or to serialize conflicting tests explicitly with `test.describe.serial`. Treat parallelism as a constraint on your test design, not as a toggle.

5. **Every E2E test is also a regression fence.** If a new feature accidentally changes what `/dashboard` redirects to, the login test fails the same day. If a refactor loses the logout button, the logout test fails instantly. This is why the four tests in this lesson cover 80% of what can go catastrophically wrong in auth — not because they test every case, but because they exercise the critical path from multiple angles.

---

## Summary

- Wrote `tests/auth.test.ts` with four high-value tests: register, login, protected-route redirect, logout.
- Understood the `test` / `expect` imports, `test.describe` grouping, and the per-test `page` fixture.
- Used `page.goto`, `page.fill`, `page.click`, and `expect(page).toHaveURL` — enough to cover 80% of E2E scenarios.
- Used a timestamped email (`` `test-${Date.now()}@example.com` ``) to keep repeat runs from colliding on Supabase's email-uniqueness constraint.
- Leaned on a seed account (`test@example.com`) for the login-dependent tests, with the trade-off noted.
- Learned the difference between Jest-style `expect` (checks once) and Playwright-style `expect` (retries until timeout).
- Did the red-green sanity check by temporarily breaking a redirect.

## Next Lesson

In lesson 11.3 you'll cover CRUD flows on contacts — create, read, update, delete. Because every CRUD test needs a logged-in user, you'll meet the **`storageState`** pattern: log in once, save the session cookies to a file, replay them in every test. Same coverage, tenth of the runtime. You'll also start using `getByRole` locators, the production-grade answer to the CSS selectors we leaned on in this lesson.
