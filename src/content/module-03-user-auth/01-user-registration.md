---
title: '3.1 - User Registration'
module: 3
lesson: 1
moduleSlug: 'module-03-user-auth'
lessonSlug: '01-user-registration'
description: 'Build a user registration form using SvelteKit form actions and Supabase Auth signUp.'
duration: 15
preview: false
---

## Overview

This lesson builds Contactly's first real feature — a working registration page. By the end, a visitor can type their name, email, and password into a form, hit "Create account," and a new user will exist in Supabase Auth with a matching profile row created by the trigger you wrote in Module 1.

Along the way you'll learn **route groups**, **form actions**, **progressive enhancement**, and **server-side validation** — four patterns you'll use on every feature for the rest of the course.

## Prerequisites

- Module 2 complete — Contactly has a server-side Supabase client in `hooks.server.ts`, a client-side Supabase client in the root layout, and `event.locals.getUser()` available to server code.

## What You'll Build

- A `(auth)` route group with a minimal centered layout (no navbar, no chrome).
- A fully working registration page at `/register` with name, email, and password fields.
- A server-side form action that validates input with Zod v4, calls `supabase.auth.signUp()`, and redirects the new user to `/dashboard`.
- Clean error handling: users see clear messages and keep their typed values if something goes wrong.

---

## Route Groups — What They Are and Why They're Brilliant

SvelteKit lets you wrap folders in parentheses to create a **route group**. A folder named `(auth)` is a group; a folder named `(marketing)` is another. The name inside the parentheses **does not** show up in the URL.

```
src/routes/
├── (auth)/
│   ├── +layout.svelte     ← layout for auth pages (login, register, forgot-password)
│   ├── login/+page.svelte → URL: /login
│   └── register/+page.svelte → URL: /register
├── (app)/
│   ├── +layout.svelte     ← layout for authenticated pages
│   └── dashboard/+page.svelte → URL: /dashboard
└── +page.svelte → URL: /
```

Notice `login` and `dashboard` don't get `/(auth)/` or `/(app)/` in their URLs — just `/login` and `/dashboard`.

**Why groups exist:** they let you give different parts of your app different layouts without changing the URL structure. The registration page should have a centered, minimal look — no navbar, no footer, no chrome. The dashboard should have a full navbar and a sidebar. Without groups, you'd have to either duplicate the layout logic or conditionally render everything based on the URL — both are messy. Groups let you express "these routes share this layout" as a folder structure.

