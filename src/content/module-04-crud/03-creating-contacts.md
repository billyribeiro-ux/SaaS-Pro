---
title: '4.3 - Creating Contacts'
module: 4
lesson: 3
moduleSlug: 'module-04-crud'
lessonSlug: '03-creating-contacts'
description: 'Build the create contact form with a SvelteKit form action, Zod validation, and Supabase insert.'
duration: 15
preview: false
---

## Overview

Contactly can list contacts but can't add one. In this lesson you'll build the "New contact" page: a dedicated route with a form, a server action, and a Zod schema.

By the end: the user clicks **New contact** → types a name, email, phone, company → hits **Create contact** → a row lands in Supabase, RLS-scoped to their account, and they return to `/contacts` with the new entry visible.

We'll dig into the non-obvious bits: why `user_id` _must_ come from the server-side session (with a concrete attack scenario), how Zod v4 handles optional fields that arrive as empty strings, why we convert empty strings to `null` before insert, and a `submitting` state that makes the button feel alive.

## Prerequisites

- Lesson 4.1 complete — the `contacts` table exists with RLS policies scoping every row to its owner.
- Lesson 4.2 complete — `/contacts` renders the list with a working "New contact" link to `/contacts/new`.
- `src/routes/(app)/+layout.server.ts` enforces authentication, so any `(app)` route already has a logged-in user.

## What You'll Build

- A new route at `/contacts/new` with `+page.server.ts` (the action) + `+page.svelte` (the UI).
- A Zod v4 schema that enforces required vs. optional fields, length limits, and email format — server-side.
- A form action that validates input, sets `user_id` from the verified session, converts empty strings to `null`, and inserts into Supabase.
- A Tailwind-styled form with inline error display, form repopulation on failure, and a live "Saving..." state.
- A redirect to `/contacts` on success.

---

## First Principles — What Is a "Create" Flow, Really?

Creating a record on the web is a four-stage pipeline:

1. **Gather input.** Browser renders HTML; user types.
2. **Transport.** On submit, browser POSTs form data to the server.
3. **Validate and authorize.** Server parses raw untrusted strings, checks the user is allowed to do this, fills in server-known fields (`user_id`, `created_at`).
4. **Persist and respond.** Server inserts and either redirects (success) or re-renders with an error.

Every step has failure modes: blank required fields, dropped connections, forged hidden inputs pointing at someone else's account, DB constraint violations.

SvelteKit form actions map cleanly: `+page.svelte` handles Step 1, `method="POST"` + `use:enhance` handles Step 2, `actions.default` handles Step 3, `locals.supabase.from('contacts').insert()` + `redirect(303, ...)` handles Step 4. We'll build in that order.

---

## Creating the Route Folder

The URL `/contacts/new` maps to `src/routes/(app)/contacts/new/`. The `(app)` group wraps the route in the authenticated layout (navbar, auth check) but doesn't appear in the URL.

```bash
mkdir -p "src/routes/(app)/contacts/new"
touch "src/routes/(app)/contacts/new/+page.svelte"
touch "src/routes/(app)/contacts/new/+page.server.ts"
```

Two files is the standard SvelteKit form pattern:

- `+page.server.ts` — runs only on the server. Where we validate and talk to the database.
- `+page.svelte` — rendered on the server, hydrated on the client. Where the form lives.

Separating concerns this way makes it impossible to leak server secrets to the browser, and it makes the action testable in isolation.

---

## Step 1 — The Zod v4 Validation Schema

Open `src/routes/(app)/contacts/new/+page.server.ts`.

```typescript
// src/routes/(app)/contacts/new/+page.server.ts
import { fail, redirect, error } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions } from './$types';

const contactSchema = z.object({
	first_name: z.string().min(1, 'First name is required').max(100),
	last_name: z.string().min(1, 'Last name is required').max(100),
	email: z.string().email('Invalid email').optional().or(z.literal('')),
	phone: z.string().max(50).optional().or(z.literal('')),
	company: z.string().max(200).optional().or(z.literal(''))
});
```

### Line-by-line

```typescript
import { fail, redirect, error } from '@sveltejs/kit';
```

- `fail` — returns a typed failure from a form action. The payload reaches the client as the `form` prop.
- `redirect` — ends the action and navigates somewhere. Throws internally; code after it never runs.
- `error` — throws an HTTP error (401, 403, 500). Different from `fail`: renders an error page, not the same page with a message.

