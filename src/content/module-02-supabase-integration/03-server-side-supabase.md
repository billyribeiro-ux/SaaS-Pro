---
title: '2.3 - Server-Side Supabase'
module: 2
lesson: 3
moduleSlug: 'module-02-supabase-integration'
lessonSlug: '03-server-side-supabase'
description: 'Configure the Supabase server client in hooks.server.ts using @supabase/ssr for cookie-based session management.'
duration: 14
preview: false
---

## Overview

This is one of the most important technical lessons in the entire course. You'll set up a piece of code that runs on **every single request** to your Contactly app, creates a Supabase client scoped to that request, looks up the authenticated user, and makes both available to every page's server-side code.

You'll also learn the single most critical security rule in Supabase-on-SvelteKit: **always use `getUser()`, never `getSession()` for authorization**. Miss this, and your app has an authentication bypass. Get it right, and the database layer becomes a reliable line of defense.

## Prerequisites

- Lesson 2.2 complete — `@supabase/ssr` is installed and types are generated.

## What You'll Build

- A `src/hooks.server.ts` file containing a SvelteKit handle hook.
- Type declarations in `src/app.d.ts` so `event.locals` is fully typed.
- A per-request Supabase client that reads cookies from the incoming request and writes them to the outgoing response.
- A `locals.getUser()` helper that validates sessions against the Supabase Auth server.
- The right `filterSerializedResponseHeaders` configuration so SSR data flows correctly to the client.

---

## What Is `hooks.server.ts`?

`hooks.server.ts` is a special file at the root of `src/`. If it exists, SvelteKit loads it once when the server boots and invokes its `handle` export for every incoming HTTP request — **before** any route code runs.

Think of it as middleware, but SvelteKit's own word is "hook." Every request flows through this function first. Whatever you set up here is available to every `+page.server.ts`, `+layout.server.ts`, and `+server.ts` (API route) that runs afterwards.

### The basic shape

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// before: set up things on `event.locals`
	const response = await resolve(event);
	// after: read/modify the response
	return response;
};
```

- **`event`** — all the information about this request: URL, method, headers, cookies, and `event.locals` (a fresh empty object for you to stuff things into for downstream code).
- **`resolve(event)`** — invokes SvelteKit's normal request handling: matches the URL to a route, runs any load functions, renders the response. Returns the final `Response` object.
- **`return response`** — gives SvelteKit the final response to send back to the browser.

This is the pattern we're going to use to set up Supabase.

---

## Why Do We Need This?

Three things need to happen per request:

1. **Create a Supabase client** that knows about this request's cookies. A logged-in user's session lives in cookies; we can't read them any earlier.
2. **Extract the authenticated user** from the session. Downstream code (every server load function, every API route) wants to know "is someone logged in, and if so who?"
3. **Make both available on `event.locals`** so we don't repeat the setup in every route.

The alternative — building a Supabase client inside each load function — works but is redundant, verbose, and invites bugs (someone forgets to validate, someone uses the wrong cookie adapter). Doing it once in a hook is the right place.

---

## A Two-Minute Primer: Cookies and Sessions

If you're new, here's the background you need.

A **cookie** is a tiny piece of text the browser stores on behalf of a specific domain. When the browser makes any request to that domain, it attaches every non-expired cookie to the request as a header. Servers can set new cookies by returning a `Set-Cookie` response header.

Cookies have attributes:

- `HttpOnly` — JavaScript in the browser cannot read this cookie. Only the server sees it. Defeats XSS attacks.
- `Secure` — only transmitted over HTTPS.
- `SameSite=Lax` or `Strict` — only sent on same-origin requests (or relaxed for top-level navigations). Defeats CSRF.
- `Path=/` — the cookie applies to every URL on the domain.

Supabase uses cookies to store the user's **access token** and **refresh token**:

- The access token is a JWT, valid for ~1 hour, that the Supabase API trusts. When the app makes database requests, the access token identifies the user.
- The refresh token is a long-lived token used to obtain a new access token when the current one expires, without forcing the user to log in again.

Both tokens live in cookies because both the browser (for realtime/client calls) and the server (for SSR) need to read them. `localStorage` is browser-only — inaccessible to server code — which is why the older "store in localStorage" pattern doesn't work for SSR apps.

---

## The Full `hooks.server.ts`

Create (or replace) `src/hooks.server.ts` with:

```typescript
// src/hooks.server.ts
import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Handle } from '@sveltejs/kit';
import type { Database } from '$lib/types/database.types';

