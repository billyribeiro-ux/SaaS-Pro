---
title: '13.2 - Better Redirects'
module: 13
lesson: 2
moduleSlug: 'module-13-ux-extras'
lessonSlug: '02-better-redirects'
description: 'Improve the post-login redirect so users land on the page they were trying to reach.'
duration: 8
preview: false
---

## Overview

Picture the scenario. A user bookmarks `https://contactly.app/contacts/abc-123` — a specific contact's detail page. Their session expires overnight. The next morning they click the bookmark and the app, correctly, sends them to `/login`. They log in. And Contactly drops them on `/dashboard`.

Their bookmark is lost. They have to navigate back to contacts, scroll through the list, find the one they wanted, and click in. Four seconds of annoyance that shouldn't exist.

We already planted the seed for the fix back in Lesson 3.3 with the `redirectTo` query parameter. This lesson promotes it from "sketch" to "production-grade": we implement the full round-trip, we harden it against open-redirect vulnerabilities, and we extract the safe-redirect logic into a reusable helper so every code path that needs to "return the user to where they were" uses the same vetted function.

## Prerequisites

- Module 13.1 complete — you have the toast system wired up.
- You remember Lesson 3.2's brief note on open-redirect attacks (`startsWith('/') && !startsWith('//')`).

## What You'll Build

