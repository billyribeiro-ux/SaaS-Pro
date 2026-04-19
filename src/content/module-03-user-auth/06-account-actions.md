---
title: '3.6 - Account Actions (Update Profile + Password)'
module: 3
lesson: 6
moduleSlug: 'module-03-user-auth'
lessonSlug: '06-account-actions'
description: 'Add updateProfile and updatePassword named actions to the account page, with Zod v4 validation and a clean pattern for multiple forms on one page.'
duration: 25
preview: false
---

## Overview

The account page _shows_ the user's data. Now it needs to **let them change it**. A complete profile page has to let users:

1. Update their display name.
2. Change their password.

These sound like the same problem — "update a user field" — but they are actually _two very different problems_ at the system level. One touches a row in `public.profiles`; the other touches `auth.users.encrypted_password`, a field you can't even SELECT, let alone UPDATE, directly. One uses your RLS-protected `profiles` table; the other uses the Supabase Auth API. One is a regular data write; the other is a security-sensitive credential change.

This lesson teaches you the difference, the right tool for each, and a clean pattern for having **multiple forms on one page** without their error messages bleeding into each other.

By the end you will have:

- A `updateProfile` named action that validates input with Zod v4 and writes to `public.profiles`.
- A `updatePassword` named action that validates input with Zod v4 and writes through `supabase.auth.updateUser()`.
- A single `+page.svelte` that renders two forms, each with its own error messaging, using a `form` discriminator so messages target the right form.
- Confidence about when to use the auth API vs. direct table writes, and what defense-in-depth looks like for profile mutations.

## Prerequisites

- Lessons 3.4 and 3.5 complete — you have the `signout` action and the `load` + display on `/account`.
- Zod v4 installed in the project (check `package.json`: `"zod": "^4.x.x"`).
- Your schema has RLS policies allowing authenticated users to update their own `profiles` row (Module 1 created those).

## What You'll Build

- Two Zod v4 schemas: `updateProfileSchema` and `updatePasswordSchema`.
- Two named actions: `?/updateProfile` and `?/updatePassword`.
- A refactored `+page.svelte` with two independent forms, each showing success/error banners targeted to that form.

## Key Concepts

- **Profile metadata vs. auth credentials** — which table owns which field, and which API to use.
- **Zod v4 `.refine()` for cross-field validation** — ensuring `newPassword === confirmPassword`.
- **Multiple named actions on one page** — the `?/actionName` URL syntax.
- **The `form` discriminator pattern** — how to target error messages to the right form.
- **`page.form` vs. the page's `form` prop** — when to use each.
- **Why Supabase doesn't require the current password** — session as proof of identity, and when to add extra re-authentication anyway.
- **RLS as the final guard on writes, not just reads.**

---

## Step 1: Understand Where Each Field Lives

Before we touch any code, let's get crystal-clear on where profile fields live in the database.

### `auth.users` (Supabase-managed)

Every registered user has a row in `auth.users`. The important columns for us:

- `id` — UUID. The primary key. Everything else references this.
- `email` — the user's login email.
- `encrypted_password` — hashed password. **You can't read or write this directly.** Only the Supabase Auth API can.
- `raw_user_meta_data` — a free-form JSONB blob. We stored `{ full_name }` here during registration so the `handle_new_user` trigger could copy it into `profiles`.

### `public.profiles` (your table)

The `profiles` table you created in Module 1:

- `id` — UUID, foreign key to `auth.users.id`.
- `email` — mirror of `auth.users.email` (denormalized for easy access).
- `full_name` — the user's display name.
- `avatar_url` — profile picture URL.
- `created_at` / `updated_at` — audit timestamps.

### The Rule

> **Profile metadata** (name, avatar, bio, preferences) lives in `public.profiles` and is updated via standard Supabase table writes under RLS.
>
> **Auth credentials** (password, email, MFA) live in `auth.users` and are updated via `supabase.auth.updateUser(...)` — never direct SQL.