export const handle: Handle = async ({ event, resolve }) => {
	// Build a per-request Supabase client that reads cookies from the incoming
	// request and writes any session updates to the outgoing response.
	event.locals.supabase = createServerClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);

	// Resolve the authenticated user by validating the session with the Auth
	// server. NEVER use getSession() for authorization — it trusts the cookie
	// without contacting the server and can be spoofed by a malicious client.
	event.locals.getUser = async () => {
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) return null;
		return user;
	};

	return resolve(event, {
		// Supabase uses custom response headers. SvelteKit strips most headers from
		// the serialized response by default; these two need to pass through.
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
```

Let's walk through every line.

---

## Breaking Down the Hook

### The imports

```typescript
import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Handle } from '@sveltejs/kit';
import type { Database } from '$lib/types/database.types';
```

- `createServerClient` — the Supabase SSR factory function. Returns a `SupabaseClient` instance wired for server-side cookie handling.
- `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` — imported from `$env/static/public`. Safe to use here because we only ever use the public values in the client. (If you're wondering: the Supabase client is intentionally not given the service role key — RLS policies still apply. This is the correct, secure choice.)
- `Handle` — the TypeScript type for a SvelteKit handle hook.
- `Database` — the type we regenerated from the schema in the previous lesson.

### Creating the per-request client

```typescript
event.locals.supabase = createServerClient<Database>(
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY,
	{
		cookies: {
			/* ... */
		}
	}
);
```

Three positional arguments:

1. The Supabase API URL.
2. The anon key.
3. A client config object — for SSR, the essential field is `cookies`.

`<Database>` as a generic type parameter wires the type definitions from your schema into the client. Now `event.locals.supabase.from('profiles')` is type-checked against your real schema.

### The cookies adapter

```typescript
cookies: {
  getAll: () => event.cookies.getAll(),
  setAll: (cookiesToSet) => {
    cookiesToSet.forEach(({ name, value, options }) => {
      event.cookies.set(name, value, { ...options, path: '/' })
    })
  }
}
```

`@supabase/ssr` needs to read and write cookies but doesn't know anything about SvelteKit. You hand it two functions:

- **`getAll()`** — called when the Supabase client wants to read cookies. It should return every cookie in the incoming request as `{ name, value }[]`.
- **`setAll(cookiesToSet)`** — called when the Supabase client wants to write cookies (e.g., after a token refresh). It should set each cookie on the outgoing response.

SvelteKit provides both operations on `event.cookies`. We're just bridging the two APIs.

**The `{ ...options, path: '/' }` part:** Supabase sets cookie options like `HttpOnly`, `Secure`, `SameSite`, and `MaxAge`. We spread those options and force `path: '/'` so the cookie applies to every URL in the app. Without an explicit path, SvelteKit may default to the current route's path, which would scope the cookie wrong.

### The `getUser` helper

```typescript
event.locals.getUser = async () => {
	const {
		data: { user },
		error
	} = await event.locals.supabase.auth.getUser();
	if (error || !user) return null;
	return user;
};
```

This function is what every downstream server code will call to determine "who is this user?" We wrap `supabase.auth.getUser()` in a thin helper that returns `User | null`, making the caller's life easier.

**Why wrap it at all?** Three reasons:

1. **Caller ergonomics.** `locals.getUser()` returns `User | null` — one null check, one line. `supabase.auth.getUser()` returns `{ data: { user }, error }` — two lines of unpacking every time.
2. **Forces correctness.** By only exposing `getUser()`, we nudge the whole codebase toward the safe API.
3. **Centralizes error handling.** If we later want to log auth errors or instrument timing, there's one place to do it.

---

## The `getUser()` vs `getSession()` Rule — Memorize This

This is the most important rule in Supabase SSR. Both functions exist. One is safe; one is not. The difference matters enormously.

### `getSession()` — reads the cookie

`supabase.auth.getSession()` reads the session token from the cookie, decodes it, and returns the session as a JavaScript object. **It does not contact the Supabase server.** It trusts the cookie.

**Why is that a problem?** In a normal browser, the cookie is set by Supabase and signed. You'd think it's trustworthy. But:

- On the **server**, `event.cookies.get()` reads whatever the client sent. A malicious client can send any cookie they like. They can craft a cookie that decodes to a valid-looking session claiming to be user `admin@example.com`. `getSession()` will happily return that session.
- Your app then makes decisions based on `session.user.id` — like, say, "show admin-only data."
- Congratulations, you've just shipped an authentication bypass vulnerability.

`getSession()` is fine for non-authorization purposes — for instance, checking whether the user "appears logged in" to decide what UI state to render. It is **never** safe for authorization decisions: "is this user allowed to see this data?" "is this user an admin?" "does this user own this resource?"

### `getUser()` — validates with the server

`supabase.auth.getUser()` takes the access token and **sends it to the Supabase Auth server** (`GET /auth/v1/user`). The server verifies:

- The token's signature using the secret key (which only the server has).
- The token is not expired.
- The user exists and has not been revoked.

If any check fails, the server returns an error. If everything passes, it returns the real, canonical user. A malicious client **cannot forge a token** because they don't have the signing secret.

**Rule**: **always use `getUser()` in server code for any decision that affects data access.** The extra network hop is worth it. Every Supabase-on-SvelteKit production app you'll encounter uses `getUser()`.

### Common misconception

"But `getSession()` validates the JWT signature." — Partially true. `@supabase/ssr` attempts signature validation when it can, but it **cannot detect a revoked user** or a compromised signing key without talking to the server. More importantly: the SSR cookie layer has had historical bugs where manipulated cookies deserialized into valid-looking sessions. Supabase's own guidance is explicit: use `getUser()` for server-side auth.

Save yourself the debate. Use `getUser()`.

---

## `filterSerializedResponseHeaders` — What and Why

```typescript
return resolve(event, {
	filterSerializedResponseHeaders(name) {
		return name === 'content-range' || name === 'x-supabase-api-version';
	}
});
```

When SvelteKit renders a page on the server, it also serializes any `fetch()` responses you made during `load` functions so the client can hydrate with the same data. For security, SvelteKit's default is to strip most headers from those serialized responses — you don't want `Set-Cookie` or `Authorization` leaking to the client.

But Supabase uses a couple of specific headers that the client SDK reads for its own accounting:

- **`content-range`** — returned on paginated queries. The Supabase client reads it to know the total row count.
- **`x-supabase-api-version`** — identifies the API version. Used internally by the SDK.

Adding them to the allow list tells SvelteKit "these are safe to pass through." Without this line, client-side queries that depend on pagination metadata will misbehave.

---

## Typing `event.locals` — `src/app.d.ts`

SvelteKit keeps `event.locals` type-safe via a special `App.Locals` interface in `src/app.d.ts`. Replace (or merge with) that file:

```typescript
// src/app.d.ts
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.types';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			getUser(): Promise<User | null>;
		}

		interface PageData {
			user: User | null;
		}

		interface Error {
			message: string;
			code?: string;
		}
	}
}