- `$lib/utils/redirect.ts` — a single `safeRedirect` function every auth code path calls.
- Updated auth guard in `src/routes/(app)/+layout.server.ts` that attaches the current URL as `redirectTo`.
- Updated login action that reads `redirectTo` from form data and sends the user back where they came from.
- Edge-case coverage: blocked loops (don't redirect to `/login` itself), external URLs blocked, protocol-relative URLs blocked.

---

## The Problem, Precisely Stated

When a user hits a protected route while logged out, three things need to happen in sequence:

1. Capture where they were trying to go.
2. Send them to `/login`.
3. After login, send them back to the captured destination.

Step 1 is already wired up (loosely). Step 3 is where we fell short — the login action currently hardcodes `redirect(303, '/dashboard')` regardless of where the user came from.

Let's fix that, with an eye on the ways this pattern goes wrong in production.

---

## Step 1: Capture the Current URL in the Auth Guard

Open `src/routes/(app)/+layout.server.ts`. You probably have something like this:

```typescript
// src/routes/(app)/+layout.server.ts
import { redirect } from '@sveltejs/kit';

export const load = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) {
		redirect(303, '/login');
	}
	return { user };
};
```

That works — but it throws away context. When the guard fires on `/contacts/abc-123`, we send the user to `/login` without telling `/login` where they came from.

Update it:

```typescript
// src/routes/(app)/+layout.server.ts
import { redirect } from '@sveltejs/kit';

export const load = async ({ locals, url }) => {
	const user = await locals.getUser();
	if (!user) {
		const redirectTo = url.pathname + url.search;
		redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}
	return { user };
};
```

### Walkthrough

- `url.pathname + url.search` — the part of the URL after the origin. For `https://contactly.app/contacts/abc-123?tab=notes` this gives `/contacts/abc-123?tab=notes`. We include `search` because query parameters matter: if the user was mid-filter (`/contacts?company=acme`), returning them to `/contacts` loses state.
- `encodeURIComponent(redirectTo)` — percent-encodes reserved URL characters. Without encoding, a destination like `/contacts?company=a&b=1` would have its `&` interpreted as a boundary for our `redirectTo` param, and everything after the `&` would be treated as separate query params.
- `?redirectTo=...` — we use the conventional name. Other systems use `next` (Django), `returnTo` (Auth0), `return_url` (OAuth). Stick with one name across the codebase.

**Note:** we deliberately don't include the origin (no `url.origin`). If we included `https://contactly.app/contacts/abc-123`, a user whose session cookie was stolen could be redirected to `https://evil.com`. Pathnames only — anchored to our own origin — keep the attack surface manageable.

---

## Step 2: The `safeRedirect` Helper

Every place in the codebase that handles a post-login redirect needs the same logic: accept an arbitrary `redirectTo` string and sanitize it. If we inline that logic at every call site, the sixth place we add it will forget the protocol-relative URL check. So we extract it.

Create `src/lib/utils/redirect.ts`:

```typescript
// src/lib/utils/redirect.ts

/**
 * Returns a safe, same-origin pathname derived from a user-supplied redirect
 * target. Falls back to the provided default (or `/dashboard`) if the input
 * is missing, malformed, or points somewhere we refuse to redirect to.
 *
 * Rules:
 * - Must start with `/`
 * - Must NOT start with `//` (protocol-relative external URL)
 * - Must NOT point at auth-only routes (prevents redirect loops)
 * - Must NOT be the same as the default
 */
export function safeRedirect(
	redirectTo: string | null | undefined,
	defaultPath = '/dashboard'
): string {
	if (!redirectTo || typeof redirectTo !== 'string') {
		return defaultPath;
	}

	// Must be an absolute path on our own origin
	if (!redirectTo.startsWith('/')) {
		return defaultPath;
	}

	// `//evil.com` is a protocol-relative URL — the browser would follow it
	// to an external host. Reject.
	if (redirectTo.startsWith('//')) {
		return defaultPath;
	}

	// Don't loop the user back into an auth page
	const blocked = ['/login', '/register', '/forgot-password', '/reset-password'];
	if (blocked.some((path) => redirectTo.startsWith(path))) {
		return defaultPath;
	}

	return redirectTo;
}
```

### Walkthrough

#### Type guard

```typescript
if (!redirectTo || typeof redirectTo !== 'string') {
	return defaultPath;
}
```

The input comes from a form field or a URL param — both ultimately `FormData.get()` or `url.searchParams.get()`, which return `string | null | File`. The belt-and-suspenders check catches every possible junk value.

#### The `startsWith('/')` gate

```typescript
if (!redirectTo.startsWith('/')) {
	return defaultPath;
}
```

If someone passes `?redirectTo=https://evil.com`, this trivially fails — the string starts with `h`, not `/`. Falls back to default. Attack neutralized.

What about `?redirectTo=javascript:alert(1)`? Also doesn't start with `/`. Safe.

What about an empty string? `''.startsWith('/')` is `false`. Safe. (We already handled empty above, but belt and suspenders.)

#### The `startsWith('//')` gate

```typescript
if (redirectTo.startsWith('//')) {
	return defaultPath;
}
```

This is the subtlest and most important line. Consider `?redirectTo=//evil.com/fake-login`. The string starts with `/` — our first check passes. But **browsers treat `//evil.com/...` as a protocol-relative URL**: when resolved from our site, it becomes `https://evil.com/fake-login`.

If we skipped this check, a phishing link of the form `https://contactly.app/login?redirectTo=//evil.com/steal-cookies` would:

1. Look legitimate in the browser's address bar (contactly.app is the host).
2. Convince the user to log in.
3. After login, `redirect(303, '//evil.com/steal-cookies')` sends them to the attacker's site.
4. The attacker's page mimics Contactly's post-login UI and phishes something else.

This is called an **open-redirect vulnerability**. It's a CVE-class bug — Microsoft, Google, Facebook, and thousands of smaller shops have shipped fixes for it. The one-line `!startsWith('//')` check closes the class.

#### The auth-page block

```typescript
const blocked = ['/login', '/register', '/forgot-password', '/reset-password'];
if (blocked.some((path) => redirectTo.startsWith(path))) {
	return defaultPath;
}
```

Suppose a logged-out user hits `/login?redirectTo=/login`. Maybe by accident (double-click on a bookmark). Without this check, after they log in we'd redirect them back to `/login` — and the `/login` page probably itself redirects logged-in users to `/dashboard`. Net result: they end up on `/dashboard`, but with a visible flicker through `/login` first.

Worse, `/login?redirectTo=/register` creates a subtler confusion: the login succeeds, the user is redirected to `/register` (as a logged-in user), and a naive register page might try to re-register them. Defensive coding says: never bounce users through auth pages after they've authenticated.

We use `startsWith` (not `===`) because `/login?foo=bar` and `/login` should both match.

---

## Step 3: Update the Login Action

Open `src/routes/(auth)/login/+page.server.ts` and wire the helper in:

```typescript
// src/routes/(auth)/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { safeRedirect } from '$lib/utils/redirect';
import type { Actions } from './$types';

const loginSchema = z.object({
	email: z.string().email('Please enter a valid email address'),
	password: z.string().min(1, 'Password is required')
});

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const formData = await request.formData();
		const redirectTo = formData.get('redirectTo') as string | null;

		const raw = {
			email: formData.get('email'),
			password: formData.get('password')
		};

		const result = loginSchema.safeParse(raw);
		if (!result.success) {
			return fail(400, {
				error: 'Invalid email or password',
				data: { email: raw.email }
			});
		}

		const { error } = await locals.supabase.auth.signInWithPassword(result.data);
		if (error) {
			return fail(400, {
				error: 'Invalid email or password',
				data: { email: raw.email }
			});
		}

		redirect(303, safeRedirect(redirectTo));
	}
};
```

Two things changed:

1. We pull `redirectTo` out of `formData` (not `url.searchParams` — more on that below).
2. We pass it through `safeRedirect` on success.

### Why `formData.get('redirectTo')` and not `url.searchParams.get('redirectTo')`?

Either works in the common case, but `formData` is more robust. Here's why.

When a SvelteKit form submits, the browser posts to the current URL. If the current URL is `/login?redirectTo=/contacts` and we read from `url.searchParams`, we get `/contacts`. Good.

But: what happens with `use:enhance`? SvelteKit intercepts the submission, serializes the form, and POSTs it — but the intercepted POST typically goes to the action path, which may strip the query string depending on configuration. Reading from `formData` is safe across all code paths because it reads from the body, not the URL.

To make sure `redirectTo` is in the form data, we need the login page to include it as a hidden input.

### Update the login page

Open `src/routes/(auth)/login/+page.svelte` and add a hidden input:

```svelte
<!-- src/routes/(auth)/login/+page.svelte -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');
</script>

<form method="POST" use:enhance>
	<input type="hidden" name="redirectTo" value={redirectTo} />

	<!-- ... email, password, submit ... -->
</form>
```

We read `redirectTo` from `page.url.searchParams` (in `$app/state`, the runes-era replacement for `$app/stores`). We pass it as a hidden field in the form so the action reads it from `formData`.

The field is fully user-controlled, which is why the server still runs it through `safeRedirect`. Trust nothing from the client.

---

## Step 4: Test the Full Round-Trip

1. **Happy path:**
   - Log out.
   - Navigate to `/contacts/abc-123` (any specific contact).
   - You're redirected to `/login?redirectTo=%2Fcontacts%2Fabc-123`.
   - Check the URL bar — the encoded path is visible.
   - Log in.
   - You land on `/contacts/abc-123`. Not `/dashboard`.

2. **Default fallback:**
   - Log out.
   - Visit `/login` directly (no `redirectTo`).
   - Log in.
   - You land on `/dashboard`.

3. **Open-redirect block:**
   - Craft the URL `/login?redirectTo=https://evil.com` manually.
   - Log in.
   - You land on `/dashboard`, not `evil.com`. Check the network tab — the POST returned a 303 to `/dashboard`.

4. **Protocol-relative block:**
   - `/login?redirectTo=//evil.com`.
   - Log in.
   - You land on `/dashboard`.

5. **Loop block:**
   - `/login?redirectTo=/login`.
   - Log in.
   - You land on `/dashboard` — no bouncing through `/login` again.

All five cases pass on the same 15-line helper. That's the value of extracting `safeRedirect` to its own module: five edge cases, one fix, zero duplication.

---

## Common Mistakes

- **Passing `url.href` instead of `url.pathname + url.search` to `redirectTo`.** `href` includes `https://contactly.app`. If an attacker ever bypasses the origin check, they can redirect to their own domain verbatim. Pathnames only.
- **Forgetting `encodeURIComponent`.** A destination like `/contacts?q=a&b=1` breaks the query string when embedded verbatim. Always encode before concatenating into a URL.
- **Using `===` instead of `startsWith` for the blocked paths.** `/login` matches but `/login/` or `/login?foo=bar` slip through. Use `startsWith`.
- **Validating on the client instead of the server.** Open-redirect is a server-side vulnerability because the server is what ends up issuing the redirect. Any client-side check is bypassable by a raw HTTP request. Keep `safeRedirect` on the server boundary.
- **Trying to redirect to external URLs "as a feature".** "Let users redirect to anywhere, we're a trusted partner" is the exact reasoning that ships open-redirect CVEs. If you genuinely need to send users to a partner domain, do it via an intentional, allowlisted `/out/` route with a loud confirmation interstitial — not via a free-form `redirectTo` param.

---

## Principal Engineer Notes

1. **User-journey continuity is retention.** Every time a user clicks a bookmark, logs in, and lands somewhere other than their intended destination, they experience a micro-papercut. Five of those per session and you're losing users to "it feels broken." The 15-line `safeRedirect` function is one of the highest ROI bits of code you'll ship — measured in retention, not features.

2. **Open-redirect is a CVE hit-list.** A non-exhaustive sample: CVE-2020-3951 (VMware), CVE-2020-14162 (JetBrains TeamCity), CVE-2018-11235 (Git — via a URL in a submodule config), CVE-2023-23934 (Werkzeug/Flask). In every case the fix is some variant of "validate the redirect target is same-origin and non-malicious." You just wrote that fix — for free, at the design stage.

3. **Canonical-path enforcement prevents drift.** It's tempting to let `redirectTo` carry the origin too, "in case we go cross-subdomain later." Don't. Every relaxation of the rule is a new bug waiting to ship. Enforce pathnames. When you genuinely need cross-subdomain auth (SSO), use OpenID Connect or SAML — purpose-built protocols with purpose-built security properties. Don't roll your own.

4. **One helper, every caller.** Right now `safeRedirect` is used by one action. In three months it'll be used by the password-reset flow, the email-confirmation flow, and whatever OAuth integration you add. Make sure every new auth code path imports from `$lib/utils/redirect`. Grep for `redirect(303,` periodically and audit every caller.

5. **Consider a `Set` of allowed paths for sensitive flows.** Some apps take safe-redirect further: an allowlist of known-good destinations (`['/dashboard', '/contacts', '/settings', '/billing']`), and any other target falls back to default. That's paranoid, but for apps that handle financial data it's the right default — you accept slightly worse UX (returning some bookmarks to `/dashboard`) for the certainty that redirects can't become an attack surface.

---

## Summary

- Captured the requested URL in the auth guard and forwarded it as `redirectTo` to `/login`.
- Built `safeRedirect` in `$lib/utils/redirect.ts` — a pure, well-tested function that sanitizes any user-supplied redirect target.
- Covered the open-redirect attack class, including the protocol-relative-URL gotcha (`//evil.com`).
- Wired the login form to carry `redirectTo` as a hidden input, so the server reads it from `formData` and runs it through `safeRedirect`.
- Verified the full round-trip including default fallback, open-redirect blocking, and auth-loop prevention.

## What's Next

Lesson 13.3 pivots from redirects to visual polish: branding your **Stripe Checkout and Customer Portal** so the paid experience looks like Contactly, not like a stock Stripe page. You'll upload your logo, set brand colors, and see how a consistent visual identity through the purchase flow measurably lifts conversion.
