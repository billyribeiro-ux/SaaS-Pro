---
title: 'Bonus: Magic Link Sign-In'
module: 14
lesson: 27
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-27-magic-link-auth'
description: 'Add passwordless sign-in via magic links. Branded email template, PKCE-friendly callback handler, rate limiting, and the UX patterns that keep magic links usable across mail clients.'
duration: 20
preview: false
---

# Bonus: Magic link sign-in

Passwords are friction. Most users either reuse a weak one or trigger "forgot password" anyway. **Magic links** flip the flow: enter your email, click the link in your inbox, you're signed in. The mailbox _is_ the password.

Supabase ships magic links as a first-class auth method. This lesson is about making it _good_ — the email looks right, the UX handles "I clicked the link in a different browser" gracefully, and you don't get spammed by enumeration attacks.

By the end you will:

- Add a "Sign in with email" button to the login page.
- Customise the Supabase magic-link email template.
- Build a PKCE-aware `/auth/callback` handler that exchanges the token for a session.
- Show a "check your email" confirmation page that doesn't leak whether the address exists.
- Rate-limit magic-link requests by IP and by email.
- Handle the cross-browser case (request from desktop, click from mobile).

## 1. Why magic links

Pros:

- One factor, no memorisation. Forgotten-password flows are eliminated.
- Stronger than reused passwords (which is most passwords).
- Conversion: ~10–20% lift on sign-up flows in our experience.
- Composable with TOTP from Bonus 26 for full passwordless + 2FA.

Cons:

- Email deliverability matters more than ever — spam folders kill conversion.
- Cross-device clicks ("I requested it on my laptop, clicked it on my phone") need handling.
- Some corporate inboxes pre-fetch links and burn the token. (Mitigation: use PKCE-tied tokens.)

Worth it for B2C and most B2B SaaS. For high-value accounts (financial, admin), pair with TOTP.

## 2. The request action

`/auth/magic-link/+page.server.ts`:

```ts
import type { Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { rateLimitByIp, rateLimitByKey } from '$lib/server/rate-limit';
import { logger } from '$lib/server/logger';

const Schema = z.object({ email: z.string().email().toLowerCase() });

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress, url }) => {
		const form = await request.formData();
		const parsed = Schema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email.' });

		const { email } = parsed.data;

		await rateLimitByIp(getClientAddress(), { key: 'magic-link', max: 5, windowSec: 60 });
		await rateLimitByKey(`magic:${email}`, { max: 3, windowSec: 300 });

		const { error } = await locals.supabase.auth.signInWithOtp({
			email,
			options: {
				emailRedirectTo: `${url.origin}/auth/callback`,
				shouldCreateUser: true
			}
		});

		if (error) {
			logger.warn({ err: error.message, email_hash: hashEmail(email) }, 'magic_link_send_failed');
		}
		throw redirect(303, `/auth/check-email?email=${encodeURIComponent(email)}`);
	}
};
```

We **always redirect to the same page**, regardless of whether sending succeeded. This is enumeration-safe: an attacker can't tell from the response whether `bob@example.com` is a registered user.

## 3. Rate limiting (in case you skipped Bonus 11)

Two budgets:

- **By IP:** prevents one bot scraping millions of emails.
- **By email:** prevents flooding one user's inbox.

Minimal implementation in `src/lib/server/rate-limit.ts`:

```ts
const buckets = new Map<string, { count: number; resetAt: number }>();

export async function rateLimitByKey(
	key: string,
	{ max, windowSec }: { max: number; windowSec: number }
) {
	const now = Date.now();
	const bucket = buckets.get(key);
	if (!bucket || bucket.resetAt < now) {
		buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
		return;
	}
	if (bucket.count >= max) {
		const e = new Error('Rate limited');
		(e as any).status = 429;
		throw e;
	}
	bucket.count++;
}

export const rateLimitByIp = (ip: string, opts: { key: string; max: number; windowSec: number }) =>
	rateLimitByKey(`${opts.key}:${ip}`, opts);
```

