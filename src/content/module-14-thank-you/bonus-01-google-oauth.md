# Bonus: Sign in with Google (OAuth via Supabase Auth)

You have a working email-and-password login system. That is great. But every serious SaaS you have ever used also offers "Continue with Google" — and for good reason. This lesson teaches you what OAuth is, why it exists, and how to wire Google sign-in into Contactly end-to-end.

We are going to move carefully. Authentication is the one area of your app where "it kind of works" is not acceptable — a single mistake can leak user accounts. So we will explain every moving part before we touch code.

## Why OAuth exists (the 30-second history)

Imagine it is 2005. You sign up for a photo-printing site and it asks for your Gmail password so it can attach to an email to send your prints. You hand over your password. That site now has the ability to:

- Read every email in your inbox forever.
- Change your password and lock you out.
- Impersonate you to every other site that uses your Gmail for password resets.

You trusted them with one password. You accidentally gave them your entire digital life. This was called "the password anti-pattern" and it was terrible.

**OAuth** (Open Authorization) was designed to fix this. The idea:

> A user can prove to site B that they own an account at site A, without ever giving site B their password for site A.

Instead, site B sends the user over to site A, the user logs in on site A's own website, site A asks "Do you want to let site B see your email address and profile picture?", and if the user agrees, site A hands site B a short-lived, narrowly-scoped token. Site B uses that token to fetch just the email and name — nothing else.

OAuth 2.0 is the current version of the standard. Every "Sign in with Google / Apple / GitHub / Microsoft" button you have ever clicked is OAuth 2.0.

## The OAuth 2.0 redirect flow, in slow motion

Here is exactly what happens when a user clicks "Sign in with Google" on Contactly:

1. **User clicks the button.** Our frontend calls `supabase.auth.signInWithOAuth({ provider: 'google' })`.
2. **Supabase builds a URL** pointing at Google's authorization endpoint. That URL contains:
   - `client_id` — our app's public identifier, registered with Google.
   - `redirect_uri` — the URL Google should send the user back to after login. Supabase uses its own callback URL: `https://<your-project>.supabase.co/auth/v1/callback`.
   - `scope` — what we want to know about the user (`openid email profile`).
   - `state` — a random anti-CSRF token Supabase generated.
   - `code_challenge` — part of PKCE (more in a second).
3. **Browser redirects to Google.** The user sees Google's own login screen at `accounts.google.com`. If they are already logged in, they skip straight to the consent screen: "Contactly wants to access your email address and basic profile. Allow?"
4. **User clicks Allow.** Google redirects back to Supabase's callback URL with a short-lived `code` in the query string: `https://<your-project>.supabase.co/auth/v1/callback?code=abcd1234&state=xyz789`.
5. **Supabase exchanges the code for tokens.** Supabase's server makes a back-channel POST to Google with the `code`, the `client_secret`, and the `code_verifier` (PKCE). Google responds with an `access_token` and an `id_token` (the id_token contains the user's email and profile, signed by Google).
6. **Supabase creates/finds a user** in its `auth.users` table based on the email Google returned, generates a Supabase session, and redirects the browser to **our app's** callback URL (the one we specified in `redirectTo`), appending its own `code` in the URL: `http://localhost:5173/auth/callback?code=supabase-code-here`.
7. **Our app exchanges Supabase's code for a session cookie** by calling `supabase.auth.exchangeCodeForSession(code)`. That sets the session cookies on the browser.
8. **Our app redirects the user to `/app`** (or wherever we want them to land). Done.

### What is PKCE and why do we care?

**PKCE** (pronounced "pixy", Proof Key for Code Exchange) is a required addition to OAuth for public clients (apps where you cannot hide a secret — i.e., anything running in a browser). The flow is:

1. Before sending the user to Google, the client generates a random string called a `code_verifier`, hashes it with SHA-256, and sends the hash (`code_challenge`) to Google.
2. When the client later exchanges the `code` for a token, it also sends the original `code_verifier`.
3. Google hashes the verifier and compares. If an attacker intercepted the `code`, they cannot use it without the verifier.

Supabase handles PKCE for you. You do not write any of that code. You only need to know the term exists so you understand the security posture.

### Authorization codes vs. implicit flow

Older OAuth had an "implicit flow" where Google returned an `access_token` directly in the URL. That is now deprecated because tokens ended up in browser history, server logs, referer headers, etc. The modern flow — the one Supabase uses — always uses a short-lived `code` that is immediately exchanged server-side. Codes expire in seconds and can only be used once.

