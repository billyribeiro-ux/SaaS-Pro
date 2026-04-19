---
title: '3.2 - User Login'
module: 3
lesson: 2
moduleSlug: 'module-03-user-auth'
lessonSlug: '02-user-login'
description: 'Build a secure login page using signInWithPassword, with opaque errors, redirect handling, and already-logged-in UX.'
duration: 18
preview: false
---

## Overview

Registration gets users **into** your system. Login is how they come **back**. On the surface these two features look almost identical — an email, a password, a form action. Under the hood, login carries a different kind of weight. Every hostile actor on the internet — credential-stuffers, phishing operators, nation-state attackers — spends most of their energy attacking the login page. The way you design this one page decides whether your users' accounts are safe.

This lesson builds Contactly's login page and teaches three security-critical patterns you'll apply on every SaaS you ever build:

1. **Opaque error messages** — never tell an attacker whether the email or the password was wrong.
2. **Safe redirect handling** — honor `?redirectTo=/dashboard/contacts` query params without letting them become an open-redirect vulnerability.
3. **Already-logged-in UX** — if a signed-in user types `/login` into the address bar, don't make them stare at a login form they don't need.

By the end of the lesson, a user who registered in 3.1 can log out (we'll wire that up in 3.4), come back a week later, log in, and land exactly where they intended to go.

## Prerequisites

- Lesson 3.1 complete — Contactly has a working `/register` page, the `(auth)` route group layout, and the `handle_new_user` trigger auto-creating profile rows on signup.
- Your local Supabase is running (`pnpm db:start`) and you can register a new account.

## What You'll Build

- A `/login` page inside the `(auth)` route group with email + password fields.
- A server-side form action that calls `supabase.auth.signInWithPassword()`, validates with Zod v4, and redirects on success.
- A `load` function that auto-redirects signed-in users away from the login page.
- `redirectTo` query param handling, protected against open-redirect attacks.
- Opaque error handling that doesn't leak whether an account exists for a given email.

---

## The Threat Model — Why Login Is Different

Before we write a single line of code, let's think about who's reading your login page. You are. Your users are. And so are three kinds of adversary:

1. **Credential stuffers.** They've downloaded a list of 500 million email/password pairs leaked from other sites (LinkedIn, MyFitnessPal, Dropbox). They write a script that tries each pair against your login endpoint. If your site re-uses auth poorly, they'll take over thousands of accounts before you notice.
2. **Account enumerators.** They want a list of valid emails on your platform — which they'll sell for spam, phishing, or targeted social engineering. They try `ceo@yourcompany.com`, `admin@yourcompany.com`, a dictionary of first-name/last-name@common-domain.com. They don't need to log in; they just need to know "does this account exist?"
3. **Phishing operators.** They cloned your login page on `login-contactly.net`, emailed your users, and now they have passwords. You can't stop them directly, but you can make sure your login page doesn't help them refine their attack.

Every design decision in this lesson fights one of these three. Keep the list in mind as you read — I'll call out which adversary each pattern defeats.

---

## Step 1: Create the Login Page

We'll reuse the `(auth)` route group layout from 3.1, so the login page inherits the centered, chromeless container.

### Create the folder and files

```bash
mkdir -p src/routes/\(auth\)/login
```

Create two files:

- `src/routes/(auth)/login/+page.svelte` — the form
- `src/routes/(auth)/login/+page.server.ts` — the server logic

### The login form

`src/routes/(auth)/login/+page.svelte`:

```svelte
<!-- src/routes/(auth)/login/+page.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();

	let submitting = $state(false);
</script>

<div class="rounded-lg bg-white p-8 shadow-sm">
	<h1 class="mb-2 text-2xl font-semibold text-gray-900">Welcome back</h1>
	<p class="mb-6 text-gray-600">Sign in to your Contactly account.</p>

	{#if form?.error}
		<div
			class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="space-y-4"
	>
		<div>
			<label for="email" class="mb-1 block text-sm font-medium text-gray-700"> Email </label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.data?.email ?? ''}
				class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
			/>
		</div>

		<div>
			<label for="password" class="mb-1 block text-sm font-medium text-gray-700"> Password </label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
			/>
		</div>

		<button
			type="submit"
			disabled={submitting}
			class="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>

	<p class="mt-6 text-center text-sm text-gray-600">
		Don't have an account?
		<a href="/register" class="font-medium text-indigo-600 hover:text-indigo-700"> Create one </a>
	</p>
</div>
```

### Line-by-line walkthrough

**`import { enhance } from '$app/forms'`**
The `enhance` action is SvelteKit's progressive-enhancement helper. Without it, your `<form method="POST">` does a classic full-page submit: the browser navigates away, the server renders the new HTML, the browser reloads. With `use:enhance`, SvelteKit intercepts the submission, POSTs via `fetch`, and re-renders just the page component — no flash, no scroll-to-top. The form still works if JavaScript fails; `enhance` only **layers on** the nicer experience.

**`let { form } = $props()`**
In Svelte 5, props are destructured via the `$props()` rune. `form` is a special prop — it contains whatever your action returned via `fail(...)`, or `null` if no action has run (first page load, fresh reload after success, etc.). That's how we get `form.error` and `form.data.email` after a failed login.

**`let submitting = $state(false)`**
A reactive local variable for the "Signing in…" button state. `$state(...)` is Svelte 5's way of making a variable reactive — when `submitting` changes, the template re-renders. Under the hood it's a signal; assignments look like normal JS, but reads in the template are tracked.

**`{#if form?.error}` block**
We only render the red error banner when the action populated `form.error`. The `?.` (optional chaining) protects us from `form` being `null` on first load. `role="alert"` tells screen readers to announce the error as soon as it appears.

**The form element** — `method="POST"` is required. SvelteKit routes POSTs to the default action in `+page.server.ts`. No `action=` attribute means "POST to the current URL, default action." That's exactly what we want here.

**`use:enhance={() => { ... }}`**
The `enhance` action takes an optional callback that runs **before** submission. The callback can return another function that runs **after** the server responds. Here we set `submitting = true` before, then await `update()` (which applies the server's result to the page) and set `submitting = false` after. That's how the button toggles between "Sign in" and "Signing in…" while the request is in flight.

**`<input name="email" type="email" autocomplete="email">`**

- `name="email"` — this is the key the server sees in `formData.get('email')`. It must match the schema field name.
- `type="email"` — mobile keyboards switch to an email-optimized layout (`@` and `.` easily accessible).
- `autocomplete="email"` — tells password managers (1Password, Bitwarden, browser-built-in) this is the email field, so autofill works. Pair this with `autocomplete="current-password"` on the password field — password managers key off these two attributes.

**`value={form?.data?.email ?? ''}`**
When the server returns a validation error, we repopulate the email field so the user doesn't have to retype it. Password? Never. We'll get into why in a moment.

**`<input type="password" autocomplete="current-password">`**
Note: `current-password`, not `new-password`. These two values tell password managers different things:

- `current-password` — "This is an existing password; offer to autofill." (Login)
- `new-password` — "This is a brand-new password; offer to save/suggest a strong one." (Registration)

Getting this wrong means password managers misbehave — autofill on the wrong field, no offer to save on signup.

**Notice: no `value=` on the password field.** If validation fails, we let the field go empty. Browsers won't repopulate password fields anyway (for good reason — history and shoulder-surfing attacks), and we don't want to round-trip plaintext passwords through our server response more often than necessary.

**`<button disabled={submitting}>`**
Disabling during submission prevents the user from double-submitting by mashing the button.

---

## Step 2: The Server Action — Validation

Now the backend. Create `src/routes/(auth)/login/+page.server.ts`:

```typescript
// src/routes/(auth)/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
	email: z.string().email('Enter a valid email address'),
	password: z.string().min(1, 'Password is required')
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await locals.getUser();

	if (user) {
		const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard';
		const safeRedirect =
			redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/dashboard';
		redirect(303, safeRedirect);
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const raw = {
			email: formData.get('email'),
			password: formData.get('password')
		};

		const parsed = loginSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				error: 'Enter a valid email and password',
				data: { email: typeof raw.email === 'string' ? raw.email : '' }
			});
		}

		const { error } = await locals.supabase.auth.signInWithPassword({
			email: parsed.data.email,
			password: parsed.data.password
		});

		if (error) {
			return fail(400, {
				error: 'Invalid email or password',
				data: { email: parsed.data.email }
			});
		}

		const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard';
		const safeRedirect =
			redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/dashboard';
		redirect(303, safeRedirect);
	}
};
```

This file is short, but **every single line carries security weight**. Let's disassemble it.

---

## Step 3: The Zod Schema — Validating, Not Authenticating

```typescript
const loginSchema = z.object({
	email: z.string().email('Enter a valid email address'),
	password: z.string().min(1, 'Password is required')
});
```

**`z.string().email(...)`** — Zod's built-in email validator. It's a syntactic check: is the shape roughly `something@something.tld`? It doesn't check whether the email **exists** or whether the user owns it.

**`z.string().min(1, ...)`** — password must be at least 1 character. Wait, really? Only 1?

This is a deliberate choice. The registration schema enforces `.min(8)` because we're creating a new password. The login schema just checks "not empty." Why?

- **We don't know what length rules applied when the user registered.** Maybe the rules have changed since. Maybe they registered via a migration script that imported legacy accounts with shorter passwords. If we enforce `.min(8)` on login, we lock legitimate users out.
- **The password check happens at Supabase.** Supabase compares the bcrypt hash; if it matches, the password is correct — regardless of length. That's where authentication decisions live.
- **Different layers have different jobs.** Zod's job on login: "is the field non-empty so we don't make a pointless API call?" Supabase's job: "does this password match the stored hash?" Don't duplicate responsibilities.

This separation is a **Principal Engineer** pattern: each layer enforces only what it owns. Zod doesn't authenticate. Supabase doesn't do shape validation.

---

## Step 4: The `load` Function — Already-Logged-In UX

```typescript
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await locals.getUser();

	if (user) {
		const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard';
		const safeRedirect =
			redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/dashboard';
		redirect(303, safeRedirect);
	}

	return {};
};
```

A `load` function runs on the server **every time the page is requested** (whether by direct URL, client-side nav, or form action reload). This one does exactly one job: **if the visitor is already signed in, skip the login page and send them where they were going.**

Why does this matter?

- **UX.** A returning user clicks the "Login" link in the navbar out of habit. Without this, they see a login form; they type their email and password; they get a redirect to `/dashboard`. That's three wasted steps.
- **Bookmark hygiene.** Users bookmark `/login`. When they return next week, they don't get stuck on a form they shouldn't see.
- **`redirectTo` preservation.** When a signed-out user visits `/dashboard/contacts`, our auth guard (Lesson 3.3) will redirect them to `/login?redirectTo=/dashboard/contacts`. If they **then** realize they already signed in on another tab (session cookie exists), this `load` function sends them straight to `/dashboard/contacts` — exactly where they wanted to go.

**`locals.getUser()`** — this is the method we wired up in Lesson 2.3. It calls `supabase.auth.getUser()`, which **validates the JWT against Supabase's auth server** (as opposed to `getSession()`, which trusts cookies). Because this method hits Supabase, it's authoritative. If `user` is non-null, the session is real.

**`url.searchParams.get('redirectTo')`** — `url` is a `URL` object; `searchParams` is its query-string API. `get('redirectTo')` returns the string value or `null` if the param isn't set.

**`redirectTo.startsWith('/') && !redirectTo.startsWith('//')`** — the open-redirect defense. Read the next section carefully; this single expression blocks a whole class of attacks, including the protocol-relative (`//evil.com`) edge case.

**`redirect(303, safeRedirect)`** — we already covered this in 3.1. Status 303 tells the browser "go GET this URL." In SvelteKit 2+, `redirect()` throws internally, so calling it halts the `load` function without you writing `throw` yourself.

---

## Step 5: The Open-Redirect Attack Class — Why `startsWith('/')` Matters

This is one of the most under-appreciated web vulnerabilities. It's in the OWASP Top 10. It's burned Facebook, Reddit, Slack, and Apple. And it's catastrophically easy to introduce.

### The attack

Imagine we wrote the redirect naively:

```typescript
const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard';
redirect(303, redirectTo); // NO VALIDATION
```

A phishing attacker sends an email:

> Suspicious activity on your Contactly account — please log in to review: `https://contactly.com/login?redirectTo=https://contactIy.com/confirm-password` (note the lowercase "L" swapped for an "I")

The user clicks. They see a **real** Contactly login page at a **real** Contactly URL — no red flags. They type their real credentials. We authenticate them successfully. Then we redirect them, as the URL asks us to, to `contactIy.com` (the attacker's clone).

On the clone: "Session expired. Please re-enter your password for security." The user does. Game over.

The trick: the attacker leveraged **our login page's trust** (real domain, real HTTPS cert, real UI) to launder credibility onto their phishing page. Our server became an open redirect machine.

### The defense

```typescript
const safeRedirect =
	redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/dashboard';
```

Only allow redirect targets that start with `/` **and** aren't protocol-relative. That means only same-origin paths. `https://evil.com/...`? Rejected (doesn't start with `/`). `//evil.com/...`? Rejected (the `!startsWith('//')` guard). `/dashboard/contacts`? Allowed.

### Gotcha: protocol-relative URLs

You might wonder why the second check — `!startsWith('//')` — is necessary. A URL like `//evil.com` **does start with `/`**, so a naïve `startsWith('/')` check alone would let it through. Browsers interpret protocol-relative URLs as "same protocol, different host." That means if we redirected to `//evil.com`, the browser would happily go to `https://evil.com` — the exact phishing attack we're trying to block.

A naïve version that only checks one slash is **not** enough:

```typescript
// ❌ INCOMPLETE — lets //evil.com through
const safeRedirect = redirectTo.startsWith('/') ? redirectTo : '/dashboard';
```

Always combine the two conditions.

### Even safer: whitelist approach

The gold standard is an explicit whitelist of allowed redirect targets:

```typescript
const allowedRedirects = ['/dashboard', '/dashboard/contacts', '/account' /* ... */];
const safeRedirect = allowedRedirects.includes(redirectTo) ? redirectTo : '/dashboard';
```

But this requires maintenance — every new route needs to be added. For a small SaaS, `startsWith('/') && !startsWith('//')` is a pragmatic middle ground.

---

## Step 6: The Default Action — Calling `signInWithPassword`

```typescript
export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const raw = {
			email: formData.get('email'),
			password: formData.get('password')
		};

		const parsed = loginSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, {
				error: 'Enter a valid email and password',
				data: { email: typeof raw.email === 'string' ? raw.email : '' }
			});
		}

		const { error } = await locals.supabase.auth.signInWithPassword({
			email: parsed.data.email,
			password: parsed.data.password
		});

		if (error) {
			return fail(400, {
				error: 'Invalid email or password',
				data: { email: parsed.data.email }
			});
		}

		const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard';
		const safeRedirect =
			redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/dashboard';
		redirect(303, safeRedirect);
	}
};
```

Let's walk through each part.

### Reading the form data

```typescript
const formData = await request.formData();
const raw = {
	email: formData.get('email'),
	password: formData.get('password')
};
```

`request` is a standard `Request` object (the same one the web platform has had since Fetch API was designed). `formData()` parses the POST body as `multipart/form-data` or `application/x-www-form-urlencoded` and returns a `FormData` object.

`formData.get('email')` returns one of: a `string`, a `File`, or `null`. Zod handles the `null` and `File` cases by failing validation — we don't have to guard manually.

### Validation

```typescript
const parsed = loginSchema.safeParse(raw);
if (!parsed.success) {
	return fail(400, {
		error: 'Enter a valid email and password',
		data: { email: typeof raw.email === 'string' ? raw.email : '' }
	});
}
```

`safeParse` returns `{ success: true, data }` or `{ success: false, error }`. It never throws.

If validation fails, we return a generic error message — **not** field-specific messages. On the login form, we don't distinguish "email is malformed" from "password is blank." Why? Because the page says "Enter a valid email and password" regardless, and field-level errors leak no real information here (the user can see their own typing; they know which field is blank).

### The auth call

```typescript
const { error } = await locals.supabase.auth.signInWithPassword({
	email: parsed.data.email,
	password: parsed.data.password
});
```

`signInWithPassword` does three things atomically:

1. Looks up the user by email in `auth.users`.
2. Hashes the submitted password with the same bcrypt salt used when they registered.
3. Compares the hashes. If they match, creates a session, sets auth cookies, returns `{ data, error: null }`.

If any step fails, it returns `{ data: null, error }`. The error types include `invalid_credentials`, `email_not_confirmed`, and others.

Supabase writes the session cookies **for us**, using the cookies adapter we configured in Lesson 2.3. That's why this action doesn't have to do anything explicit with cookies — `locals.supabase` is the server client wired up in `hooks.server.ts`, which knows how to write cookies via the `cookies` API.

### Opaque error handling — the credential-stuffer defense

```typescript
if (error) {
	return fail(400, {
		error: 'Invalid email or password',
		data: { email: parsed.data.email }
	});
}
```

**Notice the message: "Invalid email or password."** Not "Email not found" or "Wrong password."

This single line blocks a whole class of attack called **username enumeration**. Let me explain why.

Imagine we wrote error handling naively:

```typescript
// ❌ DON'T DO THIS
if (error?.message === 'User not found') {
	return fail(400, { error: 'No account with that email' });
}
if (error?.message === 'Invalid password') {
	return fail(400, { error: 'Wrong password' });
}
```

An account-enumerator types `ceo@acme.com` with password `x`. Server says "Wrong password." Aha — `ceo@acme.com` exists.

They move on: `tom@acme.com` password `x`. Server says "No account with that email." Interesting — `tom` doesn't work there.

Over a few thousand requests, they've built a list of valid emails at `acme.com`. That list gets sold to phishers, who craft convincing emails to those specific real humans.

**The opaque message refuses to distinguish.** Whether the email exists or not, whether the password is wrong or the email is wrong, the user sees the same text. The attacker can't tell the difference. Enumeration fails.

This is a rare case where **worse UX is better security**. A real user who forgot their password sees "Invalid email or password" and figures "maybe I got the email wrong, or the password wrong" — and either retries or uses Forgot Password. The UX friction is small. The security benefit is enormous.

### Password reset — not login's job

What if the user genuinely mistyped their password three times in a row? They should click **"Forgot password?"** and go through email-based recovery (Lesson 5.x, later in the course). The login page isn't the place to help them figure out which of email or password was wrong — the reset flow is.

### The success redirect — again with safe-redirect

```typescript
const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard';
const safeRedirect =
	redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/dashboard';
redirect(303, safeRedirect);
```

Same pattern as the `load` function. Note we read `redirectTo` from `url` **inside the action** — `url` here is the URL of the request being handled (including query params from the original navigation). If the user was sent to `/login?redirectTo=/dashboard/contacts` by the auth guard, that query param is still on the URL when they submit the form, and we honor it here.

---

## Step 7: Test the Flow

With `pnpm dev` running:

1. **Test basic login.** Register a new user via `/register`. You'll land on `/dashboard`. (If `/dashboard` doesn't exist yet, you'll see SvelteKit's 404 page — we'll build `/dashboard` in Lesson 3.3. For now, just confirm the **redirect** happens; the 404 is fine.) Log out manually for now by clearing cookies in DevTools → Application → Cookies → `http://localhost:5173`. Navigate to `/login`. Enter the credentials. Submit. You land on `/dashboard` (or the 404 in the same place).

2. **Test wrong password.** Same flow, but type a bogus password. See "Invalid email or password." Email is repopulated, password is blank.

3. **Test wrong email.** Same thing — same opaque error.

4. **Test already-logged-in.** While logged in, type `/login` into the URL bar. You're immediately redirected to `/dashboard`.

5. **Test redirectTo.** While logged out, visit `/login?redirectTo=/dashboard`. Log in. Confirm you land on `/dashboard`.

6. **Test open-redirect defense.** Visit `/login?redirectTo=https://example.com`. Log in. Confirm you land on `/dashboard` (NOT example.com).

7. **Test JS disabled.** In DevTools → Settings → Preferences → Debugger → "Disable JavaScript." Reload. Submit the form. Everything still works — `use:enhance` is a progressive enhancement; the no-JS path is a normal POST + re-render.

---

## Common Mistakes

### Mistake 1: Using `getSession()` in the `load` function

```typescript
// ❌ DON'T
const session = await locals.supabase.auth.getSession();
if (session) {
	/* ... */
}
```

`getSession()` **trusts the cookies without verifying them**. An attacker who can forge a cookie (because your cookie-signing secret leaked, for instance) would pass this check. `getUser()` hits Supabase's auth server to validate the JWT — it's the only way to be **sure**.

See Lesson 2.3 for the full threat model.

### Mistake 2: Exposing field-level validation errors on login

```typescript
// ❌ DON'T
return fail(400, {
	errors: parsed.error.flatten().fieldErrors, // { email: ['Invalid email'] }
	data: { email: raw.email }
});
```

Granular errors are great on registration (the user wants to know which field failed). On login, they leak information. Stick to a single opaque message.

### Mistake 3: Trusting `redirectTo` without validation

```typescript
// ❌ DON'T
redirect(303, url.searchParams.get('redirectTo') ?? '/dashboard');
```

You just built a free open redirect for phishing campaigns. Always validate that the target is a same-origin path.

### Mistake 4: Repopulating the password field

```svelte
<!-- ❌ DON'T -->
<input type="password" value={form?.data?.password ?? ''} />
```

This round-trips plaintext passwords in HTML responses, which can end up in browser back-button caches, in logs if you're not careful, and in accidental screenshots or screen-shares. Let the field clear itself. Password managers will autofill on retry anyway.

### Mistake 5: Using `type="text"` for passwords

```svelte
<!-- ❌ DON'T -->
<input type="text" name="password" />
```

This disables browser password masking, breaks password manager integration, and shows the password on shared screens and monitor mirrors. `type="password"` exists for a reason.

### Mistake 6: Rolling your own bcrypt comparison

```typescript
// ❌ DON'T
const stored = await db.getUserPasswordHash(email);
const match = bcrypt.compareSync(password, stored);
```

Don't hand-roll authentication when you have `signInWithPassword`. It handles timing attacks (constant-time comparison), rate limiting, session creation, refresh tokens, and a dozen other things you'd have to get right. Using the platform's built-in primitive is the correct default.

---

## Principal Engineer Notes

### Notes on timing-attack resistance

One enumeration attack we haven't discussed: **response timing**. If your server takes 200ms to respond when the email exists (because bcrypt runs) and 50ms when it doesn't (because the lookup fails fast), an attacker can still distinguish.

Supabase's `signInWithPassword` **always runs bcrypt**, even when the user doesn't exist, specifically to equalize response times. This is a real-world detail that matters. You get it for free by using the platform; you'd have to engineer it yourself if rolling your own.

### Notes on rate limiting

Our action has **no rate limit**. An attacker can script 100,000 login attempts per second. In production:

- Supabase rate-limits auth endpoints by default (60/hour per IP or similar).
- You might add a CDN/edge layer (Cloudflare Rate Limiting) in front of `/login` as defense in depth.
- You might add CAPTCHA after N failed attempts from the same session/IP.

These mitigations are out of scope for this lesson but worth knowing exist.

### Notes on the full protocol-relative URL defense

```typescript
// Belt-and-suspenders version
function safeRedirect(raw: string | null, fallback = '/dashboard'): string {
	if (!raw) return fallback;
	if (!raw.startsWith('/')) return fallback; // absolute URL
	if (raw.startsWith('//')) return fallback; // protocol-relative
	if (raw.includes('\\')) return fallback; // Windows-path smuggling
	return raw;
}
```

At senior-level scale, the defense is extracted into a helper, thoroughly unit-tested, and reused everywhere `redirectTo` is honored.

### Notes on login and account takeover monitoring

In a mature product, every successful login writes to an audit table:

- `user_id`
- `timestamp`
- `ip_address`
- `user_agent`
- `success` / `failure`

Users get email notifications when logins happen from a new device or new country ("We noticed a sign-in from Tokyo — if this wasn't you, reset your password"). These are standard features of any serious SaaS. Supabase doesn't build them for you; you'd implement them as hooks on top of the auth events.

### Notes on passwords vs passwordless

You've just built a password-based login. That's table stakes in 2026, but it's not the state of the art. The modern alternatives:

- **Magic links** — user enters email; we email them a one-time login link. No password at all. Supabase supports this via `signInWithOtp`.
- **Passkeys (WebAuthn)** — user's device (phone, laptop) is their auth factor. Cryptographic, phishing-resistant, no password to leak. Supabase now supports passkeys as a provider.
- **OAuth / SSO** — "Sign in with Google/GitHub/Microsoft." The user never creates a password on your site.

Each has different tradeoffs (email deliverability, device loss, account recovery complexity). A real Contactly would offer password + OAuth (Google, at minimum) + passkeys. We're starting with passwords because the pattern generalizes — once you understand form actions + `signInWithPassword`, adding the other providers is a matter of swapping the action body.

### Notes on session duration and refresh

When `signInWithPassword` succeeds, Supabase sets an `sb-*-auth-token` cookie containing a JWT and a refresh token. The JWT expires (default: 1 hour). Each server-side Supabase call checks expiry and — if the JWT is close to expiring — uses the refresh token to mint a new one, transparently. Users stay logged in across weeks without re-entering passwords.

You can shorten this (bank-level: 15-minute expiry, re-auth for sensitive actions) or lengthen it (consumer products: 60 days). The tradeoff is UX friction vs attacker window after compromise.

---

## What's Next

Our login action happily redirects to `/dashboard`, but there's nothing stopping a signed-out user from visiting `/dashboard` directly. We need a **server-side guard** that redirects unauthenticated users back to `/login?redirectTo=...` whenever they hit a protected route.

Lesson 3.3 builds that guard — one `+layout.server.ts` file inside the `(app)` route group that protects every page inside it with a single line of code, using `locals.getUser()` as the gate. We'll also build the empty `/dashboard` page and the `(app)` layout that wraps every authenticated page in a Navbar.