Why this split?

1. **Credentials are sensitive.** Passwords are hashed with strong adaptive algorithms (bcrypt-style). Emails trigger re-verification flows. Direct SQL writes would bypass all that. The auth API enforces it.
2. **Auth logic is intricate.** Updating a password invalidates refresh tokens, potentially triggers security emails, updates last-changed timestamps. You don't want to reimplement that.
3. **Supabase owns the `auth` schema.** Their migrations manage it. Don't write triggers or policies against it; they may be clobbered by future Supabase updates.

With this picture in your head, the two actions in this lesson make obvious sense.

---

## Step 2: Write the Zod Schemas

Open `src/routes/(app)/account/+page.server.ts`. At the top of the file (after the imports), we'll declare both schemas.

```typescript
// src/routes/(app)/account/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';

const updateProfileSchema = z.object({
	full_name: z
		.string()
		.min(1, 'Name is required')
		.max(100, 'Name must be 100 characters or fewer')
		.trim()
});

const updatePasswordSchema = z
	.object({
		currentPassword: z.string().min(1, 'Current password is required'),
		newPassword: z.string().min(8, 'New password must be at least 8 characters'),
		confirmPassword: z.string()
	})
	.refine((data) => data.newPassword === data.confirmPassword, {
		message: 'Passwords must match',
		path: ['confirmPassword']
	});
```

### Walkthrough

```typescript
import * as z from 'zod';
```

The Zod v4 namespace import style. Stick to this across every new schema in Contactly.

#### `updateProfileSchema`

```typescript
const updateProfileSchema = z.object({
	full_name: z
		.string()
		.min(1, 'Name is required')
		.max(100, 'Name must be 100 characters or fewer')
		.trim()
});
```

- **`z.string()`** — base rule: must be a string.
- **`.min(1, 'Name is required')`** — empty strings are rejected. After the `.trim()` runs, whitespace-only strings are also effectively empty.
- **`.max(100, ...)`** — caps the length. Why 100? Two reasons:
  - Database column sanity — even though Postgres `text` has no hard cap, absurdly long values bloat indexes, slow replication, and usually indicate an attack.
  - UI sanity — a 10,000-character "name" wrecks your layout.
  - Choose a number that's generous (enough for the longest real names: "Pablo Diego José Francisco de Paula Juan Nepomuceno María de los Remedios Cipriano de la Santísima Trinidad Ruiz y Picasso" — if you're curious, that's 94 characters) but finite.
- **`.trim()`** — Zod v4 strings support `.trim()` as a _transformation_. It strips leading/trailing whitespace _before_ validation. Users who accidentally pasted a trailing space get saved from an ugly profile; malicious users can't pad input to bypass length checks.

#### `updatePasswordSchema` — and `.refine()`

```typescript
const updatePasswordSchema = z
	.object({
		currentPassword: z.string().min(1, 'Current password is required'),
		newPassword: z.string().min(8, 'New password must be at least 8 characters'),
		confirmPassword: z.string()
	})
	.refine((data) => data.newPassword === data.confirmPassword, {
		message: 'Passwords must match',
		path: ['confirmPassword']
	});
```

The first three fields are plain `z.string()` rules — familiar. The interesting piece is `.refine()`.

- **`.refine(fn, opts)`** — a custom validation rule that runs _after_ per-field checks. It receives the parsed object and returns a boolean. `true` means "this passes"; `false` means "fail with the provided message."
- **`(data) => data.newPassword === data.confirmPassword`** — require that the confirmation matches the new password.
- **`path: ['confirmPassword']`** — this is the part beginners miss. Without `path`, Zod reports the error at the _root_ of the object, which makes it awkward to display next to the right form field. With `path: ['confirmPassword']`, the error is attached to `confirmPassword` — so if you ever rendered field-level errors, you'd put the "Passwords must match" message under the confirm input, which is where users expect it.