## Step 1: Create a Google Cloud project

Go to <https://console.cloud.google.com>. If this is your first time, you will be asked to agree to the Terms of Service and pick a country.

1. Click the project dropdown at the very top of the page (next to the "Google Cloud" logo).
2. Click **New Project**.
3. **Project name:** `Contactly` (or whatever you like). Leave organization as "No organization" unless you have one.
4. Click **Create**. Wait 10-20 seconds. Google will show a notification when it is ready.
5. Click the project dropdown again and select your new `Contactly` project. Double-check the project name in the top bar matches.

## Step 2: Configure the OAuth consent screen

This is the screen users see that says "Contactly wants to access your email address." Google requires you to set it up before creating credentials.

1. In the left sidebar, go to **APIs & Services → OAuth consent screen**.
2. Pick **External** (unless you are a Google Workspace admin configuring for your own org only — you are not).
3. Click **Create**.
4. Fill in:
   - **App name:** `Contactly`
   - **User support email:** your email.
   - **App logo:** optional for now.
   - **Application home page:** your production URL (e.g. `https://contactly.app`) or leave blank for localhost development.
   - **Developer contact information:** your email again.
5. Click **Save and Continue**.
6. On the **Scopes** step, click **Add or Remove Scopes** and tick:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`

   These three scopes give us the user's email, name, and avatar URL. Nothing else. Click **Update**, then **Save and Continue**.

7. On the **Test users** step: while your app is in "Testing" mode (the default), only test users can sign in. Add your own email here plus any teammate you want to test with. Click **Save and Continue**.
8. Review the summary. Click **Back to Dashboard**.

> **Senior-engineer note:** When you are ready to launch publicly, you need to submit the app for Google verification. For `email`/`profile`/`openid` scopes, verification is usually automatic and fast. If you ask for broader scopes (e.g. Gmail read access), Google requires a formal security review that can take weeks. We only use the three basic scopes, so this is painless.

## Step 3: Create OAuth 2.0 credentials

1. Left sidebar → **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. **Application type:** `Web application`.
4. **Name:** `Contactly Web` (only you see this; pick anything).
5. **Authorized JavaScript origins** — leave blank. Supabase handles the OAuth handshake server-side.
6. **Authorized redirect URIs** — this is critical. Click **Add URI** and paste:

   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```

   Replace `<your-project-ref>` with the string in your Supabase URL. You can find it in the Supabase dashboard at **Project Settings → API → Project URL**. For example, if the URL is `https://xyzabcdef.supabase.co`, the redirect URI is `https://xyzabcdef.supabase.co/auth/v1/callback`.

7. Click **Create**.
8. A modal shows your **Client ID** and **Client Secret**. Copy both into a scratchpad. You will not see the secret again in plaintext — if you lose it, you have to regenerate.

## Step 4: Wire the credentials into Supabase

1. Go to your Supabase project dashboard.
2. Left sidebar → **Authentication → Providers**.
3. Find **Google** in the list and click it to expand.
4. Toggle **Enable Sign in with Google** to ON.
5. Paste your **Client ID** into "Client ID (for OAuth)".
6. Paste your **Client Secret** into "Client Secret (for OAuth)".
7. Leave **Authorized Client IDs** blank (that is for native iOS/Android, which we do not have).
8. Scroll up and note the **Callback URL (for OAuth)** field — this is the Supabase URL we pasted into Google Cloud a moment ago. They must match exactly. Verify they do.
9. Click **Save**.

## Step 5: Add the "Sign in with Google" button to the login page

Now the backend is configured. Let us wire up the frontend.

### `src/routes/(auth)/login/+page.svelte`

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { form } = $props();

	let loading = $state(false);

	async function signInWithGoogle() {
		loading = true;
		const { error } = await page.data.supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: `${window.location.origin}/auth/callback?next=/app`
			}
		});
		if (error) {
			console.error(error);
			loading = false;
		}
		// On success the browser is redirected away; no further code runs.
	}
</script>

