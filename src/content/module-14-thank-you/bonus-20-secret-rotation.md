---
title: 'Bonus: Secret Rotation Without Downtime'
module: 14
lesson: 20
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-20-secret-rotation'
description: 'Rotate VERCEL_TOKEN, SUPABASE secrets, STRIPE_WEBHOOK_SECRET with zero failed requests. Two-phase rollout, preflight CI checks, and the trailing-newline gotcha that ate a real on-call shift.'
duration: 18
preview: false
---

# Bonus: Secret rotation without downtime

Secrets rotate. People leave. Tokens expire. The question isn't _whether_ you'll rotate `VERCEL_TOKEN` or `SUPABASE_ACCESS_TOKEN` — it's whether the rotation costs you 5 minutes or 5 hours.

This lesson is the operational playbook: a list of which secrets your CI depends on, a two-phase rollout pattern for the ones traffic actually depends on (`STRIPE_WEBHOOK_SECRET`), preflight CI checks that catch a stale secret in 10 seconds instead of 90, and the trailing-newline gotcha that turns a 5-minute rotation into a 2-hour debugging session.

By the end of this lesson you will:

- Inventory the deploy-time secrets your CI needs and their sources of truth.
- Add CI preflight steps that fail fast on missing or stale secrets.
- Rotate `VERCEL_TOKEN` correctly (avoiding the `gh secret set --body -` trailing-newline trap).
- Rotate `STRIPE_WEBHOOK_SECRET` with **zero failed webhook deliveries** using the two-secret overlap pattern.
- Set an annual rotation cadence and own each secret to a team.

## 1. Inventory

The Deploy workflow depends on six GitHub Actions secrets:

| Secret                  | Source                                                  | Rotates   |
| ----------------------- | ------------------------------------------------------- | --------- |
| `VERCEL_TOKEN`          | <https://vercel.com/account/tokens>                     | Annually  |
| `VERCEL_ORG_ID`         | `cat .vercel/project.json` after `pnpm dlx vercel link` | Stable    |
| `VERCEL_PROJECT_ID`     | `cat .vercel/project.json`                              | Stable    |
| `SUPABASE_ACCESS_TOKEN` | <https://supabase.com/dashboard/account/tokens>         | Annually  |
| `SUPABASE_PROJECT_REF`  | Supabase project URL (`<ref>.supabase.co`)              | Stable    |
| `SUPABASE_DB_PASSWORD`  | Supabase project, Settings, Database, Connection info   | As needed |

List them locally:

```bash
gh secret list
```

