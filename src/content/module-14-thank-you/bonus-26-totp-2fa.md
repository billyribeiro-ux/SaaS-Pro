---
title: 'Bonus: Two-Factor Auth with TOTP'
module: 14
lesson: 26
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-26-totp-2fa'
description: "Add Time-Based One-Time Password 2FA via Supabase's MFA primitives. Enrolment flow with QR code + recovery codes, an AAL2 gate on sensitive routes, and step-up auth before the billing portal."
duration: 28
preview: false
---

# Bonus: Two-factor auth with TOTP

Passwords leak. Reused passwords leak more. The single highest-value security upgrade you can ship for a SaaS is making "I have your password" insufficient to take over an account. **Time-based one-time passwords (TOTP)** are the cheapest, friendliest second factor: the user opens 1Password / Authy / Google Authenticator, types six digits, done.

Supabase ships MFA primitives that handle the cryptography (RFC 6238 TOTP) and the AAL (Authenticator Assurance Level) tracking. This lesson wires them into Contactly.

By the end of this lesson you will:

- Enable MFA in your Supabase project and understand AAL1 vs AAL2.
- Build an enrolment flow that generates a TOTP secret, renders a QR code, and verifies the first code.
- Generate recovery codes the user can stash in their password manager.
- Gate sensitive routes (billing portal, account deletion) behind AAL2 (`mfa_enrolled === true && aal === 'aal2'`).
- Build a step-up challenge page for users who have MFA but their session is only AAL1.
- Add a "regenerate recovery codes" flow.

## 1. Enable MFA in Supabase

In the Supabase Dashboard → Authentication → Providers → Multi-Factor Authentication: enable "TOTP". No code change required at this step; you're just turning on the feature.

For local dev, the same setting in `supabase/config.toml`:

```toml
[auth.mfa]
max_enrolled_factors = 10

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

After `supabase db reset`, the `auth.mfa_factors` and `auth.mfa_challenges` tables are available.

## 2. Understand AAL

Supabase tracks two assurance levels per session:

- **AAL1** — the user authenticated with one factor (password, magic link, OAuth).
- **AAL2** — the user has _additionally_ verified a second factor in this session.

The session JWT carries an `aal` claim. Sensitive routes should require `aal === 'aal2'`.

A user can have MFA enrolled but currently be in an AAL1 session (e.g. they signed in 5 minutes ago and haven't been challenged yet). For these users, sensitive routes "step up" — redirect to a challenge page where they enter a TOTP code without re-typing their password.

## 3. The enrolment flow

`/account/security/+page.server.ts`:

```ts
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const { data: factors } = await locals.supabase.auth.mfa.listFactors();
	return {
		totpFactor: factors?.totp?.[0] ?? null
	};
};

export const actions: Actions = {
	enroll: async ({ locals }) => {
		const { data, error } = await locals.supabase.auth.mfa.enroll({
			factorType: 'totp',
			friendlyName: 'Authenticator App'
		});
		if (error) return fail(400, { error: error.message });
		return {
			factorId: data.id,
			qr: data.totp.qr_code,
			secret: data.totp.secret,
			uri: data.totp.uri
		};
	},

	verify: async ({ request, locals }) => {
		const data = await request.formData();
		const factorId = String(data.get('factorId') ?? '');
		const code = String(data.get('code') ?? '');

		const { data: challenge, error: challengeErr } = await locals.supabase.auth.mfa.challenge({
			factorId
		});
		if (challengeErr) return fail(400, { error: challengeErr.message });

		const { error: verifyErr } = await locals.supabase.auth.mfa.verify({
			factorId,
			challengeId: challenge.id,
			code
		});
		if (verifyErr) return fail(400, { error: 'Invalid code. Try again.', factorId });

		return { ok: true };
	},

	unenroll: async ({ request, locals }) => {
		const data = await request.formData();
		const factorId = String(data.get('factorId') ?? '');
		const { error } = await locals.supabase.auth.mfa.unenroll({ factorId });
		if (error) return fail(400, { error: error.message });
		return { ok: true };
	}
};
```

`/account/security/+page.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

{#if data.totpFactor}
	<p>2FA is enabled.</p>
	<form method="POST" action="?/unenroll" use:enhance>
		<input type="hidden" name="factorId" value={data.totpFactor.id} />
		<button type="submit">Disable 2FA</button>
	</form>
{:else if form?.qr}
	<p>Scan this QR code with your authenticator app.</p>
	<img src={form.qr} alt="QR code" />
	<p>Or enter this secret manually: <code>{form.secret}</code></p>
	<form method="POST" action="?/verify" use:enhance>
		<input type="hidden" name="factorId" value={form.factorId} />
		<label>
			Enter the 6-digit code:
			<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autofocus required />
		</label>
		<button type="submit">Verify & enable</button>
	</form>
{:else}
	<p>Add 2FA to protect your account from password leaks.</p>
	<form method="POST" action="?/enroll" use:enhance>
		<button type="submit">Set up 2FA</button>
	</form>
{/if}
```

## 4. Recovery codes

If the user loses their phone and didn't keep recovery codes, you have to manually disable 2FA (and probably verify identity through email). Make recovery codes **mandatory** at enrolment.

```ts
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';

function generateRecoveryCodes(count = 10): string[] {
	return Array.from({ length: count }, () => randomBytes(5).toString('hex'));
}

export const actions: Actions = {
	verify: async ({ request, locals }) => {
		// ... existing verify logic ...
		if (verifyErr) return fail(400, { error: 'Invalid code.' });

		const codes = generateRecoveryCodes(10);
		const hashes = await Promise.all(codes.map((c) => hash(c)));
		await locals.supabase
			.from('mfa_recovery_codes')
			.insert(hashes.map((hash) => ({ user_id: user.id, hash, used: false })));

		return { ok: true, recoveryCodes: codes }; // show ONCE on success page
	}
};
```

The recovery codes table:

```sql
create table public.mfa_recovery_codes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    hash text not null,
    used boolean not null default false,
    used_at timestamptz,
    created_at timestamptz not null default now()
);