<div class="mx-auto max-w-sm py-12">
	<h1 class="text-2xl font-semibold">Sign in to Contactly</h1>

	<form method="POST" use:enhance class="mt-6 space-y-4">
		<label class="block">
			<span class="text-sm">Email</span>
			<input
				name="email"
				type="email"
				required
				class="mt-1 block w-full rounded border px-3 py-2"
			/>
		</label>
		<label class="block">
			<span class="text-sm">Password</span>
			<input
				name="password"
				type="password"
				required
				class="mt-1 block w-full rounded border px-3 py-2"
			/>
		</label>
		{#if form?.error}
			<p class="text-sm text-red-600">{form.error}</p>
		{/if}
		<button class="w-full rounded bg-black px-4 py-2 text-white">Sign in</button>
	</form>

	<div class="my-6 flex items-center gap-3 text-xs text-gray-500">
		<div class="h-px flex-1 bg-gray-200"></div>
		OR
		<div class="h-px flex-1 bg-gray-200"></div>
	</div>

	<button
		type="button"
		onclick={signInWithGoogle}
		disabled={loading}
		class="flex w-full items-center justify-center gap-3 rounded border px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
	>
		<svg class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
			/>
			<path
				fill="#FBBC05"
				d="M5.84 14.09A6.98 6.98 0 0 1 5.47 12c0-.73.13-1.44.37-2.09V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
			/>
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
			/>
		</svg>
		<span>Continue with Google</span>
	</button>
</div>
```

Let us walk through this line by line.

- `import { page } from '$app/state'` — we use the new `$app/state` API (never the old `$app/stores`). `page.data.supabase` is our browser Supabase client, which we exposed from the root `+layout.ts` load function in an earlier module.
- `let { form } = $props()` — Svelte 5 runes syntax for reading form-action feedback.
- `let loading = $state(false)` — local reactive state; we disable the button while the redirect is in flight.
- `signInWithOAuth({ provider: 'google', options: { redirectTo } })` — this kicks off the OAuth dance. The browser is redirected to Google. `redirectTo` is where Supabase should send the user **after** the handshake is done. We point it at our own `/auth/callback` route and include a `next=/app` query param so we know where to land the user after the session is set.
- `${window.location.origin}` — `window.location.origin` resolves to `http://localhost:5173` in dev and `https://contactly.app` in production. This is correct because Supabase must redirect the user back to the origin they came from.

Do the same on `src/routes/(auth)/register/+page.svelte` — the code is identical; OAuth flow does not distinguish "sign up" from "sign in" because Supabase auto-creates the user if they do not exist.

## Step 6: Tell Supabase your app's redirect URLs are allowed

Supabase blocks redirects to unknown domains by default (otherwise an attacker could craft a malicious `redirectTo` that sends the `code` to their own site). Open Supabase dashboard → **Authentication → URL Configuration**.

- **Site URL:** `http://localhost:5173` for dev. Update to your production URL when you deploy.
- **Redirect URLs** (additions, one per line):
  - `http://localhost:5173/auth/callback`
  - `https://contactly.app/auth/callback` (or whatever your production domain is)
  - `http://localhost:5173/auth/callback?next=/**` — the `**` wildcard allows any `next` value.

Save.

## Step 7: Create the `/auth/callback` route

When Supabase finishes the handshake, it will redirect the browser to `http://localhost:5173/auth/callback?code=<supabase-code>&next=/app`. We need a server route that exchanges that code for a session and then redirects the user.

### `src/routes/auth/callback/+server.ts`

```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');
	const next = url.searchParams.get('next') ?? '/app';

	// Open-redirect protection: only allow relative paths that start with a
	// single slash (so `/app` is fine but `//evil.com/steal` is not).
	const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/app';

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			throw redirect(303, safeNext);
		}
		console.error('OAuth exchange failed', error);
	}

	// If we got here, something went wrong. Send the user back to login with a flag.
	throw redirect(303, `/login?error=oauth_failed`);
};
```

Breakdown:

- `GET: RequestHandler` — SvelteKit will call this for any `GET /auth/callback` request.
- `locals.supabase` — the server Supabase client attached in `hooks.server.ts` from an earlier module. It knows how to read/write cookies for the current request.
- `url.searchParams.get('code')` — pulls the `code` out of the query string.
- `url.searchParams.get('next') ?? '/app'` — reads the `next` param we set on the login page (default `/app`).
- **Open-redirect protection:** we only trust `next` if it is a _relative_ path starting with a single `/`. A value like `//evil.com/steal` would be interpreted by the browser as `http://evil.com/steal` — this check stops that attack cold. This is the same pattern we use elsewhere in the app, keep it consistent.
- `supabase.auth.exchangeCodeForSession(code)` — this is the server call that takes the short-lived code from Supabase and trades it for a long-lived session. The SDK automatically writes the session cookies into the response via the cookie handlers we set up in `hooks.server.ts`.
- `throw redirect(303, safeNext)` — SvelteKit's way of returning an HTTP 303 redirect. 303 specifically means "see other", and it is the correct status after a successful POST-like action.
- On failure, we redirect to `/login?error=oauth_failed` so you can optionally show an error message on the login page.