The Vercel project also has runtime secrets (set in Vercel's UI, not GitHub):

| Runtime secret              | Rotates                                   |
| --------------------------- | ----------------------------------------- |
| `STRIPE_SECRET_KEY`         | Annually or after a suspected leak        |
| `STRIPE_WEBHOOK_SECRET`     | Annually or after a webhook endpoint move |
| `SUPABASE_SERVICE_ROLE_KEY` | Annually                                  |
| `OPS_API_TOKEN`             | Quarterly or on team departure            |
| `SENTRY_AUTH_TOKEN`         | Annually                                  |

## 2. Preflight CI checks

Add these as the **first two steps** of `deploy.yml`, before `pnpm install`:

```yaml
- name: Preflight - required secrets present
  env:
    VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
    VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
  run: |
    for var in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; do
      if [ -z "${!var:-}" ]; then
        echo "::error::Required secret $var is empty or unset."
        exit 1
      fi
    done
    echo "All required secrets present."

- name: Preflight - Vercel token is live
  env:
    VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
  run: |
    response=$(curl -s -o /tmp/vercel-user.json -w '%{http_code}' \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      https://api.vercel.com/v2/user)
    if [ "$response" != "200" ]; then
      echo "::error::Vercel rejected VERCEL_TOKEN (HTTP $response)."
      cat /tmp/vercel-user.json
      exit 1
    fi
    user=$(jq -r '.user.username' /tmp/vercel-user.json)
    echo "Vercel token OK (authenticated as $user)"
```

Both preflights complete in under 10 seconds, so a stale secret surfaces long before the slow Supabase migration step burns minutes.

## 3. Rotating `VERCEL_TOKEN` (the most common rotation)

1. **Mint a new classic personal token** at <https://vercel.com/account/tokens>. Scope it to the team that owns the project, not your personal scope. Prefer 1-year expiry over no-expiration so rotation is forced annually.

2. **Update the GitHub secret.** Watch the trailing-newline gotcha:

   ```bash
   # CORRECT: --body reads the literal value, no trailing newline.
   gh secret set VERCEL_TOKEN --body 'vcp_paste_token_here'
   ```

   ```bash
   # WRONG: --body - reads stdin, which printf/echo/heredoc may end
   # with a trailing newline byte. The Vercel CLI then errors with:
   #   You defined "***token", but its contents are invalid.
   #   Must not contain: ***
   # GitHub Actions masks the literal newline character,
   # making the diagnosis cryptic.
   echo 'vcp_...' | gh secret set VERCEL_TOKEN --body -
   ```

3. **Verify the secret was accepted** by checking the timestamp:

   ```bash
   gh secret list | grep VERCEL_TOKEN
   ```

   The timestamp should be within seconds of the `gh secret set` call.

4. **Trigger a redeploy** without an empty commit:

   ```bash
   gh workflow run deploy.yml --ref main && gh run watch
   ```

   The first deploy step is `Preflight - Vercel token is live`. If it prints `Vercel token OK (authenticated as <username>)` the rotation worked. If it prints `Vercel rejected VERCEL_TOKEN`, the value made it into GitHub but Vercel still does not accept it: re-mint and repeat.

## 4. Rotating `STRIPE_WEBHOOK_SECRET` with zero downtime

Stripe sends webhooks _continuously_. If you simply replace `STRIPE_WEBHOOK_SECRET` with a new value, every in-flight delivery signed with the old secret fails verification → returns 4xx → Stripe marks it for retry. Some of those retries happen 5 minutes later, some 5 hours, some 5 days. Cleanup is a nightmare.

The right pattern is **two-secret overlap**:

```ts
// src/lib/server/stripe-webhooks.ts
import Stripe from 'stripe';
import { env as serverEnv } from '$env/dynamic/private';

const stripe = new Stripe(serverEnv.STRIPE_SECRET_KEY);

export function verifyStripeSignature(rawBody: string, signature: string): Stripe.Event {
	const secrets = [serverEnv.STRIPE_WEBHOOK_SECRET, serverEnv.STRIPE_WEBHOOK_SECRET_OLD].filter(
		Boolean
	);

	for (const secret of secrets) {
		try {
			return stripe.webhooks.constructEvent(rawBody, signature, secret as string);
		} catch {
			// Try the next secret.
		}
	}

	throw new Error('Stripe signature verification failed against all known secrets.');
}
```

Rollout:

1. **Add a NEW endpoint signing secret** in the Stripe Dashboard (Developers → Webhooks → your endpoint → "Signing secret" → "Roll secret"). Stripe prompts you to choose: roll immediately, or maintain both for a window. Choose **maintain both for 24 hours**.
2. Stripe gives you the new secret. Set `STRIPE_WEBHOOK_SECRET` to the new value in Vercel; move the OLD value to `STRIPE_WEBHOOK_SECRET_OLD`.
3. Deploy. Verification now tries the new secret first, falls through to the old one.
4. Wait 24 hours. All in-flight deliveries signed with the old secret are now resolved.
5. Remove `STRIPE_WEBHOOK_SECRET_OLD` from Vercel. Deploy. Done.

## 5. Rotating Supabase secrets

Same flow as `VERCEL_TOKEN`, swapping the secret name and the source dashboard.

The preflight catches missing values but cannot validate the Postgres password without actually connecting; the `Push Supabase migrations` step is the truth source.

- If it errors `password authentication failed`, rotate `SUPABASE_DB_PASSWORD`.
- If it errors `unauthorized` during `link`, rotate `SUPABASE_ACCESS_TOKEN`.
- If it errors `project ref not found`, rotate `SUPABASE_PROJECT_REF` (rare; only happens if the project was migrated or you switched orgs).

## 6. Recovery commands

Re-run only the failed jobs of the most recent Deploy run:

```bash
latest=$(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run rerun "$latest" --failed
```

Or trigger a brand-new Deploy without any code change:

```bash
gh workflow run deploy.yml --ref main && gh run watch
```

## 7. Why CI preflight matters

In a real on-call event, a `VERCEL_TOKEN` rotation took longer than it should have because:

1. The Vercel CLI gives a fail-late, redacted error (`its contents are invalid. Must not contain: ***`) when the token has any whitespace, but does not say so explicitly.
2. The `gh secret set --body -` form silently appends `\n` from `printf '%s' '...' | gh secret set ...` because GitHub's API stores exactly the bytes you send.
3. Nothing in the workflow validated the token before the slow steps, so the failure surfaced 90 seconds in.

The two preflight steps close all three. They:

- Validate every required secret name is non-empty (catches the "you forgot one of six" mistake).
- Hit `https://api.vercel.com/v2/user` with the token (catches expired/revoked/whitespace-mangled tokens with a clear HTTP code).
- Print the username on success so the on-call sees positive confirmation rather than guessing from green checks.

## 8. Annual schedule

| Cadence   | Secret                      | Owner          |
| --------- | --------------------------- | -------------- |
| Annually  | `VERCEL_TOKEN`              | Platform       |
| Annually  | `SUPABASE_ACCESS_TOKEN`     | Platform       |
| Annually  | `STRIPE_SECRET_KEY`         | Billing        |
| Annually  | `STRIPE_WEBHOOK_SECRET`     | Billing        |
| Annually  | `SUPABASE_SERVICE_ROLE_KEY` | Platform       |
| Annually  | `SENTRY_AUTH_TOKEN`         | Platform       |
| Quarterly | `OPS_API_TOKEN`             | Platform       |
| As-needed | `SUPABASE_DB_PASSWORD`      | DBA / Platform |
| Stable    | `*_ID`, `*_REF` identifiers | n/a            |

Set a calendar reminder for the first Monday of each fiscal quarter to review token expiries and rotate the annual ones together.

## 9. Acceptance checklist

- [ ] Preflight steps in `deploy.yml` validate all required secrets are non-empty.
- [ ] Preflight makes a live call to Vercel to confirm `VERCEL_TOKEN`.
- [ ] `gh secret set --body 'value'` form documented in the runbook (not `--body -`).
- [ ] `verifyStripeSignature` supports `STRIPE_WEBHOOK_SECRET` + `STRIPE_WEBHOOK_SECRET_OLD` overlap window.
- [ ] Annual rotation calendar reminder set.
- [ ] Each secret has a named owner.

## What's next

Bonus 21 starts the **cassette test harness track** — record real Stripe API responses once, replay them on every test run, get deterministic CI without paying for live Stripe calls per PR.