```typescript
import * as z from 'zod';
```

The **Zod v4 import style**. If you've seen `import { z } from 'zod'`, that was v3. Contactly uses Zod v4 (check `package.json`). Always use `import * as z from 'zod'`.

```typescript
import type { Actions } from './$types';
```

SvelteKit auto-generates `$types` per route. `Actions` is the exact shape SvelteKit expects for the `actions` export.

```typescript
first_name: z.string().min(1, 'First name is required').max(100),
```

- `z.string()` — must be a string. `null` or a number fails.
- `.min(1, 'First name is required')` — at least 1 character. Second arg is the user-facing error message.
- `.max(100)` — matches the `varchar(100)` column. Keeping schema and DB in sync means the DB never rejects what our schema accepted.

No error message on `.max(100)` because `maxlength="100"` on the input already stops typing. Only an attacker bypassing the UI hits this constraint, and a generic message is fine for them.

### The tricky one: optional fields

```typescript
email: z.string().email('Invalid email').optional().or(z.literal('')),
```

This looks strange. Here's why.

When a user submits an HTML form without filling in an optional field, `FormData.get('email')` returns **`''` (empty string)**, not `null` or `undefined`. The HTML spec — this has been the case forever.

Zod's `.optional()` means "may be `undefined`." It does **not** mean "may be an empty string." So `z.string().email().optional()` alone would reject `''`:

- `''` is a string (passes `z.string()`).
- `''` fails the email regex (fails `.email()`).
- `''` is not `undefined` (so `.optional()` doesn't help).

The fix: `.or(z.literal(''))` — "must be a valid email, OR the literal empty string." Empty strings now pass; we'll convert them to `null` before insert.

**Why not `.nullable()`?** Because `FormData` never gives you `null` for an empty field — always `''`. We'd never see a `null`.

---

## Step 2 — The Form Action

Add the `actions` export below the schema:

```typescript
export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Unauthorized');

		const formData = await request.formData();

		const raw = {
			first_name: formData.get('first_name'),
			last_name: formData.get('last_name'),
			email: formData.get('email') || '',
			phone: formData.get('phone') || '',
			company: formData.get('company') || ''
		};

		const result = contactSchema.safeParse(raw);

		if (!result.success) {
			return fail(400, {
				error: result.error.issues[0]?.message,
				data: raw
			});
		}

		const { error: insertError } = await locals.supabase.from('contacts').insert({
			...result.data,
			user_id: user.id,
			email: result.data.email || null,
			phone: result.data.phone || null,
			company: result.data.company || null
		});

		if (insertError) {
			return fail(500, { error: 'Failed to create contact. Please try again.' });
		}

		redirect(303, '/contacts');
	}
};
```

Let's walk through each block.

### The signature

```typescript
default: async ({ request, locals }) => {
```

- `default` — the action that runs when a form submits without an explicit `?/name`. Most forms use `default`.
- `{ request, locals }` — SvelteKit's context. `request` is the native `Request` object; `locals` is per-request state populated in `hooks.server.ts` (notably `locals.supabase` and `locals.getUser()`).

### The authorization gate

```typescript
const user = await locals.getUser();
if (!user) error(401, 'Unauthorized');
```

Before reading form data, before touching the DB: _who is submitting?_ No user → 401.

The `(app)` layout already blocks unauthenticated navigation, so why re-check? Two reasons: (1) the action is a separate HTTP endpoint reachable directly via `curl` or `fetch` — never assume upstream code ran, and (2) we need `user.id` anyway to set `user_id` on the row.

**Why `error()` and not `fail()`?** `fail` is for user-fixable problems (wrong password). `error` is for "the system shouldn't be in this state." An unauthenticated user hitting an authenticated endpoint is the latter.

### Reading the form data

```typescript
const formData = await request.formData();

const raw = {
	first_name: formData.get('first_name'),
	last_name: formData.get('last_name'),
	email: formData.get('email') || '',
	phone: formData.get('phone') || '',
	company: formData.get('company') || ''
};
```

- `await request.formData()` — parses the POST body. A web standard API.
- `formData.get('first_name')` — returns the field value, or `null` if missing. Empty text fields return `''`.

Why `|| ''` on optional fields? If an attacker POSTs without the `email` field at all, `formData.get('email')` returns `null`. Zod's `z.string()` rejects `null` outright. The `|| ''` fallback turns `null` into `''`, which our schema handles via `.or(z.literal(''))`. The form is now robust to both "missing entirely" and "present but blank."

We don't apply `|| ''` to `first_name`/`last_name`. Those are required — we _want_ Zod to reject a missing value.

### Validation

```typescript
const result = contactSchema.safeParse(raw);

if (!result.success) {
	return fail(400, {
		error: result.error.issues[0]?.message,
		data: raw
	});
}
```

- `safeParse(raw)` — like `parse(raw)` but never throws. Returns `{ success: true, data }` or `{ success: false, error }`.
- `result.error.issues[0]?.message` — Zod collects _all_ problems in `issues`. We show only the first. Stacking "First name is required. Last name is required. Email is invalid." creates decision paralysis; per-field inline errors are a Module 11 upgrade.
- `data: raw` — we echo the raw values back so `+page.svelte` can repopulate. No passwords here, so echoing everything is safe.

### The insert — and where authorization belongs

```typescript
const { error: insertError } = await locals.supabase.from('contacts').insert({
	...result.data,
	user_id: user.id,
	email: result.data.email || null,
	phone: result.data.phone || null,
	company: result.data.company || null
});
```

- `locals.supabase` — the per-request client from `hooks.server.ts`. Reads the user's auth cookies; RLS policies apply.
- `{ ...result.data, user_id: user.id, ... }` — spread the validated data, then override with server-derived values. **Order matters**: even if someone forged a `user_id` field in the form, Zod would strip it (our schema doesn't declare it), and the explicit `user_id: user.id` at the bottom would overwrite anything that snuck through.

**Why override `email`/`phone`/`company` again?** Zod's output for an optional-or-empty field is still a string — either a valid email or `''`. We want `null` in the database for "no value," not `''`. Queries like `WHERE email IS NOT NULL` would otherwise match `''` rows, and unique indexes would collide across users with empty fields.

### Why user_id must come from the session

This is the most important security rule in this lesson. Read slowly.

Imagine `user_id` came from a hidden input in the form:

```html
<!-- NEVER DO THIS -->
<input type="hidden" name="user_id" value="{currentUserId}" />
```

Here's the attack:

1. Alice logs in, opens DevTools, finds that hidden input.
2. Alice looks up Bob's user ID (she saw it in a shared URL, scraped it from a public profile).
3. Alice edits the hidden input's value from her ID to Bob's.
4. Alice submits. Our server reads `formData.get('user_id')`, gets Bob's ID, and inserts a row with `user_id = bob`.

Alice just created a contact in Bob's account. In a richer app (billing, messaging), Alice could forge actions _on behalf of_ Bob.

**"But RLS would reject it, right?"** Depends. RLS policies scope `contacts` to `auth.uid() = user_id`. With the anon-key client bound to Alice's cookies, `auth.uid()` returns Alice's ID — inserting `user_id = bob` violates the policy. Blocked.

**But that's fragile.** If anyone ever swaps `locals.supabase` for a service-role client (say, a batch import script), the RLS check is gone and Alice's forgery succeeds. The app is one thoughtless refactor away from exploitable.

**The robust rule: derive `user_id` from the verified session, every single time.** Never accept it from the client. Not via hidden input, not via query param, not via JSON body. The only source of truth is `locals.getUser()`, which verifies the session cookie on every call.

RLS is a _fence_, but it can be torn down by a teammate who doesn't know what it's protecting. Deriving `user_id` server-side is a _design principle_ that survives refactors. Use both — fence and principle — and sleep better.

### Insert error handling and redirect

```typescript
if (insertError) {
	return fail(500, { error: 'Failed to create contact. Please try again.' });
}

redirect(303, '/contacts');
```

If Supabase errors, we surface a generic message — we don't leak raw SQL errors to the UI.

- `303 See Other` is the right status for POST/Redirect/GET. The browser makes a `GET /contacts`, so refreshing the list page is an idempotent reload, not a duplicate submission.
- `redirect()` throws internally; no code after it runs. You don't need to `return` it.

---

## Step 3 — The Form UI

Open `src/routes/(app)/contacts/new/+page.svelte`:

```svelte
<!-- src/routes/(app)/contacts/new/+page.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let submitting = $state(false);
</script>

<div class="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-gray-900">New contact</h1>
		<p class="mt-1 text-sm text-gray-500">Add someone to your Contactly address book.</p>
	</div>

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		{#if form?.error}
			<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
				{form.error}
			</div>
		{/if}

		<div class="space-y-4">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="first_name" class="mb-1 block text-sm font-medium text-gray-700">
						First name <span class="text-red-500">*</span>
					</label>
					<input
						id="first_name"
						name="first_name"
						type="text"
						required
						maxlength="100"
						value={form?.data?.first_name ?? ''}
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
						placeholder="Ada"
					/>
				</div>

				<div>
					<label for="last_name" class="mb-1 block text-sm font-medium text-gray-700">
						Last name <span class="text-red-500">*</span>
					</label>
					<input
						id="last_name"
						name="last_name"
						type="text"
						required
						maxlength="100"
						value={form?.data?.last_name ?? ''}
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
						placeholder="Lovelace"
					/>
				</div>
			</div>

			<div>
				<label for="email" class="mb-1 block text-sm font-medium text-gray-700">
					Email <span class="font-normal text-gray-400">(optional)</span>
				</label>
				<input
					id="email"
					name="email"
					type="email"
					maxlength="255"
					value={form?.data?.email ?? ''}
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
					placeholder="ada@example.com"
				/>
			</div>

			<div>
				<label for="phone" class="mb-1 block text-sm font-medium text-gray-700">
					Phone <span class="font-normal text-gray-400">(optional)</span>
				</label>
				<input
					id="phone"
					name="phone"
					type="tel"
					maxlength="50"
					value={form?.data?.phone ?? ''}
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
					placeholder="+1 555 0100"
				/>
			</div>

			<div>
				<label for="company" class="mb-1 block text-sm font-medium text-gray-700">
					Company <span class="font-normal text-gray-400">(optional)</span>
				</label>
				<input
					id="company"
					name="company"
					type="text"
					maxlength="200"
					value={form?.data?.company ?? ''}
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
					placeholder="Analytical Engines Inc."
				/>
			</div>

			<div class="flex items-center gap-3 pt-2">
				<button
					type="submit"
					disabled={submitting}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
				>
					{submitting ? 'Saving...' : 'Create contact'}
				</button>
				<a href="/contacts" class="text-sm font-medium text-gray-600 hover:text-gray-900">
					Cancel
				</a>
			</div>
		</div>
	</form>
</div>
```

### The script block

- `enhance` upgrades a plain HTML form into AJAX-style submission without losing the no-JS fallback.
- `ActionData` is auto-generated from the action's return values — `form.error` and `form.data.first_name` are fully typed.
- `$props()` (Svelte 5 runes) destructures the props object. SvelteKit injects the action result into `form`.
- `$state(false)` makes `submitting` reactive — mutate it and the template re-renders.

### `use:enhance` with a submitting state

```svelte
<form
  method="POST"
  use:enhance={() => {
    submitting = true
    return async ({ update }) => {
      await update()
      submitting = false
    }
  }}
>
```

**Before submit:** the outer function runs the instant the form starts submitting. `submitting = true` flips the button to "Saving..." and disables it.

**After response:** the returned inner function runs after the server responds. `await update()` triggers SvelteKit's default handling (apply the response, set `form`, follow redirects). Then `submitting = false` re-enables the button if we're still on the page.

**Why call `update()` manually?** Returning an inner function tells SvelteKit you're taking over — it skips its defaults. Without `update()`, a failed submission wouldn't set `form` and the error banner wouldn't appear.

On successful redirect, the page navigates away and the component unmounts — the `submitting = false` line runs harmlessly on a dying component.

### The rest of the template

- `{#if form?.error}` — optional chaining safely handles the initial load when `form` is `null`.
- `grid grid-cols-1 sm:grid-cols-2` stacks names vertically on mobile, side-by-side on `sm` and up.
- `value={form?.data?.first_name ?? ''}` repopulates fields on validation failure; on fresh load the chain short-circuits to `''`.
- Red asterisk on required fields, `(optional)` label on optional ones — pick one convention, stick with it.
- Cancel is an `<a>`, not a `<button>` — it navigates, doesn't submit. Free right-click, keyboard, and screen-reader semantics.
- `disabled={submitting}` prevents double-submission from fast double-clickers.

---

## Testing the Flow

```bash
pnpm dev
```

Visit `http://localhost:5173/contacts` → click **New contact**.

**Happy path:** type `Ada` / `Lovelace`, leave optionals blank, submit. Button flashes "Saving..." then redirects to `/contacts`. In Supabase Studio, your new row shows `user_id` = your auth ID, and `email`/`phone`/`company` = `NULL` (not `''`).

**Required field validation:** leave first name empty. The browser's native `required` blocks submission with a tooltip — no server round-trip.

**Server-side validation:** in DevTools, remove the `required` attribute from first_name. Submit empty. The page re-renders with "First name is required" in the red banner, other fields repopulated. Client validation is a convenience; server validation is the defense.

**RLS spot-check (optional):** in Studio's SQL Editor, `SELECT * FROM contacts WHERE user_id != auth.uid();` — zero rows. Your new row is invisible to every other user.

---

## Common mistakes

- **`user_id` in a hidden form field.** Collapses the "trust only the session" principle. Derive `user_id` from `locals.getUser()`, every time.
- **Using `getSession()` instead of `getUser()`.** `getSession()` reads cookies but doesn't verify them with Supabase. In a write action, always use `getUser()`.
- **Forgetting `.or(z.literal(''))` on optional fields.** `.optional()` accepts `undefined`, not `''`. FormData gives `''`. Without the `.or()`, optional blank fields fail validation.
- **Inserting empty strings instead of `null`.** Pollutes the DB and breaks unique indexes. Always convert `''` → `null` before insert.
- **Returning `{ error }` without `fail(400, ...)`.** SvelteKit treats a plain return as success (status 200). Always wrap errors in `fail(status, payload)`.
- **Forgetting `method="POST"`.** GET forms submit to a query string and don't trigger form actions.
- **Skipping `use:enhance`.** Form still works, but every submit becomes a full page reload — no "Saving..." state, no smooth UX.
- **Forgetting `await update()` in the enhance callback.** Return an inner function and SvelteKit skips its default handling. Without `update()`, `form` never sets and errors vanish.
- **`redirect()` inside `try/catch`.** `redirect()` throws internally. Catch-all blocks swallow it. Only catch specific errors.

---

## Principal Engineer notes

1. **Verb-noun URLs over REST verbs.** Routes are `contacts/new`, not `contacts/create`. URLs users see in their address bar should read like prose; REST verbs (`POST /contacts`) belong to APIs, not browsable pages.

2. **Defense in depth for `user_id`.** Three independent layers: (a) the `(app)` layout blocks unauthenticated requests, (b) the action re-checks with `locals.getUser()` before any DB write, (c) RLS rejects any insert where `user_id != auth.uid()`. Any single layer failing doesn't break the system. Standard for multi-tenant SaaS.

3. **Schema-driven validation.** The Zod schema is the single source of truth for "what a valid contact input looks like." Colocated today; later you'll promote it to `src/lib/schemas/` and share it with a CSV importer, a Stripe webhook, a JSON API — all validating the same shape.

4. **POST/Redirect/GET is structural, not stylistic.** After every successful write, redirect to a GET. A refresh should reload the list (harmless), not re-submit the form (duplicates). This is why `redirect(303, ...)` matters even when it feels like ceremony.

5. **Form actions are public HTTP endpoints.** Reachable via `fetch('/contacts/new', { method: 'POST', body: formData })` from any client — mobile app, cURL, malicious script. Write validation and authorization as if the UI doesn't exist. One day, it might not.

6. **Type-safety at the boundary.** TypeScript verifies calls inside your code; at the HTTP boundary it tells you nothing — the client can send anything. Zod is TypeScript's runtime counterpart: it enforces at the boundary what TypeScript enforces statically inside.

7. **`locals.supabase` is per-request.** Instantiated in `hooks.server.ts` with the current user's cookies. Two concurrent requests from different users get different instances. Never cache or reuse across requests — you'd leak auth between users.

---

## What's next

Lesson 4.4 wires this page into the full flow: an empty state on `/contacts` when the user has no contacts yet, a live count, and click-through to the contact detail page. You'll also see how `invalidate()` tells SvelteKit to re-fetch a `load` function after a mutation — useful when you don't want to redirect.