## Step 8: Verify the cookie lifecycle

You do not have to write any new hook code — the existing `hooks.server.ts` already attaches a Supabase server client to `event.locals` for every request, using cookies as the session store. That means once `exchangeCodeForSession` sets the cookies, the very next request (the one triggered by our `throw redirect(303, '/app')`) will run through the hook, read those cookies, and see the authenticated user via `event.locals.getUser()`.

Let us confirm by reading the hook. Open `src/hooks.server.ts`. You should see a block like:

```ts
event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
	cookies: {
		getAll: () => event.cookies.getAll(),
		setAll: (cookiesToSet) => {
			cookiesToSet.forEach(({ name, value, options }) => {
				event.cookies.set(name, value, { ...options, path: '/' });
			});
		}
	}
});

event.locals.getUser = async () => {
	const {
		data: { user }
	} = await event.locals.supabase.auth.getUser();
	return user;
};
```

This is all that is needed. OAuth just produces a session — the session storage (cookies) is identical to email/password.

## Step 9: Test the full flow

1. Start your dev server: `pnpm dev`.
2. Open an incognito window (so no stale sessions interfere). Go to `http://localhost:5173/login`.
3. Click **Continue with Google**.
4. You should be redirected to `accounts.google.com`. Pick the Google account you added as a test user.
5. Click **Allow** on the consent screen.
6. Google redirects you to `https://<project>.supabase.co/auth/v1/callback?code=...`, which immediately redirects you to `http://localhost:5173/auth/callback?code=...&next=/app`, which exchanges the code and redirects you to `/app`.
7. You should now be on `/app` logged in as your Google account.

Verify in Supabase:

1. Dashboard → **Authentication → Users**. You should see your Google email listed as a user, with `google` shown as the provider.
2. Click the user to see details. Note that `email_confirmed_at` is set automatically — Google already verified the email, so Supabase skips its own email confirmation.

## Gotchas and what senior engineers think about

**1. Localhost vs. production redirect URIs.** Google requires an exact match between the `redirect_uri` your app requests and the ones registered in Google Cloud. In dev you need `http://localhost:5173/auth/callback` (among the Supabase allowed redirects — Google only cares about the `https://<project>.supabase.co/auth/v1/callback` one). In production you need your real domain `https://contactly.app/auth/callback` in the Supabase allowed redirects list. Forgetting the production URL is the #1 reason "it works in dev but not prod."

**2. Users who previously registered with email.** If Alice created an account with `alice@gmail.com` via email+password last month, and today clicks "Sign in with Google" with her Google account `alice@gmail.com`, Supabase matches on email and links the two identities automatically. Alice ends up as the same user, keeping all her data. Good. **However**, this is only safe because Google has verified that email belongs to Alice. If you ever enable an OAuth provider that does _not_ verify email (rare, but it exists), you must disable automatic linking in Supabase settings to prevent account takeover.

**3. Email scope is required for Supabase.** If you edit your Google consent screen and remove the `email` scope, the OAuth flow will error because Supabase cannot create a user without an email. Keep `openid email profile`.

**4. The consent screen is cached.** After the first time a user allows Contactly, Google remembers and skips the consent screen on subsequent logins. If you change scopes, Google re-prompts.

**5. Do not log the code or tokens.** Never `console.log(code)` in production, and never ship the client secret to the browser. The secret lives only in Supabase's settings. Our browser-side `signInWithOAuth` call uses only the client ID (which is safe to expose).

**6. Rate limits.** Google imposes quotas on the OAuth endpoints. For normal traffic you will never hit them. If you somehow get throttled, the error messages from Supabase will be clear.

**7. Verification badge.** Until Google verifies your app, the consent screen says "Google hasn't verified this app" in yellow and requires users to click "Advanced → Go to Contactly (unsafe)". This is only visible to test users and to you. When you submit for verification (usually not needed for the basic scopes — Google auto-approves), that warning goes away.

**8. Adding Apple or GitHub later.** The pattern is identical. Register the app with the provider, paste credentials into Supabase, call `signInWithOAuth({ provider: 'apple' })`. No new callback route needed — `/auth/callback` handles them all.

## What you just built

In under 30 lines of application code you added single-sign-on with Google. The bulk of the work was configuration: Google Cloud, Supabase, URL allow-lists. That is a common pattern with OAuth — the code is tiny, the ceremony is heavy. Now you understand why each step exists, so when you add Apple or GitHub later, you can do it in ten minutes.