export {};
```

Three things to understand:

- **`interface Locals`** — declares the shape of `event.locals`. Anything you set on `event.locals` in the hook must be declared here. If the two don't match, TypeScript will fail somewhere.
- **`interface PageData`** — declares the shape of the `data` prop every page receives. We'll use this in the next lesson when the root `+layout.server.ts` returns `{ user }`.
- **`interface Error`** — SvelteKit lets you customize the shape of errors thrown with `error()` from `@sveltejs/kit`. We extend it with a `code` field for error categorization.
- **`export {}`** at the bottom — not a typo. The `declare global` block requires the file to be a module, and a blank export turns it into one.

---

## Verifying It Works

At this point you've set up the plumbing, but we haven't wired any page to use it yet. That comes in lesson 2.4. For now, we can at least verify the code compiles.

```bash
pnpm check
```

Expected: zero errors, zero warnings. If TypeScript complains about `event.locals.supabase`, the likely cause is that `src/app.d.ts` isn't declaring it correctly. Double-check the `Locals` interface.

We can also boot the dev server:

```bash
pnpm dev
```

Visit `localhost:5173`. The page loads. Nothing visibly changed — the hook is running silently for every request, setting up a Supabase client nobody is using yet. That's expected.

If the server throws an error on startup, check:

- Did you replace `src/hooks.server.ts` fully, or is there a conflict with existing content?
- Are `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` both set in `.env`?
- Is `@supabase/ssr` installed? `pnpm list @supabase/ssr` should show a version.

---

## Principal Engineer Notes

1. **The hook is the narrowest place to set up per-request state.** Moving any of this logic into individual load functions scatters it; moving it further (a separate service worker, middleware class, etc.) overengineers it. A hook is the right-sized tool.

2. **The `getUser()` / `getSession()` distinction is an auth-bypass class of bug.** Document it. Lint-rule it. Code-review it. Every engineer who joins the team should know this rule within their first week. Some teams go as far as creating an ESLint rule that flags `getSession()` outside of specific allowlisted files.

3. **Per-request clients are the correct pattern for serverless.** In serverless platforms (Vercel, Netlify, Cloudflare Workers), your code runs in short-lived isolates. A "global" Supabase client would be shared across requests and could leak one user's session into another's. Creating a fresh client per request via `event.locals.supabase` prevents this entirely.

4. **The `content-range` header allow-list is the kind of detail that bites at production scale.** You may never hit it in development because you're always working with small datasets. In production, a user with 10,000 contacts paginates, the client expects `content-range`, and suddenly things break. Make sure this line is in your `filterSerializedResponseHeaders` — and if you ever see strange pagination bugs in a Supabase+SvelteKit app, check here first.

5. **Trust the build, verify the runtime.** The compiler can catch "did you import the wrong env var" and "is `event.locals` typed correctly." It cannot catch "is your Supabase URL actually reachable" or "did your cookie domain match." Always test login/logout end-to-end in dev before shipping.

---

## Summary

- `hooks.server.ts` runs on **every request** and is the right place to set up per-request state.
- Created a Supabase server client via `createServerClient` from `@supabase/ssr`, with a cookies adapter that bridges Supabase's cookie API to SvelteKit's `event.cookies`.
- Attached the client to `event.locals.supabase` so every downstream server load and API route can use it without re-creating it.
- Added a `locals.getUser()` helper that **validates the session with the Supabase Auth server**, not just the cookie.
- Memorized the rule: **always use `getUser()` for authorization decisions, never `getSession()`.**
- Added `filterSerializedResponseHeaders` to allow `content-range` and `x-supabase-api-version` through to the client for pagination and version negotiation.
- Declared `App.Locals`, `App.PageData`, and `App.Error` in `src/app.d.ts` so the TypeScript compiler understands the shape of our request-scoped state.

## Next Lesson

The server side is wired up. In lesson 2.4 you'll create the **client-side** Supabase instance — a browser client that shares cookies with the server — and plumb the authenticated user through `PageData` so every page and component in Contactly can read it.