Rule: **every group has its own `+layout.svelte` (or `+layout.server.ts`) that applies to every route inside it.** The root `+layout.svelte` still wraps everything (it's always the outermost wrapper); the group layout wraps inside it.

### Creating the `(auth)` group layout

Create the folder and layout:

```bash
mkdir -p src/routes/\(auth\)/register
```

(The backslashes are there because parentheses are special characters in some shells. On some shells you may not need them.)

Create `src/routes/(auth)/+layout.svelte`:

```svelte
<!-- src/routes/(auth)/+layout.svelte -->
<script lang="ts">
	let { children } = $props();
</script>

<main class="flex min-h-screen items-center justify-center bg-gray-50">
	<div class="w-full max-w-md px-4">
		{@render children()}
	</div>
</main>
```

**Walkthrough:**

- **`let { children } = $props()`** — destructures the `children` snippet from the layout's props. `children` represents the current page being rendered inside this layout.
- **`<main class="min-h-screen flex items-center justify-center bg-gray-50">`** — a Tailwind-powered container. `min-h-screen` makes the container at least as tall as the browser viewport; `flex items-center justify-center` centers the child horizontally and vertically.
- **`<div class="w-full max-w-md px-4">`** — caps the inner width at the Tailwind `md` breakpoint (448px) so forms don't stretch too wide on large screens.
- **`{@render children()}`** — inserts the page content here.

With this layout in place, every route inside `(auth)/` (login, register, forgot-password) gets the same centered, chromeless appearance.

---

## A Quick Primer on Form Actions — SvelteKit's Killer Feature

In the traditional frontend world, a "form" is a block of JSX, a `submit` handler in JavaScript, an `await fetch('/api/register', ...)` call, error state in a React hook, a success redirect via client-side router. A dozen moving pieces. When any one breaks (JS hasn't loaded yet, the API route is wrong, the browser has an old cached bundle), the whole flow breaks.

SvelteKit does it differently. A form action is just a **function exported from `+page.server.ts`**. It receives the form data. It returns either success or failure. SvelteKit handles the rest: submitting the form, re-rendering the page with the result, preserving input on error.

This approach has three huge benefits:

1. **Works without JavaScript.** A plain `<form method="POST">` submits even if the JS bundle fails to load — browsers have been submitting forms since 1993. Your users aren't trapped by a blank page when something's off.
2. **Progressive enhancement.** Add `use:enhance` to the form and SvelteKit layers in an AJAX-like experience (no full page reload, nicer error display) without losing the no-JS fallback.
3. **Server-side validation is the default.** The action runs on the server. It has access to the database, environment secrets, and session cookies. It can't be bypassed by a malicious client.

You'll use this pattern for **every** user-input feature in Contactly.

---

## The Registration Page Markup

Create `src/routes/(auth)/register/+page.svelte`:

```svelte
<!-- src/routes/(auth)/register/+page.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
	<h1 class="mb-2 text-2xl font-bold text-gray-900">Create your account</h1>
	<p class="mb-6 text-gray-500">Start managing your contacts today</p>

	<form method="POST" use:enhance>
		{#if form?.error}
			<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
				{form.error}
			</div>
		{/if}

		<div class="space-y-4">
			<div>
				<label for="full_name" class="mb-1 block text-sm font-medium text-gray-700">
					Full name
				</label>
				<input
					id="full_name"
					name="full_name"
					type="text"
					required
					value={form?.data?.full_name ?? ''}
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
					placeholder="John Doe"
				/>
			</div>

			<div>
				<label for="email" class="mb-1 block text-sm font-medium text-gray-700">
					Email address
				</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					value={form?.data?.email ?? ''}
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
					placeholder="john@example.com"
				/>
			</div>

			<div>
				<label for="password" class="mb-1 block text-sm font-medium text-gray-700">
					Password
				</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
					placeholder="At least 8 characters"
				/>
			</div>

			<button
				type="submit"
				class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
			>
				Create account
			</button>
		</div>
	</form>

	<p class="mt-6 text-center text-sm text-gray-500">
		Already have an account?
		<a href="/login" class="font-medium text-blue-600 hover:underline">Log in</a>
	</p>
</div>
```

### Walkthrough

#### The script block

```typescript
import { enhance } from '$app/forms';
import type { ActionData } from './$types';

let { form }: { form: ActionData } = $props();
```

- **`enhance` from `$app/forms`** — the progressive enhancement helper. Applied to a form with `use:enhance`, it intercepts submission and handles it with `fetch()` — no full page reload, smoother experience, still works if JS is disabled.
- **`ActionData`** — a type automatically generated by SvelteKit based on what your form action returns. It includes every field you put in the `fail()` or returned success object.
- **`let { form }: { form: ActionData } = $props()`** — SvelteKit passes the action result to the component as a prop called `form`. It's `null` on fresh page loads, and populated after a form submission.

#### The error banner

```svelte
{#if form?.error}
	<div class="bg-red-50 ...">
		{form.error}
	</div>
{/if}
```

`form?.error` uses **optional chaining** — if `form` is null, the whole expression is null (falsy) and the banner isn't rendered. If the action returned `{ error: 'Something went wrong' }`, the banner shows that message.

#### The form tag

```svelte
<form method="POST" use:enhance>
```

- **`method="POST"`** — non-negotiable for actions. SvelteKit only handles POST, PUT, PATCH, DELETE as actions — GET is reserved for navigation.
- **`use:enhance`** — enables progressive enhancement (JS-assisted submission).
- **No `action=""` attribute** — the form submits to the current URL's default action.

#### Input value repopulation

```svelte
<input name="full_name" value={form?.data?.full_name ?? ''} ... />
```

When the action returns `fail(400, { data: { full_name, email } })`, that `data` object becomes `form.data`. We read it back here with the `value` binding. If the user typed "Ada Lovelace" and the action failed, their name remains in the field after the page re-renders. If it's a fresh load, `form?.data?.full_name` is undefined, and `?? ''` provides an empty default.

**Important: we deliberately don't repopulate the password field.** Repopulating passwords into a rendered HTML response introduces unnecessary exposure (browser history, page source). Users re-type it if needed. That's the web-security-101 convention.

---

## The Server-Side Form Action

Create `src/routes/(auth)/register/+page.server.ts`:

```typescript
// src/routes/(auth)/register/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions } from './$types';

// Zod v4 schema describing the shape and rules for valid registration input.
const registerSchema = z.object({
	full_name: z.string().min(2, 'Name must be at least 2 characters'),
	email: z.string().email('Please enter a valid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters')
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = await request.formData();

		const raw = {
			full_name: formData.get('full_name'),
			email: formData.get('email'),
			password: formData.get('password')
		};

		// Validate the raw form fields against the schema.
		const result = registerSchema.safeParse(raw);

		if (!result.success) {
			// `fail(400, ...)` returns a 400 Bad Request. The returned object
			// becomes `form` on the page — we include the first error message and
			// the user's typed values (minus password) so the form can repopulate.
			return fail(400, {
				error: result.error.issues[0]?.message ?? 'Invalid input',
				data: { full_name: raw.full_name, email: raw.email }
			});
		}

		const { full_name, email, password } = result.data;

		// Call Supabase Auth. The handle_new_user() trigger you wrote in Lesson 1.4
		// will fire on the auth.users insert and auto-create the matching
		// public.profiles row with full_name populated from raw_user_meta_data.
		const { error } = await locals.supabase.auth.signUp({
			email,
			password,
			options: {
				data: { full_name }
			}
		});

		if (error) {
			return fail(400, {
				error: error.message,
				data: { full_name, email }
			});
		}

		// Redirect to the dashboard using the POST/Redirect/GET pattern.
		// 303 See Other ensures the browser navigates with a GET, so a refresh
		// won't resubmit the form.
		redirect(303, '/dashboard');
	}
};
```

### Breaking Down Each Decision

#### Zod validation

```typescript
const registerSchema = z.object({
	full_name: z.string().min(2, 'Name must be at least 2 characters'),
	email: z.string().email('Please enter a valid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters')
});
```

[Zod](https://zod.dev) is a TypeScript-first schema validation library. We use it everywhere in Contactly to validate input at the server boundary. Two features we rely on:

- `z.object({ ... })` — describes an object with specific fields. Unknown fields are ignored by default.
- Chained methods (`.email()`, `.min(n)`) — constraints with per-field error messages.

**Why import as `import * as z from 'zod'`?** That's the **Zod v4** import style. Older Zod v3 code uses `import { z } from 'zod'`, but v4 explicitly recommends the namespace import for tree-shaking and ESM compatibility. Our Contactly `package.json` declares Zod v4; always use the v4 import style.

#### `safeParse` vs `parse`

```typescript
const result = registerSchema.safeParse(raw);
if (!result.success) {
	/* handle errors */
}
```

Zod offers two validation methods:

- `.parse(value)` — returns the validated value on success, **throws** on failure.
- `.safeParse(value)` — returns `{ success: true, data }` or `{ success: false, error }` — never throws.

We use `safeParse` in form actions because we want to hand the user a friendly error message rather than crashing the server. `parse` is fine when you expect the value to always be valid (e.g., reading from your own database).

#### `fail()` — the typed error return

```typescript
return fail(400, {
	error: result.error.issues[0]?.message ?? 'Invalid input',
	data: { full_name: raw.full_name, email: raw.email }
});
```

`fail(status, payload)` is SvelteKit's way to return a **user-handling** error from an action. It:

- Sets the HTTP status to the provided code (400 for bad input, 403 for forbidden, etc.).
- Serializes the payload to the page as `form`.
- Tells the browser to re-render the same page, not navigate away.

Unlike `redirect()` or `error()`, `fail()` doesn't throw — it's a normal return. The caller (SvelteKit) knows what to do with it.

**Why include `data`?** So we can repopulate the form fields. A rejected registration with no input preserved is a terrible user experience.

#### The Supabase signUp call

```typescript
const { error } = await locals.supabase.auth.signUp({
	email,
	password,
	options: {
		data: { full_name }
	}
});
```

- `locals.supabase` is the per-request Supabase client wired up in `hooks.server.ts`.
- `.auth.signUp()` creates a new `auth.users` row. Password hashing, email format validation, and (if configured) confirmation email dispatch all happen inside Supabase.
- `options.data` is a free-form JSON blob stored in `raw_user_meta_data`. Our `handle_new_user()` trigger reads it to populate `profiles.full_name`.

If signup fails — email already taken, weak password, anything — the function returns an `{ error }` object we translate to `fail()`.

#### `redirect(303, '/dashboard')`

```typescript
redirect(303, '/dashboard');
```

- `303 See Other` is the HTTP status for **POST/Redirect/GET**. The browser responds with GET to the new URL. If the user hits refresh on `/dashboard` later, they just reload it — they don't accidentally resubmit the registration.
- Despite the name, `redirect()` throws internally; control flow never continues after it. You don't need to `return` it.

---

## Testing the Flow

Boot the dev server:

```bash
pnpm dev
```

Visit `http://localhost:5173/register`. You should see the centered registration form.

**Happy path:**

1. Enter a name, email, and password (≥8 chars).
2. Click **Create account**.
3. You're redirected to `/dashboard`. (It doesn't exist yet — that's a 404. We'll build it in the next lesson's scope.)

**Validation error (client):**

1. Leave the password field blank.
2. Click **Create account**.
3. The browser's native `required` attribute stops submission with a tooltip. Client-side validation, for free.

**Validation error (server):**

1. Enter a name, email, and a 3-character password (the browser allows anything non-empty).
2. Click **Create account**.
3. The page re-renders with "Password must be at least 8 characters" in a red banner. Name and email are still in the fields.

**Supabase error:**

1. Register once with `test@example.com`.
2. Try to register again with the same email.
3. The page re-renders with Supabase's error message (e.g., "User already registered").

**Verify in Studio:**

1. Open `http://localhost:54323`.
2. Authentication → Users. Your new user is there.
3. Table Editor → profiles. A matching profile row is there with `full_name` populated.

The trigger you wrote in Lesson 1.4 just earned its keep.

---

## Common Mistakes

- **Forgot `<script lang="ts">`** — TypeScript won't check the file. Add `lang="ts"`.
- **Misspelled `name` attribute** — `name="fullName"` in the input but `formData.get('full_name')` in the action. `FormData` uses the HTML `name`; keep them matching.
- **Returned `{ error }` without `fail(400, ...)`** — SvelteKit treats a plain return as success, so status is 200, and the banner won't render because success doesn't set a status. Always use `fail()` for failed validations.
- **Called `redirect()` inside a `try`/`catch`** — `redirect()` throws internally. Wrapping it in a catch-all swallows the redirect. Only catch specific error types.
- **Pasted the email validation as custom regex** — don't. `z.string().email()` uses a well-tested algorithm; regex emails are a notorious rabbit hole.

---

## Principal Engineer Notes

1. **Server-side validation is the only real validation.** Client-side checks (HTML `required`, JS validators) are **UX** features, not security. Any malicious user can open DevTools and submit whatever payload they want. Your server must validate every field, every time. Zod makes it cheap to do so.

2. **The POST/Redirect/GET pattern is not just a nicety.** It prevents duplicate submissions on refresh, protects against back-button replays, and keeps browser history clean. Every write-then-navigate flow in this course uses it.

3. **Separate the data layer from the presentation layer.** Our action's failure payload is `{ error, data }` — machine-readable, easy to test, decoupled from HTML. If we later wanted to add JSON API responses (mobile app?), the action's logic could stay; only the presentation would fork.

4. **Don't leak field-level validation through the UI.** We return only the first error in `result.error.issues[0]`. Showing "5 errors" with server-decided line numbers is rarely a better UX. Later you can add per-field error mapping (Module 11 spec) — but only when you've measured that it helps users.

5. **The trigger is doing heavy lifting.** Without the `handle_new_user` trigger, this action would need a follow-up insert: `supabase.from('profiles').insert({ id: newUser.id, email, full_name })`. That's another round-trip, another failure mode. Database triggers eliminate that complexity at the cost of making the rule slightly less visible in app code. Worth it here because the rule is truly universal ("every auth user has a profile").

---

## Summary

- Created the `(auth)` route group with a minimal centered layout for login/register pages.
- Understood that route groups don't appear in URLs but let you share layouts across sibling routes.
- Built the registration form UI with `<form method="POST" use:enhance>` — progressive enhancement with a no-JS fallback.
- Wrote a Zod v4 schema that enforces name length, valid email, and password length.
- Wrote the default form action that validates input, calls `supabase.auth.signUp()`, and redirects on success.
- Used `fail(400, ...)` to return validation errors alongside the user's typed values, so the form repopulates.
- Verified the `handle_new_user` trigger from Lesson 1.4 auto-creates the matching profile row.
- Internalized the POST/Redirect/GET pattern with `redirect(303, ...)`.

## Next Lesson

In lesson 3.2 you'll build the login page — similar structure, different action. You'll also learn a subtle security detail about **opaque login errors** ("Invalid email or password" vs. specific field errors) and how the `redirectTo` query parameter lets the login flow drop users back on the page they came from.
