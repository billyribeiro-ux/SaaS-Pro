---
title: "11.3 - CRUD Tests"
module: 11
lesson: 3
moduleSlug: "module-11-testing"
lessonSlug: "03-crud-tests"
description: "Write end-to-end tests for creating, reading, updating, and deleting contacts."
duration: 15
preview: false
---

## Overview

The four tests from lesson 11.2 cover auth — the doorway to Contactly. This lesson covers the **rooms inside**. Specifically: can a logged-in user create a contact, see it in the list, edit it, and delete it? Those four operations are the heart of every CRUD app, and if any one of them silently breaks, the product is useless.

The interesting challenge isn't writing the tests — `page.fill`, `page.click`, and `expect` are the same three verbs you already know. The interesting challenge is **authentication**. Every CRUD test needs a logged-in user, but running the full login flow before every test would add five seconds per test and make the suite painfully slow at scale.

The answer is a pattern called **`storageState`**: log in **once**, save the session cookies to a file, replay them at the start of every test. You'll set that up, then write a single `tests/contacts.test.ts` with full CRUD coverage.

## Prerequisites

- Lesson 11.2 complete — `tests/auth.test.ts` passes.
- Module 5 (or the CRUD module in your timeline) complete — `/app/contacts` lists contacts, `/app/contacts/new` creates them, `/app/contacts/[id]/edit` updates them, and a delete button with a confirmation modal exists.
- A seed user `test@example.com` / `password123` in Supabase Auth (same one used in 11.2).

## What You'll Build

- A global setup script `tests/global.setup.ts` that logs in once and saves the session to `tests/.auth/user.json`.
- A Playwright config tweak that runs the setup before the main test project and injects the saved `storageState` into every test.
- A `tests/contacts.test.ts` with four tests: create, read (implicitly in create), update, and delete.

---

## The Problem With "Log In Before Every Test"

The simplest way to get an authenticated context is to log in inside each test:

```typescript
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name="email"]', 'test@example.com')
  await page.fill('input[name="password"]', 'password123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL('/dashboard')
})
```

This works. It's also slow and wasteful. Each test:

1. Spins up a fresh browser context (fast).
2. Navigates to `/login` (network round-trip).
3. Fills three fields and clicks submit (~200ms).
4. Waits for Supabase Auth to verify credentials (~500ms–2s).
5. Waits for the redirect to `/dashboard` (another network round-trip).

Two to five seconds per test, multiplied by every auth-gated test you'll ever write. With ten tests you're already looking at 30 seconds of login overhead.

`storageState` solves this by moving all of that work to a **one-time global setup**. You log in exactly once, write the resulting cookies (and any relevant localStorage) to a JSON file, and tell Playwright to preload that state into every test's browser context. Every test starts already logged in. No UI login flow, no extra requests, no flake surface.

---

## Step 1 — Create the Global Setup

Make a `tests/.auth/` directory (dot-prefixed so it's easy to gitignore) and a setup file:

```bash
mkdir -p tests/.auth
```

Add `tests/.auth/` to `.gitignore`:

```gitignore
# .gitignore
tests/.auth/
playwright-report/
test-results/
```

Session cookies are secrets. Don't commit them — even for a dev-only seed account, it's a bad habit that will bite you the day someone copy-pastes the same pattern with a production session.

Now create `tests/global.setup.ts`:

```typescript
// tests/global.setup.ts
import { test as setup, expect } from '@playwright/test'

const authFile = 'tests/.auth/user.json'

setup('authenticate', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name="email"]', 'test@example.com')
  await page.fill('input[name="password"]', 'password123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL('/dashboard')

  // Persist the post-login cookies + localStorage to a file.
  await page.context().storageState({ path: authFile })
})
```

The idiom `import { test as setup }` is a Playwright convention — it reads like English when you declare `setup('authenticate', ...)`. Under the hood it's just a regular test; the only reason to rename is readability.

The body is almost identical to the `user can log in` test from lesson 11.2 — click through the login form, confirm we landed on `/dashboard` — with one added line:

```typescript
await page.context().storageState({ path: authFile })
```

`page.context()` returns the **browser context** (a sort of ephemeral user profile). `storageState({ path })` asks the context to serialize all its cookies and `localStorage` to the given file. The JSON looks roughly like:

```json
{
  "cookies": [
    { "name": "sb-access-token", "value": "eyJhbGci...", "domain": "localhost", "path": "/", ... }
  ],
  "origins": [
    { "origin": "http://localhost:5173", "localStorage": [] }
  ]
}
```

Playwright can reload this file into any future context, and from that context's perspective it's as if the user had just logged in.

---

## Step 2 — Wire the Setup into `playwright.config.ts`

Edit `playwright.config.ts` to add a **setup project** and configure the main project to depend on it. The updated file:

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
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json'
      },
      dependencies: ['setup']
    }
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
})
```

The `projects` array grew from one to two:

- **`setup` project** — runs any file matching `global.setup.ts`. No `storageState` here; this is the run that **creates** the file.
- **`chromium` project** — unchanged except for two additions: `storageState: 'tests/.auth/user.json'` tells Playwright to preload that file into every context, and `dependencies: ['setup']` tells it to run the setup project first and wait for it to finish before starting this one.

The execution order per `pnpm exec playwright test` is now:

1. Webserver boots.
2. Setup project runs → `global.setup.ts` executes → `user.json` is written.
3. Chromium project runs → every test starts with the saved cookies preloaded → every test is logged in without doing anything.

One extra login per full suite run. The savings compound with every new auth-gated test you add.

**Note on the auth test file from 11.2:** its `user can log in`, `user can register`, `protected routes redirect to login`, and `user can log out` tests all need a **logged-out** starting state. With `storageState` preloaded, they'd start already logged in and fail. Fix that by explicitly clearing storage at the top of those tests:

```typescript
test.use({ storageState: { cookies: [], origins: [] } })
```

Put that line immediately inside `test.describe('Authentication', () => { ... })`. It overrides the preloaded state for that describe block only. We're not rewriting 11.2 here; just know the one-line knob exists.

---

## Step 3 — Write `tests/contacts.test.ts`

Create `tests/contacts.test.ts`:

```typescript
// tests/contacts.test.ts
import { test, expect } from '@playwright/test'

