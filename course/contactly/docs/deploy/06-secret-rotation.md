# Rotating CI deployment secrets

> Operational reference. Read once during onboarding; consult when a
> deploy fails the preflight checks or a token is expiring.

The `Deploy` workflow (`.github/workflows/deploy.yml`) depends on six
GitHub Actions secrets. Two `Preflight` steps run before `pnpm install`:

1. **Preflight - required secrets present.** Iterates the required list
   and fails with `::error::Required secret <NAME> is empty or unset.`
   if any value is missing.
2. **Preflight - Vercel token is live.** Calls
   `https://api.vercel.com/v2/user` with the token; fails with
   `::error::Vercel rejected VERCEL_TOKEN (HTTP <code>).` if Vercel
   does not accept the value.

Both preflights complete in under 10 seconds, so you discover a stale
secret long before the slow Supabase migration step burns minutes.

## Required secrets

| Secret                  | Source                                                    | Notes                                |
| ----------------------- | --------------------------------------------------------- | ------------------------------------ |
| `VERCEL_TOKEN`          | <https://vercel.com/account/tokens>                       | Classic personal token, team-scoped. |
| `VERCEL_ORG_ID`         | `cat .vercel/project.json` after `pnpm dlx vercel link`   | Stable per team.                     |
| `VERCEL_PROJECT_ID`     | `cat .vercel/project.json`                                | Stable per project.                  |
| `SUPABASE_ACCESS_TOKEN` | <https://supabase.com/dashboard/account/tokens>           | Used by `supabase link` / `db push`. |
| `SUPABASE_PROJECT_REF`  | Supabase project URL (`<ref>.supabase.co`)                | Stable per environment.              |
| `SUPABASE_DB_PASSWORD`  | Supabase project, Settings, Database, Connection info     | The Postgres role password.          |

List them locally:

```bash
gh secret list
```

## Rotating `VERCEL_TOKEN` (most common)

1. **Mint a new classic personal token** at
   <https://vercel.com/account/tokens> and click `Create Token`.
   Scope it to the team that owns the project, not your personal
   scope. Prefer 1-year expiry over no-expiration so rotation is
   forced annually.

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
   # because GitHub Actions masks the literal newline character,
   # making the diagnosis cryptic.
   echo 'vcp_...' | gh secret set VERCEL_TOKEN --body -
   ```

3. **Verify the secret was accepted** by checking the timestamp:

   ```bash
   gh secret list | grep VERCEL_TOKEN
   ```

   The timestamp should be within seconds of the `gh secret set` call.

4. **Trigger a redeploy** without an empty commit. `deploy.yml` exposes
   `workflow_dispatch`:

   ```bash
   gh workflow run deploy.yml --ref main && gh run watch
   ```

   The first deploy step is `Preflight - Vercel token is live`. If it
   prints `Vercel token OK (authenticated as <username>)` the rotation
   worked. If it prints `Vercel rejected VERCEL_TOKEN`, the value made
   it into GitHub but Vercel still does not accept it: re-mint and
   repeat.

## Rotating Supabase secrets

Same flow, swapping the secret name and the source dashboard.

The preflight catches missing values but cannot validate the Postgres
password without actually connecting; the `Push Supabase migrations`
step is the truth source.

- If it errors `password authentication failed`,
  rotate `SUPABASE_DB_PASSWORD`.
- If it errors `unauthorized` during `link`,
  rotate `SUPABASE_ACCESS_TOKEN`.
- If it errors `project ref not found`, rotate `SUPABASE_PROJECT_REF`
  (rare; only happens if the project was migrated or you switched orgs).

## One-time recovery commands

Re-run only the failed jobs of the most recent `Deploy` run:

```bash
latest=$(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run rerun "$latest" --failed
```

Or trigger a brand-new `Deploy` without any code change:

```bash
gh workflow run deploy.yml --ref main && gh run watch
```

## Why this exists

In April 2026 a `VERCEL_TOKEN` rotation took longer than it should have
because:

1. The CLI gives a fail-late, redacted error
   (`its contents are invalid. Must not contain: ***`) when the token
   has any whitespace, but does not say so explicitly.
2. The `gh secret set --body -` form silently appends `\n` from
   `printf '%s' '...' | gh secret set ...` because GitHub's API stores
   exactly the bytes you send.
3. Nothing in the workflow validated the token before the slow steps,
   so the failure surfaced 90 seconds in.

The two preflight steps in `deploy.yml` close all three. They:

- Validate every required secret name is non-empty (catches the
  "you forgot one of six" mistake).
- Hit `https://api.vercel.com/v2/user` with the token (catches
  expired/revoked/whitespace-mangled tokens with a clear HTTP code).
- Print the username on success so the on-call sees positive
  confirmation rather than guessing from green checks.

## Annual schedule (recommended)

| Cadence  | Secret                  | Owner          |
| -------- | ----------------------- | -------------- |
| Annually | `VERCEL_TOKEN`          | Platform       |
| Annually | `SUPABASE_ACCESS_TOKEN` | Platform       |
| As-need  | `SUPABASE_DB_PASSWORD`  | DBA / Platform |
| Stable   | `VERCEL_ORG_ID`         | n/a            |
| Stable   | `VERCEL_PROJECT_ID`     | n/a            |
| Stable   | `SUPABASE_PROJECT_REF`  | n/a            |

Set a calendar reminder for the first Monday of each fiscal quarter to
review token expiries and rotate the two annual ones together.