#### A note on password policy

"New password must be at least 8 characters" is a minimum. Real-world password policies are more nuanced (length > complexity per NIST guidance; avoiding known-bad passwords matters more than forced symbols). If you want to get fancier later, `zod-password-validation` and libraries like [zxcvbn](https://github.com/dropbox/zxcvbn) are what you'd reach for. Keep it simple here; iterate on the rule when you measure user behavior.

---

## Step 3: Write the `updateProfile` Action

Now we add the action. We append to the `actions` object you already have from Lessons 3.4 and 3.5:

```typescript
// Continuing src/routes/(app)/account/+page.server.ts

export const actions: Actions = {
	signout: async ({ locals }) => {
		await locals.supabase.auth.signOut();
		redirect(303, '/');
	},

	updateProfile: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) redirect(303, '/login');

		const formData = await request.formData();
		const raw = { full_name: formData.get('full_name') };

		const result = updateProfileSchema.safeParse(raw);
		if (!result.success) {
			return fail(400, {
				form: 'updateProfile' as const,
				error: result.error.issues[0]?.message ?? 'Invalid input',
				data: { full_name: raw.full_name }
			});
		}

		const { full_name } = result.data;

		const { error: dbError } = await locals.supabase
			.from('profiles')
			.update({ full_name })
			.eq('id', user.id);

		if (dbError) {
			return fail(400, {
				form: 'updateProfile' as const,
				error: 'Could not update your profile. Please try again.',
				data: { full_name }
			});
		}

		return {
			form: 'updateProfile' as const,
			success: true,
			message: 'Profile updated.'
		};
	}
};
```

### Walkthrough

#### Re-checking the user

```typescript
const user = await locals.getUser();
if (!user) redirect(303, '/login');
```

Same pattern as the `load`. Each action defends its own boundary.

#### Parsing the form data

```typescript
const formData = await request.formData();
const raw = { full_name: formData.get('full_name') };

const result = updateProfileSchema.safeParse(raw);
```

- **`request.formData()`** — the standard Web API for reading `multipart/form-data` or `application/x-www-form-urlencoded` bodies. `FormData#get(name)` returns `string | File | null` (we care about strings here).
- We build a plain object `raw` with just the fields we care about. Zod rejects anything extra by default — bonus protection if a malicious client stuffs junk into the form.

#### `fail()` with a `form` discriminator

```typescript
return fail(400, {
	form: 'updateProfile' as const,
	error: result.error.issues[0]?.message ?? 'Invalid input',
	data: { full_name: raw.full_name }
});
```

This is the important pattern for **multiple forms on one page**.

Without `form: 'updateProfile'`, both the profile form and the password form share the same `form` prop on the page. After submitting the profile form, the password form would also show the error banner (because it reads from the same prop). That's confusing.

With `form: 'updateProfile'`, the page can check `{#if form?.form === 'updateProfile' && form.error}` before rendering the banner — scoping the error message to its originating form.

Note the `as const`. Without it, TypeScript widens `'updateProfile'` to `string`, and downstream `form.form === 'updateProfile'` comparisons lose discriminant-based type narrowing. `as const` preserves the literal type so the discriminated union works cleanly.

#### The update query

```typescript
const { error: dbError } = await locals.supabase
	.from('profiles')
	.update({ full_name })
	.eq('id', user.id);
```

- **`.update({ full_name })`** — updates only the `full_name` column. Other columns are untouched. If you wrote `.update({ full_name, avatar_url: null })`, you'd nullify the avatar too. Only include fields you actually want to change.
- **`.eq('id', user.id)`** — filter to the current user's row. The RLS policy from Module 1 ("Users can update own profile") _also_ enforces this at the database level. Two barriers, one goal.
- We don't need `.select()` after the update because we don't use the returned row. If we wanted to, we could chain `.select().single()` to get the updated profile back.

#### The success return

```typescript
return {
	form: 'updateProfile' as const,
	success: true,
	message: 'Profile updated.'
};
```

A plain return (not wrapped in `fail()`) with status 200. The page sees this on the `form` prop with `form.success === true` and can show a success toast/banner.

**Important:** we _do not_ call `redirect(...)` here. Why not? Because we want the user to stay on the page and see their updated data. The load function re-runs after a successful action (SvelteKit calls `invalidateAll()` by default when `use:enhance` is active), so the new `full_name` is reflected.

---

## Step 4: Write the `updatePassword` Action

Append to the same `actions` object:

```typescript
// Continuing src/routes/(app)/account/+page.server.ts

updatePassword: async ({ request, locals }) => {
	const user = await locals.getUser();
	if (!user) redirect(303, '/login');

	const formData = await request.formData();
	const raw = {
		currentPassword: formData.get('currentPassword'),
		newPassword: formData.get('newPassword'),
		confirmPassword: formData.get('confirmPassword')
	};

	const result = updatePasswordSchema.safeParse(raw);
	if (!result.success) {
		return fail(400, {
			form: 'updatePassword' as const,
			error: result.error.issues[0]?.message ?? 'Invalid input'
		});
	}

	const { newPassword } = result.data;

	const { error: authError } = await locals.supabase.auth.updateUser({
		password: newPassword
	});

	if (authError) {
		return fail(400, {
			form: 'updatePassword' as const,
			error: authError.message
		});
	}

	return {
		form: 'updatePassword' as const,
		success: true,
		message: 'Password updated. You may need to sign in again on other devices.'
	};
};
```

### Walkthrough

Much of the structure is the same. The two parts worth exploring:

#### `supabase.auth.updateUser({ password })`

```typescript
const { error: authError } = await locals.supabase.auth.updateUser({
	password: newPassword
});
```

This is the Supabase Auth API call, not a `profiles` update. Behind the scenes:

1. The current session token (from `locals.supabase`'s cookie) identifies the user. Supabase already knows who you are.
2. The new password is hashed with Supabase's hashing algorithm and stored in `auth.users.encrypted_password`.
3. Supabase updates the `updated_at` column on `auth.users` and may trigger session-refresh behavior.
4. Any configured post-password-change hooks (email notifications, audit logs) fire.

You literally cannot do this with `.from('auth.users').update(...)` — the table is protected. The auth API is the only door.

#### Why doesn't Supabase require the current password?

This surprises many people. Look at what we passed: just `{ password: newPassword }`. No `currentPassword`. Our Zod schema collects it, but we never send it to Supabase.

**Supabase's reasoning:** the session cookie is already proof of identity. If a request can reach this action, the requester has proven — via a valid session — that they are the user. Requiring the current password on top is a form of re-authentication, and Supabase treats that as an app-level decision, not a platform-level one.

This is a defensible stance but has a nuance: **if an attacker gets a short window of access to your session** (you left your laptop open, a cross-site vulnerability leaked your token, etc.), they can change your password _without knowing your current one_. That locks you out of your own account.

### Adding a current-password check (optional hardening)

For a more hardened version, you'd verify `currentPassword` before calling `updateUser`:

```typescript
// Verify current password by attempting a sign-in
const { error: verifyError } = await locals.supabase.auth.signInWithPassword({
	email: user.email!,
	password: currentPassword
});
if (verifyError) {
	return fail(400, {
		form: 'updatePassword' as const,
		error: 'Current password is incorrect.'
	});
}
```

Tradeoffs:

- **Pro**: an attacker with only a session token can't change the password; a full take-over needs the real password.
- **Con**: it hits Supabase's auth endpoint twice per request (sign-in + update), which uses rate-limit budget and slows the action.
- **Con**: calling `signInWithPassword` creates a _new_ session token. You'd need to handle that (ignore it, or swap the new session in cleanly).

For this course, we keep the simpler version — the Zod schema still requires `currentPassword` as a form field, which prevents _accidental_ password changes (say, a kid at a keyboard mashing buttons). If you were building Contactly for a Fortune 500, you'd turn on the hardened check. For a course SaaS, simpler is fine.

#### The success message

```typescript
message: 'Password updated. You may need to sign in again on other devices.';
```

We telegraph a real consequence: changing your password typically invalidates refresh tokens on other devices (the default behavior for most auth providers, including Supabase). Users may find they get logged out of their phone or a second laptop. Telling them upfront is kinder than leaving them confused.

---

## Step 5: Update the Account Page to Render Both Forms

Now we need the `+page.svelte` to render two forms. This is where the `form` discriminator pays off.

Refactor `src/routes/(app)/account/+page.svelte`:

```svelte
<!-- src/routes/(app)/account/+page.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();

	const profile = $derived(data.profile);

	const joinedOn = $derived(
		profile?.created_at
			? new Date(profile.created_at).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				})
			: '—'
	);
</script>

<svelte:head>
	<title>Account — Contactly</title>
</svelte:head>

<section class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Your account</h1>
	<p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
		Manage your profile and credentials.
	</p>

	<!-- PROFILE DISPLAY + UPDATE FORM -->
	<div
		class="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
	>
		<h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Profile</h2>

		<dl class="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
			<div>
				<dt class="text-slate-500 dark:text-slate-400">Email</dt>
				<dd class="mt-1 font-medium text-slate-900 dark:text-slate-100">
					{profile?.email ?? '—'}
				</dd>
			</div>
			<div>
				<dt class="text-slate-500 dark:text-slate-400">Joined</dt>
				<dd class="mt-1 font-medium text-slate-900 dark:text-slate-100">{joinedOn}</dd>
			</div>
		</dl>

		<form method="POST" action="?/updateProfile" use:enhance class="mt-6">
			<label for="full_name" class="block text-sm font-medium text-slate-700 dark:text-slate-300">
				Full name
			</label>
			<input
				id="full_name"
				name="full_name"
				type="text"
				required
				maxlength="100"
				value={form?.form === 'updateProfile' && 'data' in form
					? (form.data?.full_name ?? '')
					: (profile?.full_name ?? '')}
				class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			/>

			{#if form?.form === 'updateProfile'}
				{#if 'error' in form && form.error}
					<p
						class="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
					>
						{form.error}
					</p>
				{:else if 'success' in form && form.success}
					<p
						class="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300"
					>
						{form.message}
					</p>
				{/if}
			{/if}

			<button
				type="submit"
				class="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				Save profile
			</button>
		</form>
	</div>

	<!-- PASSWORD FORM -->
	<div
		class="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
	>
		<h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">Change password</h2>
		<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
			Use at least 8 characters. You'll stay signed in on this device.
		</p>

		<form method="POST" action="?/updatePassword" use:enhance class="mt-4 space-y-3">
			<div>
				<label
					for="currentPassword"
					class="block text-sm font-medium text-slate-700 dark:text-slate-300"
				>
					Current password
				</label>
				<input
					id="currentPassword"
					name="currentPassword"
					type="password"
					required
					autocomplete="current-password"
					class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
				/>
			</div>

			<div>
				<label
					for="newPassword"
					class="block text-sm font-medium text-slate-700 dark:text-slate-300"
				>
					New password
				</label>
				<input
					id="newPassword"
					name="newPassword"
					type="password"
					required
					minlength="8"
					autocomplete="new-password"
					class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
				/>
			</div>

			<div>
				<label
					for="confirmPassword"
					class="block text-sm font-medium text-slate-700 dark:text-slate-300"
				>
					Confirm new password
				</label>
				<input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					required
					autocomplete="new-password"
					class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
				/>
			</div>

			{#if form?.form === 'updatePassword'}
				{#if 'error' in form && form.error}
					<p
						class="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
					>
						{form.error}
					</p>
				{:else if 'success' in form && form.success}
					<p
						class="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300"
					>
						{form.message}
					</p>
				{/if}
			{/if}

			<button
				type="submit"
				class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				Change password
			</button>
		</form>
	</div>
</section>
```

### Walkthrough — the new bits

#### Typing `form` with `ActionData`

```typescript
import type { ActionData, PageData } from './$types';

type Props = {
	data: PageData;
	form: ActionData;
};

let { data, form }: Props = $props();
```

`ActionData` is the union of every possible return shape from your actions — both `fail(...)` and plain returns — plus `null` (when no action has run). If you hover over `form` in your editor, you'll see something like:

```typescript
type ActionData =
	| null
	| { form: 'updateProfile'; error: string; data: { full_name: FormDataEntryValue | null } }
	| { form: 'updateProfile'; success: true; message: string }
	| { form: 'updatePassword'; error: string }
	| { form: 'updatePassword'; success: true; message: string };
```

TypeScript uses the `form` property as a **discriminant**. When you write `if (form?.form === 'updateProfile')`, inside that block TypeScript narrows the type to only the variants with that literal. That's why the `'data' in form` and `'error' in form` checks inside the branches work without extra casts.

#### Repopulating the profile input

```svelte
value={form?.form === 'updateProfile' && 'data' in form
	? (form.data?.full_name ?? '')
	: (profile?.full_name ?? '')}
```

Three cases:

1. **Fresh page load.** `form` is `null`. The outer ternary falls through to `profile?.full_name ?? ''` — the current value from the DB.
2. **Just submitted profile form, validation failed.** `form.form === 'updateProfile' && 'data' in form` is true; we use the user's typed value so they don't lose it.
3. **Just submitted password form.** `form.form === 'updatePassword'`, so the `=== 'updateProfile'` check is false; we fall through to the DB value. The profile input correctly ignores the password form's activity.

This is the whole reason for the `form` discriminator. Without it, cross-form leak: after a password submission, the profile input might blank out or show the password form's data.

#### Scoped banners

```svelte
{#if form?.form === 'updateProfile'}
	{#if 'error' in form && form.error}
		<p class="...red">{form.error}</p>
	{:else if 'success' in form && form.success}
		<p class="...green">{form.message}</p>
	{/if}
{/if}
```

Banners only render inside the `form === 'updateProfile'` block. The password form has its own, analogous block. Messages never cross.

The `'error' in form` and `'success' in form` checks are TypeScript narrowing idioms — they tell the compiler which variant of the discriminated union we're in, so `form.error` and `form.message` type-check without `!` or any.

#### `autocomplete` attributes on password fields

```svelte
<input type="password" autocomplete="current-password" ... />
<input type="password" autocomplete="new-password" ... />
```

The browser uses these hints for password managers:

- `current-password` on the verify field — password managers autofill the saved password.
- `new-password` on the new/confirm fields — password managers offer to _generate_ a strong password and save it.

Without these hints, password managers either guess wrong (autofilling the current password into the new-password field, which the user then mistakes for a saved suggestion) or fail to offer generation. Always set `autocomplete` correctly on password inputs.

#### Native validation attributes

- `required` on inputs — browser-native "can't submit empty."
- `maxlength="100"` on full_name — mirrors the Zod `.max(100)`.
- `minlength="8"` on new_password — mirrors Zod's `.min(8)`.

These are UX enhancements. They don't replace server-side validation (a malicious client strips them), but for honest users they provide instant feedback without a round-trip. Always keep the server-side rule as the authority.

---

## Step 6: Test the Full Flow

Start the dev server and verify each path.

### Happy path — update profile

1. `pnpm dev`, log in, visit `/account`.
2. Change "Full name" to something new. Click **Save profile**.
3. The page refreshes seamlessly (no full reload — `use:enhance`). A green "Profile updated." banner appears under the profile form.
4. The displayed name (in the DL above the form) updates to the new value. This works because SvelteKit re-runs `load` after a successful action with `use:enhance`, so `data.profile.full_name` is fresh.
5. The password form below shows **nothing** — no success, no error. Perfect scoping.

### Validation failure — empty name

1. Clear the name field. Click **Save profile**.
2. Your browser's native `required` blocks submission with a tooltip. (Remove `required` temporarily to test the server path — you'll see a red "Name is required" under the profile form.)

### Validation failure — non-matching passwords

1. In the password form, enter your current password, then `newpass123` and `newpass124`. Click **Change password**.
2. A red "Passwords must match" appears under the _password_ form. The profile form is untouched.

### Happy path — change password

1. Enter the real current password, a new password (≥8 chars), and its confirmation. Click **Change password**.
2. Green banner: "Password updated. You may need to sign in again on other devices."
3. Sign out. Try signing back in with the _old_ password → fails. Try the _new_ password → works.

### RLS defense-in-depth demo

1. Open DevTools → Console while logged in.
2. Try to update another user's profile directly:

   ```js
   const { error } = await window.supabase
   	.from('profiles')
   	.update({ full_name: 'Hacked' })
   	.eq('id', 'some-other-user-uuid');
   console.log(error);
   ```

3. You get `0 rows updated` — RLS silently filters out any row that doesn't match `auth.uid() = id`. Your action would too, thanks to `.eq('id', user.id)`. Two layers, both working.

---

## Common Mistakes

- **Using `.update(...)` without `.eq('id', user.id)`.** RLS would save you, but you're burning a defense-in-depth layer. Always scope the update explicitly.
- **Trying to update the password via `.from('auth.users').update(...)` or writing to `public.profiles.password`.** Auth credentials only update through `supabase.auth.updateUser()`. Never bypass.
- **Forgetting the `form` discriminator.** Error messages from the profile form appear under the password form, or vice versa. Always tag every `fail()` / return with `form: '<actionName>' as const`.
- **Letting `form.action` target a wrong action.** `<form action="?/updateProfile">` posts to `updateProfile`. If you accidentally write `action="?updateProfile"` (missing the slash) or `action="/updateProfile"` (treating it like a URL), SvelteKit routes it elsewhere and your action never runs.
- **Returning `redirect(303, '/account')` after a successful update.** Works, but it's redundant — `use:enhance` already re-runs the load function and re-renders the page. Redirecting triggers a _third_ load. Only redirect when you're sending the user to a different route.
- **Skipping `autocomplete="new-password"` and `current-password`**. Breaks password managers. Set them.
- **Sharing one Zod schema for two operations.** Tempting but wrong. Each action has its own valid input shape; combining them into `z.object({ full_name: z.string().optional(), password: z.string().optional() })` and inferring "which action" at runtime is messier and harder to type than two schemas.
- **Not handling the case where `form.data` is missing on a success return.** We _only_ include `data` in the failure branch (to re-populate). On success, there's no `data`. That's why we check `'data' in form` before reading `form.data?.full_name`.

---

## Principal Engineer Notes

1. **The `form` discriminator pattern scales.** This page has two forms; the pattern works exactly the same for three, five, or ten. Every action tags itself with `form: 'name' as const`; every banner checks `form?.form === 'name'`. It's a tiny bit of boilerplate that prevents an entire class of bugs (cross-form leak). Use it anytime you have more than one form on a page.

2. **Defense in depth for writes is non-negotiable.** On reads, RLS alone might be defensible. On writes — where the stakes are higher — always pair RLS with an explicit `.eq('id', user.id)`. Then also consider: what happens if a malicious user forges the form? They can only forge fields our Zod schema parses; unknown fields are dropped. They can try to bypass RLS; RLS stops them. They can race against other users; the filter stops cross-writes. Three layers, independent.

3. **Auth operations are audit-worthy.** Password changes should (in a real SaaS) trigger an email to the user: "Your password was changed on [device/IP] at [time]. If this wasn't you, click here to reset." Supabase has a built-in email hook for this — you can configure it in the Supabase dashboard → Authentication → Email Templates. Same for email changes, MFA changes, and account deletion. Don't ship auth mutations to production without audit emails; compromised accounts are much more recoverable when the real user gets notified immediately.

4. **Rate limiting matters on auth endpoints.** An attacker with a stolen session could call `updatePassword` rapidly to lock out the real user. Supabase has basic rate limiting on its auth endpoints, but at the Contactly level you'd also want a middleware-level limit on `POST /account?/updatePassword` (say, 3/minute per IP + user). You'll wire this in Module 11 using Upstash or a hook-based in-memory limiter.

5. **Never let users change their email without verification.** Supabase's `updateUser({ email })` _does_ send a confirmation email to the new address before applying the change. That's correct behavior. If you ever implement your own email-change flow, replicate this: require the user to click a link sent to the _new_ email before the change takes effect. Otherwise, a stolen session → email change → password reset is a total account takeover. This is why we don't expose an email-change form in this lesson — it deserves its own careful treatment.

6. **Why two separate actions, not one `updateAccount`?** You might be tempted to make a single form with optional fields (`full_name?`, `newPassword?`) and a single `update` action that handles whichever fields were submitted. Don't. Reasons:
   - **Separation of concerns.** Profile updates are cheap data writes; password updates are security-sensitive. Mixing them means one form's failure modes affect the other.
   - **Auditability.** A password change is a log-worthy event; a name change usually isn't. Different actions let you log at the right granularity.
   - **UX.** Two visually separate forms map to two mental actions. A combined form confuses users ("do I have to fill everything to save the name?").
   - **Rate limiting.** You want per-action rate limits (password updates capped, profile updates more permissive).

7. **The pattern generalizes beyond auth.** Every page in Contactly that does multiple things — say, a contact detail page with "update contact," "add tag," "delete" — will use the same pattern: multiple named actions, each with Zod validation, each returning a `form: 'actionName' as const` discriminator, each handled in its own `{#if form?.form === '...'}` block. You've learned the core SaaS CRUD pattern.

---

## Summary

- Understood the split between `public.profiles` (metadata, RLS-protected, direct SQL) and `auth.users` (credentials, Supabase Auth API only).
- Wrote two Zod v4 schemas — `updateProfileSchema` and `updatePasswordSchema` — using `.refine()` with `path: [...]` for cross-field password confirmation.
- Added two named actions on `/account/+page.server.ts`: `updateProfile` (writes to `profiles` table) and `updatePassword` (calls `supabase.auth.updateUser({ password })`).
- Learned the **`form` discriminator** pattern: each action returns `form: 'name' as const` so the UI can scope banners and input repopulation to the right form.
- Refactored `+page.svelte` with two independent forms, each with targeted error/success banners using `{#if form?.form === '...'}`.
- Covered password manager hints (`autocomplete="current-password"` / `"new-password"`) and the subtle reason Supabase doesn't require a current-password on `updateUser`.
- Reasoned through defense-in-depth for writes: `.eq('id', user.id)` _plus_ RLS, both enforcing "users can only update their own row."

## Next Lesson

Module 3 is now complete: register, log in, log out, display profile, update profile, change password, route guards, auth-aware navigation. In **Module 4** we'll leave auth behind and build Contactly's actual product — the **Contacts** feature: a table, a form to add contacts, edit and delete actions, plus a list view with filtering. You'll reuse every single pattern from this module (`fail`, `use:enhance`, Zod schemas, named actions, the `form` discriminator, RLS-protected queries) and add new ones: dynamic route params, confirmation dialogs, and pagination.