Production: swap the in-memory `Map` for Upstash Redis or Vercel KV. The interface stays identical.

## 4. The callback handler

When the user clicks the link, they land on `/auth/callback?code=...&type=magiclink`. Exchange the code for a session.

`/auth/callback/+server.ts`:

```ts
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const code = url.searchParams.get('code');
	const next = url.searchParams.get('next') ?? '/';

	if (!code) throw redirect(303, '/auth/error?reason=missing_code');

	const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (error) {
		logger.warn({ err: error.message }, 'magic_link_exchange_failed');
		throw redirect(303, '/auth/error?reason=invalid_or_expired');
	}

	throw redirect(303, next);
};
```

Supabase handles the PKCE verifier automatically when you use `signInWithOtp` with the SSR client.

## 5. Customise the email template

Supabase Dashboard → Authentication → Email Templates → Magic Link. Defaults are functional but generic.

```html
<h2>Sign in to {{ .SiteURL }}</h2>
<p>Hi,</p>
<p>Click the button below to sign in. This link expires in 1 hour.</p>
<p>
	<a
		href="{{ .ConfirmationURL }}"
		style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px"
	>
		Sign in to Contactly
	</a>
</p>
<p style="color:#666;font-size:14px">
	If you didn't request this, you can safely ignore this email.
</p>
```

Set the `Site URL` and `Redirect URLs` in Supabase Auth settings to include your production domain plus `http://localhost:5173` for dev. Mismatched URLs are the #1 cause of "the link doesn't work."

## 6. The "check your email" page

`/auth/check-email/+page.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/stores';
	const email = $derived($page.url.searchParams.get('email') ?? '');
</script>

<h1>Check your email</h1>
<p>We sent a sign-in link to <strong>{email}</strong>.</p>
<p>Click the link to continue. The link expires in 1 hour.</p>
<details>
	<summary>Didn't get it?</summary>
	<ul>
		<li>Check your spam folder.</li>
		<li>Wait 60 seconds, then <a href="/auth/magic-link">request a new link</a>.</li>
	</ul>
</details>
```

## 7. Cross-browser clicks

The hardest UX problem. User requests on Chrome desktop. Email arrives. They click on iOS Safari. The PKCE verifier was set in a Chrome cookie that Safari doesn't have.

Two mitigations:

1. **Use one-time-password (OTP) codes _alongside_ magic links.** The email contains both a clickable link AND a 6-digit code. The check-email page has a "Enter code" form. Code-based flow doesn't depend on the original browser's cookies.

   ```ts
   await locals.supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
   // ... then on check-email page, the user can verify with the code:
   await locals.supabase.auth.verifyOtp({ email, token: code, type: 'email' });
   ```

2. **Deep link to your domain, not a Supabase domain.** Less suspicious to email clients, less likely to be pre-fetched.

## 8. Tests

Cover:

- Valid email → redirect to check-email page (regardless of whether send succeeded).
- Invalid email → 400.
- Rate limit by IP after 5 attempts.
- Rate limit by email after 3 attempts in 5 min.
- Callback with valid code → session set + redirect.
- Callback with invalid code → redirect to error page.

## 9. Acceptance checklist

- [ ] Magic-link request action with rate limiting (IP + email).
- [ ] Always redirects to check-email page (no enumeration leak).
- [ ] `/auth/callback` exchanges code for session, handles errors.
- [ ] Branded email template with site URL.
- [ ] Check-email page with retry + spam folder hint.
- [ ] (Optional) OTP code fallback for cross-browser clicks.
- [ ] Tests cover happy path, rate limits, and invalid codes.

## What's next

Bonus 28 brings **optimistic UI with Svelte 5 runes** — make every action _feel_ instant by updating the local state before the server confirms, and reconcile gracefully when it doesn't.