const CONTACT_NAME = `Ada Lovelace ${Date.now()}`
const CONTACT_EMAIL = `ada-${Date.now()}@example.com`
const UPDATED_NAME = `${CONTACT_NAME} (Updated)`

test.describe('Contacts CRUD', () => {
  test('user can create a contact', async ({ page }) => {
    await page.goto('/app/contacts/new')
    await page.fill('input[name="full_name"]', CONTACT_NAME)
    await page.fill('input[name="email"]', CONTACT_EMAIL)
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL('/app/contacts')
    await expect(page.getByRole('link', { name: CONTACT_NAME })).toBeVisible()
  })

  test('user can edit a contact', async ({ page }) => {
    await page.goto('/app/contacts')
    await page.getByRole('link', { name: CONTACT_NAME }).click()
    await page.getByRole('link', { name: 'Edit' }).click()

    await page.fill('input[name="full_name"]', UPDATED_NAME)
    await page.click('button[type="submit"]')

    await expect(page.getByRole('heading', { name: UPDATED_NAME })).toBeVisible()
  })

  test('user can delete a contact', async ({ page }) => {
    await page.goto('/app/contacts')
    await page.getByRole('link', { name: UPDATED_NAME }).click()

    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Confirm delete' }).click()

    await expect(page).toHaveURL('/app/contacts')
    await expect(page.getByRole('link', { name: UPDATED_NAME })).not.toBeVisible()
  })
})
```

Three tests, ordered so each builds on the previous one's data: create produces the contact the edit test modifies, which produces the name the delete test removes.

---

## Walk-through

### Constants and uniqueness

```typescript
const CONTACT_NAME = `Ada Lovelace ${Date.now()}`
const CONTACT_EMAIL = `ada-${Date.now()}@example.com`
const UPDATED_NAME = `${CONTACT_NAME} (Updated)`
```

Same logic as the email timestamping in 11.2. If two test runs execute back-to-back (or two workers on the same Supabase instance), a hardcoded name "Ada Lovelace" would appear twice in the contacts list, and the `getByRole('link', { name: 'Ada Lovelace' })` locator would match two elements and throw a strict-mode violation. Timestamping every run keeps locators unambiguous.

### `user can create a contact`

```typescript
test('user can create a contact', async ({ page }) => {
  await page.goto('/app/contacts/new')
  await page.fill('input[name="full_name"]', CONTACT_NAME)
  await page.fill('input[name="email"]', CONTACT_EMAIL)
  await page.click('button[type="submit"]')

  await expect(page).toHaveURL('/app/contacts')
  await expect(page.getByRole('link', { name: CONTACT_NAME })).toBeVisible()
})
```

Walk through:

- **`page.goto('/app/contacts/new')`** — because `storageState` is preloaded, this just works. No login step. If you weren't logged in, SvelteKit would redirect to `/login?redirectTo=/app/contacts/new` and the rest of the test would fail.
- Fill the two form fields (your contact form may have more; adapt as needed).
- Click submit and let the form action do its thing.
- Assert the redirect landed on the list page.
- Assert a link with the contact's name is visible in the list — this proves the contact was actually persisted, not just that the redirect happened.

The locator `page.getByRole('link', { name: CONTACT_NAME })` is **role-based** and it's worth pausing on. `getByRole` queries the accessibility tree: it finds an element with the `link` role (an `<a>` tag, or anything with `role="link"`) whose accessible name matches the supplied string. It's the single most resilient locator Playwright offers — surviving CSS class renames, markup refactors, and styling changes.

### `user can edit a contact`

```typescript
test('user can edit a contact', async ({ page }) => {
  await page.goto('/app/contacts')
  await page.getByRole('link', { name: CONTACT_NAME }).click()
  await page.getByRole('link', { name: 'Edit' }).click()

  await page.fill('input[name="full_name"]', UPDATED_NAME)
  await page.click('button[type="submit"]')

  await expect(page.getByRole('heading', { name: UPDATED_NAME })).toBeVisible()
})
```

- Visit the list, click the contact we just created, click "Edit."
- Overwrite the name with the updated version (notice `fill` clears first, so we don't append).
- Submit and assert the updated name appears as a heading on the resulting detail page.

Asserting on `getByRole('heading', { name: UPDATED_NAME })` rather than a URL or a generic text match is deliberate. It says "there's a heading element whose text content is the updated name." Your template probably renders `<h1>{contact.full_name}</h1>` on the detail page. If someone refactors that to a `<div class="page-title">`, the test fails with a clear, role-level signal — and that failure is also an accessibility signal worth paying attention to (headings provide navigation structure; losing one is a real regression).

### `user can delete a contact`

```typescript
test('user can delete a contact', async ({ page }) => {
  await page.goto('/app/contacts')
  await page.getByRole('link', { name: UPDATED_NAME }).click()

  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()

  await expect(page).toHaveURL('/app/contacts')
  await expect(page.getByRole('link', { name: UPDATED_NAME })).not.toBeVisible()
})
```

This test exercises the confirmation modal. The flow is:

1. Navigate to the contact detail page.
2. Click the "Delete" button. That opens a modal.
3. Click the modal's "Confirm delete" button.
4. Assert we're back on the list.
5. Assert the contact's link is **not** visible.

Two subtleties:

- **`getByRole('button', { name: 'Delete' })`** versus the confirm button. If you named the modal's button just "Delete" as well, you'd have two matching elements on the page simultaneously and `click()` would fail with strict-mode violation. Name them differently — "Delete" on the detail page, "Confirm delete" (or "Yes, delete") in the modal. Good test design pushes you toward good UX naming.
- **`not.toBeVisible()`** is another retrying assertion. Playwright polls until the link disappears or times out. You don't need a `waitForResponse` for the delete request — the assertion is the wait.

---

## Running the Tests

```bash
pnpm exec playwright test
```

Expected output:

```
Running 8 tests using 4 workers
  1 [setup] › tests/global.setup.ts:5:1 › authenticate (1.8s)
  2 [chromium] › tests/auth.test.ts ...                       (4 passed)
  3 [chromium] › tests/contacts.test.ts › user can create ... (1.1s)
  4 [chromium] › tests/contacts.test.ts › user can edit ...   (0.9s)
  5 [chromium] › tests/contacts.test.ts › user can delete ... (0.8s)

  8 passed (9.2s)