create index mfa_recovery_codes_user_id_idx on public.mfa_recovery_codes (user_id);

alter table public.mfa_recovery_codes enable row level security;
-- No SELECT policy — only the service role reads codes (during recovery flow).
```

Display the codes _exactly once_ on the post-enrolment success page with a download/print prompt. Never make them retrievable later — re-generation invalidates the old set.

## 5. Step-up auth on sensitive routes

For routes that demand AAL2 (the billing portal, account deletion, data export):

`src/lib/server/auth/aal.ts`:

```ts
import { redirect, type RequestEvent } from '@sveltejs/kit';

export async function requireAAL2(event: RequestEvent): Promise<void> {
	const { data, error } = await event.locals.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
	if (error) throw redirect(303, '/login');

	if (data.currentLevel === 'aal2') return;

	if (data.nextLevel === 'aal2') {
		// User has MFA enrolled but session is AAL1 — step up.
		const challengeUrl = `/account/security/challenge?return=${encodeURIComponent(event.url.pathname)}`;
		throw redirect(303, challengeUrl);
	}

	// User doesn't have MFA at all — push them to enrolment.
	throw redirect(303, '/account/security?required=true');
}
```

Then in `/account/billing/+page.server.ts`:

```ts
export const load: PageServerLoad = async (event) => {
	await requireAAL2(event);
	// ... existing load logic ...
};
```

## 6. The challenge page

`/account/security/challenge/+page.server.ts`:

```ts
export const load: PageServerLoad = async ({ locals, url }) => {
	const { data: factors } = await locals.supabase.auth.mfa.listFactors();
	const factor = factors?.totp?.[0];
	if (!factor) throw redirect(303, '/account/security?required=true');

	const { data: challenge } = await locals.supabase.auth.mfa.challenge({ factorId: factor.id });
	return {
		factorId: factor.id,
		challengeId: challenge?.id ?? null,
		returnTo: url.searchParams.get('return') ?? '/'
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const data = await request.formData();
		const factorId = String(data.get('factorId') ?? '');
		const challengeId = String(data.get('challengeId') ?? '');
		const code = String(data.get('code') ?? '');
		const returnTo = String(data.get('returnTo') ?? '/');

		const { error } = await locals.supabase.auth.mfa.verify({ factorId, challengeId, code });
		if (error) return fail(400, { error: 'Invalid code.' });

		throw redirect(303, returnTo);
	}
};
```

The user sees a "Enter your 6-digit code" form, types the code, and lands on the page they were trying to reach. Now their session is AAL2 and `requireAAL2` lets them through.

## 7. Recovery code redemption

If the user has lost their authenticator:

```ts
export const actions = {
	recover: async ({ request, locals }) => {
		const data = await request.formData();
		const code = String(data.get('code') ?? '')
			.trim()
			.toLowerCase();

		const { user } = await locals.safeGetSession();
		if (!user) return fail(401);

		const { data: rows } = await withAdmin()
			.from('mfa_recovery_codes')
			.select('id, hash')
			.eq('user_id', user.id)
			.eq('used', false);

		for (const row of rows ?? []) {
			if (await verifyArgon2(row.hash, code)) {
				await withAdmin()
					.from('mfa_recovery_codes')
					.update({ used: true, used_at: new Date().toISOString() })
					.eq('id', row.id);
				const { data: factors } = await locals.supabase.auth.mfa.listFactors();
				for (const f of factors?.totp ?? []) {
					await locals.supabase.auth.mfa.unenroll({ factorId: f.id });
				}
				throw redirect(303, '/account/security?recovered=true');
			}
		}
		return fail(400, { error: 'Invalid recovery code.' });
	}
};
```

Recovery code usage **disables MFA** rather than logging the user in directly. Forces them to re-enrol with a fresh secret + fresh recovery codes.

## 8. Tests

Three layers:

1. **Unit:** `requireAAL2` redirect logic for each `(currentLevel, nextLevel)` combination.
2. **Integration:** enrolment flow → verify → AAL2 session.
3. **E2E (Playwright):** sign in → enrol 2FA → log out → log in → step-up → billing portal.

## 9. Acceptance checklist

- [ ] MFA enabled in Supabase project.
- [ ] `/account/security` enrolment page with QR code.
- [ ] Recovery codes generated and shown ONCE on enrolment.
- [ ] `mfa_recovery_codes` table with hashed codes.
- [ ] `requireAAL2(event)` helper redirects AAL1 users to challenge page.
- [ ] `/account/security/challenge` page with `?return=` redirect.
- [ ] Billing portal route requires AAL2.
- [ ] Recovery code redemption disables MFA and forces re-enrolment.

## What's next

Bonus 27 swaps the password flow entirely for **magic links** — sign-in with one click on a tokenised email link. Lower friction, higher conversion, and arguably more secure than the password-reset email flow you'd build anyway.