```

The first line is the setup running. Every subsequent test in chromium reuses its output. If you re-run `pnpm exec playwright test -g "user can create a contact"`, the setup still runs (it's a dependency, always). You can skip it with `--project=chromium` on subsequent runs if the storage file is fresh — but in practice 1.8 seconds is cheap enough to eat every time.

---

## Locator Resilience — getByRole vs Other Strategies

A quick reference comparing locator strategies for Contactly's contact-list link:

| Strategy | Example | Resilience |
|---|---|---|
| CSS selector | `.contact-list > li > a` | Breaks on any class rename or markup change. |
| Text content | `page.getByText('Ada Lovelace')` | Breaks if the name appears elsewhere (header, breadcrumb). |
| Test ID | `page.getByTestId('contact-link')` | Robust but pollutes markup with `data-testid` attributes. |
| Role | `page.getByRole('link', { name: 'Ada Lovelace' })` | Most robust for interactive elements; doubles as an a11y check. |

**Rule of thumb:** start with `getByRole`. Reach for `getByTestId` only when role-based locators are genuinely ambiguous (repeated labels, complex UI widgets). Avoid CSS locators in tests you want to keep for a year.

---

## waitForNetworkIdle vs Content Assertions — A Warning

You'll see Stack Overflow answers telling you to `await page.waitForLoadState('networkidle')` before asserting. Resist.

"Network idle" means the browser has observed no network requests for 500ms. That sounds reasonable, but in a SvelteKit app with WebSockets (HMR during dev) or long-polling, the network is never idle, and the test times out for reasons unrelated to your code. Worse, in apps where a debounced telemetry call fires every 30 seconds, you get intermittent flakes.

Instead, **wait on the thing you're asserting**. If you're asserting the new contact appears in the list, just do `await expect(page.getByRole('link', { name: CONTACT_NAME })).toBeVisible()`. Playwright retries that assertion until it passes or times out — you never need to manually wait for the network.

The only times `waitForLoadState` is legitimately useful: waiting for a specific page navigation that doesn't change the URL (rare), or debugging with a manual pause. Both are edge cases.

---

## Common Mistakes

- **Forgetting to gitignore `tests/.auth/`** — you commit a session token. In dev it's mostly harmless; the habit is dangerous. Add the ignore rule on day one.
- **Preloading `storageState` and then writing auth tests that expect logged-out state.** They'll start logged in and fail. Use `test.use({ storageState: { cookies: [], origins: [] } })` to override inside that describe block.
- **Hardcoded contact names with `fullyParallel: true`.** Two workers both try to create "Ada Lovelace"; the subsequent "click the Ada Lovelace link" step matches two elements. Timestamp or UUID-suffix your test data.
- **Relying on the previous test's data implicitly.** The create → edit → delete chain works because each test looks up the contact by name before operating. It would **not** work if the edit test assumed "the contact just created" without querying for it — `fullyParallel` might schedule edit before create. Always make each test locate its own data rather than relying on creation order.
- **Asserting on `text=` for something that appears in multiple places.** "Delete" appears on a button, a confirm button, maybe a tooltip. Scope with roles or containers.
- **Leaving test contacts in the database.** After a few hundred runs, your local Supabase's `public.contacts` has thousands of timestamped rows. Periodically run a `DELETE FROM public.contacts WHERE full_name LIKE 'Ada Lovelace 17%'` or schedule a `supabase db reset` before each run.

---

## Principal Engineer Notes

1. **`storageState` is a productivity multiplier, not just a speed hack.** Beyond the obvious wallclock savings, it decouples "am I logged in" from "what does the feature do," and that decoupling makes tests easier to read and easier to debug. A failing test in `contacts.test.ts` is almost certainly a contacts bug, not an auth bug, because auth was already proven green in the setup phase.

2. **Role-based locators double as an accessibility smoke test.** A button without an accessible name (no visible text, no `aria-label`) fails `getByRole('button', { name: '...' })`. A `<div>` styled to look like a button is invisible to the accessibility tree and fails too. Every time you write `getByRole`, you're lightly enforcing a11y standards. Lean into it — it's free coverage.

3. **Per-test data isolation is a choice you make early or pay for later.** With three CRUD tests the chain-of-data pattern (create → edit → delete) is readable and fast. At thirty CRUD tests, the coupling between them becomes a nightmare: "why did the delete test suddenly fail? Oh, someone changed the edit test to use a different name." Invest in **per-test fixtures** that create their own data and clean up after themselves once you pass a dozen tests. Playwright's fixture API (`test.extend`) is the right tool.

4. **E2E tests are not where you cover every branch.** Your create-contact form may have fifteen validation rules. Don't write fifteen E2E tests — write fifteen Vitest unit tests on the form action's Zod schema, and one E2E test for the happy path. E2E proves the wires are connected; unit tests prove the logic is right. Mixing the two layers is the fastest way to a slow, brittle suite.

5. **Content assertions > network assertions, every time.** If you ever find yourself reaching for `waitForResponse` or `waitForRequest` inside an E2E test, stop and ask: "what visible outcome am I actually waiting for?" The visible outcome is almost always the better assertion. Network-level waits tie your test to implementation details (this endpoint, this payload shape) that might change; content-level waits tie it to user-observable behavior that you'd better not change without noticing.

---

## Summary

- Learned the `storageState` pattern: log in once in `tests/global.setup.ts`, save cookies to `tests/.auth/user.json`, preload into every test via the project config.
- Added a `setup` project and made the `chromium` project depend on it, with `use.storageState` pointing at the saved session.
- Gitignored `tests/.auth/` to keep session tokens out of version control.
- Wrote `tests/contacts.test.ts` with create, edit, and delete tests that exercise the full CRUD surface, the confirmation modal, and the navigation between list and detail pages.
- Migrated from CSS selectors to `getByRole` locators — more resilient, and they double as accessibility smoke tests.
- Used timestamped contact names (`` `Ada Lovelace ${Date.now()}` ``) to keep parallel workers from colliding on duplicate data.
- Understood when **not** to reach for `waitForLoadState('networkidle')` and why content-level assertions are always better.

## Next Module

You now have a working E2E harness covering both the front door (auth) and the primary feature (contacts CRUD). In the next module you'll start on **payments** — Stripe checkout, webhooks, subscription state. The E2E coverage you wrote this module becomes your safety net: every time you touch auth or contacts to integrate billing, `pnpm exec playwright test` tells you whether you broke something. Ten seconds of compute, a good night's sleep.
