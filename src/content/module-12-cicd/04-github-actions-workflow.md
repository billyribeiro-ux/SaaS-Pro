---
title: '12.4 - GitHub Actions Workflow'
module: 12
lesson: 4
moduleSlug: 'module-12-cicd'
lessonSlug: '04-github-actions-workflow'
description: 'Write the complete GitHub Actions workflow that automates testing and deployment on every push to main.'
duration: 20
preview: false
---

## Overview

This is the lesson where the pipeline we mapped in 12.1 becomes executable. A single YAML file — `.github/workflows/deploy.yml` — strings together every step from `git push` to `https://contactly.app updated` and commits it to the repo. From this lesson forward, Contactly deploys itself.

The workflow has eight steps. Each one is a self-contained unit that either passes (go to next) or fails (stop the pipeline). The ordering is intentional — fast cheap checks before slow expensive ones, migrations before deploys, deploys gated on a main-branch push. Every line has a reason.

I'll give you the full YAML first, then we dissect it. Think of it like reading a codebase top-down: skim the shape, then read each function.

## Prerequisites

- Lessons 12.1-12.3 completed — you have production Supabase, a Vercel project, and a working manual deploy.
- The Contactly repo on GitHub with write access.
- Playwright configured to run against a test Supabase project (you'll create one below if you don't have one yet).
- Tokens you've generated for Supabase and Vercel (we'll walk through creating these).

## What You'll Build

- A `.github/workflows/deploy.yml` file that runs on every push and PR.
- Eight steps: checkout, setup pnpm, setup Node, install deps, type-check, migrate DB, install Playwright, run tests, deploy.
- A set of GitHub repository secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `PUBLIC_SUPABASE_URL_TEST`, `PUBLIC_SUPABASE_ANON_KEY_TEST`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- Branch protection on `main` that requires the workflow to pass before merge.

---

## Step 1: Create the Workflow File

Make the folder and the file:

```bash
mkdir -p .github/workflows
touch .github/workflows/deploy.yml
```

The path is load-bearing — GitHub scans `.github/workflows/*.yml` specifically. Anywhere else in the repo and it's just a text file.

Now open `.github/workflows/deploy.yml` and paste in this entire file. Commit it as-is; we'll walk through every line afterward.

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm exec svelte-check --tsconfig ./tsconfig.json

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Push migrations
        run: supabase db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Run Playwright tests
        run: pnpm exec playwright test
        env:
          PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL_TEST }}
          PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.PUBLIC_SUPABASE_ANON_KEY_TEST }}

      - name: Deploy to Vercel
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: pnpm exec vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

Save it. Before we commit and push, let's read it end-to-end.

---

## Reading the Workflow, Top to Bottom

### The header: name and triggers

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

**`name: CI/CD`** — the display name in GitHub's Actions UI. Whatever you put here appears next to the check mark (or X) on your PR.

**`on:`** — when the workflow runs. Two triggers:

- `push:` with `branches: [main]` — fires every time someone pushes to main. In practice that's every time a PR gets merged (assuming you squash-merge), plus any direct pushes to main (which branch protection will soon forbid).
- `pull_request:` with `branches: [main]` — fires every time a PR is opened or updated against main. This is how PRs get validated: same pipeline runs, but the conditional `if:` on the deploy step means no production deploy happens.

**Why both triggers?** Because pull requests shouldn't deploy to production (obviously), but they should run tests so reviewers can see a green check mark. A PR with a red pipeline is unmergeable — that's the whole point of CI.

**What about other branches?** Contactly keeps only one protected branch: main. Feature branches don't run this workflow (no `branches: [dev, staging]` entries). If you later adopt a Git flow with `develop` and `release/*` branches, add them to the trigger list.

### The job: `test-and-deploy`

```yaml
jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    steps: ...
```

**`jobs:`** — workflows have one or more jobs. Jobs run in parallel by default (on separate runners) unless one `needs:` another. Our single job is `test-and-deploy`; we intentionally put all steps in one job so they share the same file system — the dependencies installed in step 4 are available for step 5, the built artifacts from step 5 are available for step 6, etc.

**`runs-on: ubuntu-latest`** — the VM image. `ubuntu-latest` tracks the current LTS Ubuntu (22.04 as of 2026). Fast boot, pre-installed with most dev tools. Alternatives: `ubuntu-22.04` (pinned), `macos-latest` (expensive — 10x the minutes cost), `windows-latest`. Ubuntu is correct for Node-based apps; no reason to use anything else for Contactly.

### Step 1: Checkout

```yaml
- name: Checkout
  uses: actions/checkout@v4
```

Every workflow starts with checkout. This action clones the repository onto the runner, checked out to the commit that triggered the workflow. Without it, subsequent steps have nothing to build.

`@v4` pins the major version. GitHub publishes patch updates (`v4.0.1`, `v4.2.0`) within the major; we automatically get them. A new major (`v5`) might introduce breaking changes, so we stay on `v4` until we choose to upgrade. Always pin to a major version — never use `@latest` for actions you don't control.

### Step 2: Setup pnpm

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: latest
```

GitHub runners don't come with pnpm pre-installed. This action installs it. `version: latest` grabs the most recent stable release; alternatively you can pin (`version: 9.12.0`) for perfect reproducibility. `latest` works well enough because pnpm's backward compatibility is strong.

**Important sequencing:** pnpm setup must come **before** Node setup, because we configure Node's cache to use pnpm (next step).

### Step 3: Setup Node.js

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: pnpm
```

**`node-version: 22`** — match your production Node version exactly. We set `runtime: 'nodejs22.x'` in `svelte.config.js` (lesson 12.3). Building with Node 22 and running on Node 22 means identical behavior.

**`cache: pnpm`** — huge speedup. On the first CI run, this does nothing; pnpm downloads every dependency and caches it via GitHub's cache store. On every subsequent run, `pnpm install` restores the cache, skipping the network entirely for unchanged deps. Install time drops from ~60s to ~5-10s. Free performance.

### Step 4: Install dependencies

```yaml
- name: Install dependencies
  run: pnpm install --frozen-lockfile
```

`--frozen-lockfile` is non-negotiable. Without it, pnpm might resolve different versions if `pnpm-lock.yaml` is stale, making your CI builds non-deterministic. With it, pnpm fails immediately if the lockfile doesn't match `package.json` — forcing you to commit lockfile changes, which is what you want.

Pro tip: run `pnpm install --frozen-lockfile` locally before every commit that changes `package.json`. If it fails, run `pnpm install` (without the flag) to regenerate the lockfile, then commit the lockfile change.

### Step 5: Type check

```yaml
- name: Type check
  run: pnpm exec svelte-check --tsconfig ./tsconfig.json
```

`svelte-check` is Svelte's dedicated type checker. It understands both TypeScript files and type annotations inside `.svelte` files. Running it explicitly here catches type errors that Vite's build process might skip (Vite prioritizes speed over strict typing).

**Why first (among real checks)?** It's fast — typically 10-30 seconds even for a big app. If it fails, we've wasted one minute rather than eight. Fast feedback.

`--tsconfig ./tsconfig.json` points to the repo's TypeScript config. Ensures svelte-check uses the same compiler options as your IDE.

### Step 6: Setup Supabase CLI

```yaml
- name: Setup Supabase CLI
  uses: supabase/setup-cli@v1
  with:
    version: latest
```

Official action maintained by Supabase. Installs the CLI to the runner's path, so subsequent `supabase ...` commands work.

### Step 7: Push migrations

```yaml
- name: Push migrations
  run: supabase db push --linked
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
```

The critical step. Reaches out to your production Supabase project and applies any migrations that haven't been run yet.

**`--linked`** — uses the linked project from `.temp/project-ref`. But wait — CI doesn't run `supabase link` first, and `.temp/project-ref` is in `.gitignore`. How does this know which project to target?

The answer: in CI, we authenticate differently. The `SUPABASE_ACCESS_TOKEN` env var lets the CLI skip the browser login. For `--linked` to work, we need the project ref somewhere — either pre-linked (via a committed `supabase/.temp/project-ref` file) or specified explicitly.

**Best practice:** commit a `supabase/config.toml` with `project_id = "xyzabcdefgh"` set. The CLI reads this and uses it as the linked ref without needing `.temp/project-ref`. Your local `supabase link` also updates `config.toml`, so this is automatic. If you haven't committed `config.toml`, do it now:

```bash
git add supabase/config.toml
git commit -m "Commit Supabase project config"
```

**The two secrets:**

- `SUPABASE_ACCESS_TOKEN` — personal access token you generate at supabase.com/dashboard/account/tokens. Tells the CLI "I'm authorized as this Supabase account user." Treat like a password.
- `SUPABASE_DB_PASSWORD` — the database password you set in lesson 12.2. The CLI uses it to authenticate to Postgres for the actual `db push`.

We'll add these to GitHub secrets below.

### Step 8: Install Playwright browsers

```yaml
- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium
```

Playwright is a npm package, but the actual browsers it drives are downloaded separately (they're ~100MB each). `playwright install` fetches them.

**`--with-deps`** — also installs system libraries needed by Chromium (fonts, audio libs, etc.). Required on Ubuntu; the base image doesn't have them all.

**`chromium`** — we only install Chromium here. Playwright can drive Chromium, Firefox, and WebKit; if your test matrix includes all three, use `pnpm exec playwright install --with-deps` without the browser name. Contactly only runs Chromium in CI — faster — and we don't see cross-browser-specific bugs often enough to justify the 3x run time.

### Step 9: Run Playwright tests

```yaml
- name: Run Playwright tests
  run: pnpm exec playwright test
  env:
    PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL_TEST }}
    PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.PUBLIC_SUPABASE_ANON_KEY_TEST }}
```

Runs the full Playwright suite. The workflow **passes** if every test passes; fails on the first red.

**`PUBLIC_SUPABASE_URL_TEST` and `PUBLIC_SUPABASE_ANON_KEY_TEST`** — the test Supabase project's URL and anon key. Note the different variable names in secrets (with `_TEST` suffix) vs. the env vars Contactly's code reads (`PUBLIC_SUPABASE_URL` without the suffix). We remap them here so Contactly's code sees the test project as if it were the only Supabase project that exists.

**You need a second Supabase project for CI tests.** Create one at supabase.com, named `contactly-test`. Run the same migrations against it (`supabase link --project-ref <test-ref>` then `supabase db push`). Grab its URL and anon key. These become `PUBLIC_SUPABASE_URL_TEST` and `PUBLIC_SUPABASE_ANON_KEY_TEST`.

Why separate from production? Because Playwright tests create fake users, click around, and delete things. You **never** want those actions touching real customer data. Two independent projects, two independent databases, zero chance of contamination.

### Step 10: Deploy to Vercel

```yaml
- name: Deploy to Vercel
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  run: pnpm exec vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
  env:
    VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

The only step guarded by `if:`. Two conditions:

- `github.event_name == 'push'` — not a pull request. PRs skip this step.
- `github.ref == 'refs/heads/main'` — only the `main` branch deploys. A direct push to a feature branch (if branch protection somehow allows it) wouldn't deploy.

**`vercel --prod --token=...`** — deploys to production (not a preview). The `--token` argument authenticates the CLI.

**Three Vercel secrets:**

- `VERCEL_TOKEN` — generated at vercel.com/account/tokens. Scoped to your account; treat as a password.
- `VERCEL_ORG_ID` — the ID of your Vercel team/account. Found in **Settings** → **General**.
- `VERCEL_PROJECT_ID` — the ID of the specific Contactly project. Found in your project's **Settings** → **General**.

Both org and project IDs are required because `vercel --prod` outside of a `vercel link`-ed directory needs to know which project to deploy. In our case the CI runner has never been `vercel link`-ed, so we pass them explicitly via env.

---

## Step 2: Add All the Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add each one, one at a time. Name (uppercase, underscores) → Value (paste, no quotes). Here's the full list:

| Secret Name                     | Value                        | Source                                           |
| ------------------------------- | ---------------------------- | ------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN`         | `sbp_...`                    | supabase.com/dashboard/account/tokens → Generate |
| `SUPABASE_DB_PASSWORD`          | (your prod DB password)      | Password manager from lesson 12.2                |
| `PUBLIC_SUPABASE_URL_TEST`      | `https://abc123.supabase.co` | Test Supabase project → Settings → API           |
| `PUBLIC_SUPABASE_ANON_KEY_TEST` | `eyJ...`                     | Test Supabase project → Settings → API           |
| `VERCEL_TOKEN`                  | `abc123...`                  | vercel.com/account/tokens → Create               |
| `VERCEL_ORG_ID`                 | `team_abc` or `user_abc`     | Vercel → Settings → General                      |
| `VERCEL_PROJECT_ID`             | `prj_abc`                    | Vercel project → Settings → General              |

Seven secrets. Miss any one and the pipeline fails.

**One-time gotcha:** GitHub secrets cannot be read back after saving. If you paste a value wrong, you can't see what's there — you have to delete the secret and re-add it. Paste carefully.

---

## Step 3: Commit and Push

```bash
git add .github/workflows/deploy.yml
git commit -m "Add CI/CD workflow"
git push origin main
```

Immediately, the workflow starts. Go to your repo's **Actions** tab. You'll see a new run called "Add CI/CD workflow" (or whatever you named the commit). Click in and watch the steps execute in real time.

First runs usually reveal something missed — a typo in a secret name, a missing env var, a migration that fails in prod but not local. Fix issues iteratively. Every push to main runs the pipeline again.

---

## Step 4: Enable Branch Protection

The workflow is useless if someone can push directly to main and skip it. Turn on branch protection.

GitHub → repo **Settings** → **Branches** → **Add rule** (or **Edit** an existing rule for main).

**Branch name pattern:** `main`

Enable:

- **Require a pull request before merging** — direct pushes to main are blocked. Everything goes through a PR.
- **Require status checks to pass before merging** — PRs can't be merged until the CI pipeline is green.
  - In the search box, find `test-and-deploy` (the job name from our workflow) and add it as a required check.
- **Require branches to be up to date before merging** — enforces a rebase/merge-main before PRs can be merged. Prevents "merge conflict in main" surprises.
- **Do not allow bypassing the above settings** — even admins can't bypass. Non-negotiable for any production app.

Save. Try to push directly to main: `git push origin main` → rejected. The only path to main is through a PR with a green pipeline.

---

## Common Mistakes

- **Copying secrets with trailing newlines.** Shell tools sometimes paste values with a trailing `\n`. Supabase and Vercel CLIs validate tokens strictly — a trailing newline makes them fail with inscrutable 401 errors. When adding secrets, paste and confirm the value has no trailing whitespace.
- **Mixing up `secrets.X` and `vars.X` syntax.** GitHub supports both **secrets** (encrypted, for sensitive values) and **variables** (plaintext, for non-sensitive config). Our workflow uses `secrets.X` everywhere. Using `vars.X` accidentally would cause runtime errors.
- **Forgetting `--frozen-lockfile`.** Without it, CI installs whatever version resolves today. Suddenly last month's PR fails to build today because a transitive dep shipped an incompatible patch. Frozen lockfile keeps you deterministic.
- **Running migrations against the wrong project.** If your `supabase/config.toml` has the **test** project ID and your pipeline runs `db push --linked`, you just migrated the test DB instead of prod. Double-check `config.toml` commits the **production** project_id.
- **Wrong job name in branch protection.** The required status check name must match the workflow's job name exactly. Our job is `test-and-deploy`, so the required check is `test-and-deploy`. A typo here means the protection rule never finds the check and PRs can be merged regardless.
- **Running Playwright against production Supabase.** Easy to do by accident — maybe you set `PUBLIC_SUPABASE_URL_TEST` to the prod URL by mistake. Tests create and delete users, mutate data. In a few seconds you've corrupted production. Verify the test URL is different from the prod URL before your first CI run.

---

## Principal Engineer Notes

### Secret scoping and the principle of least privilege

Every secret in our workflow has broader access than it strictly needs.

- `SUPABASE_ACCESS_TOKEN` grants access to **every** Supabase project under your account. If you manage a dozen projects, this token can push migrations to all of them. Supabase doesn't currently offer project-scoped tokens (they may in the future).
- `VERCEL_TOKEN` is similar — it works across every Vercel project your account owns.

Mitigations:

- **Separate accounts for CI.** Some teams create a dedicated "ci-bot@company.com" account that's a member of the Supabase org and Vercel team with only the permissions it needs. If the token leaks, the blast radius is scoped.
- **Rotate regularly.** Set a 90-day rotation policy. Whoever's on call that month generates fresh tokens, updates the GitHub secrets, and deletes the old ones.
- **Audit logs.** Both Supabase and Vercel have audit logs. Monitor them for unexpected API calls — especially from CI tokens.

### Branch protection rules beyond the basics

We enabled the core protections. Production teams layer on more:

- **Require signed commits.** Ensures every commit is GPG/SSH-signed. Raises the bar on who can author code ("did someone push using a teammate's hijacked laptop?").
- **Require linear history.** Forbids merge commits; only rebase or squash. Cleaner git log.
- **Require CODEOWNERS review.** A `.github/CODEOWNERS` file maps paths to reviewers. Changes to `supabase/migrations/` require a database expert's approval. Changes to auth routes require a security engineer's approval. Enforced by GitHub.
- **Required conversation resolution.** PRs can't be merged while there are unresolved review comments. Forces explicit resolution.

### Required checks are a contract

The check name in branch protection ("test-and-deploy must pass") is a contract. Renaming the job in `deploy.yml` silently breaks the contract — the check becomes non-required because it no longer exists by that name, and PRs can be merged freely. Before renaming a job, update the branch protection rule. Or, more robustly, never rename a job name once it's in production use.

### Concurrency groups to prevent race deploys

Our current workflow has a subtle bug: if two people merge PRs within 30 seconds of each other, two deploy runs fire in parallel. Both try to deploy to Vercel at the same time; the second overwrites the first. Worse, both try to run `supabase db push` simultaneously — one might succeed, the other fails with a lock conflict.

The fix: **concurrency groups**. Add this to the job:

```yaml
jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-${{ github.ref }}
      cancel-in-progress: false
    steps: ...
```

- `group: deploy-${{ github.ref }}` — all runs on the same branch share a group name.
- `cancel-in-progress: false` — if a second run queues while one is in flight, it **waits** rather than cancelling the first. For deploys, never cancel in-progress — you could leave the DB half-migrated.

With this, merges to main serialize. Deploy-after-deploy-after-deploy. Deterministic order.

### The `-e` flag and env handling

GitHub Actions runs each `run:` line in bash by default with `-e` flag (exit on error) and `-o pipefail` (fail pipe on any failed stage). Good defaults — a failing command aborts the step.

But watch out: env vars you set via `env:` at the step level are **only** available to that step. Not to subsequent steps. If you need to share values across steps, write to `$GITHUB_ENV`:

```yaml
- name: Compute version
  run: echo "APP_VERSION=$(git rev-parse --short HEAD)" >> $GITHUB_ENV
- name: Deploy with version
  run: echo "Deploying version $APP_VERSION"
```

Contactly doesn't need this pattern today; when it does (say, tagging Sentry releases with commit SHAs), you'll reach for it.

### Caching beyond pnpm

We cache pnpm's store. You can cache more:

- **Playwright browsers** — `~/.cache/ms-playwright` on Ubuntu. Saves 30s per run.
- **SvelteKit build artifacts** — `.svelte-kit/` can be partially cached to speed up incremental builds.
- **Supabase CLI binary** — caching the CLI download saves a few seconds.

All are optional. Measure first (how long is your pipeline currently?), optimize second.

### Observability of the pipeline itself

When a step fails, you look at the GitHub Actions log. But GitHub's log viewer is clunky for anything beyond a few hundred lines. For long logs:

- **Upload artifacts on failure.** Test result XML, Playwright traces, screenshots. `actions/upload-artifact@v4`. Reviewers can download them.
- **Annotations.** Playwright supports GitHub Actions reporter, which surfaces test failures as PR annotations (inline comments on the exact lines that failed).
- **Integrations with Slack/PagerDuty.** A failed deploy to main is a pageable event in real teams. Tools like [slack-github-action](https://github.com/slackapi/slack-github-action) post a message on failure.

For Contactly today, GitHub's built-in UI is enough. When you grow, layer on observability progressively.

---

## What's Next

The pipeline is live. Every push to main runs type check, migrations, Playwright, deploy — automatically, without your involvement. Real customers can sign up, log in, create contacts on the production URL Vercel gave you.

The only thing still running in test mode: Stripe. Contactly's billing flow currently uses Stripe test keys (`sk_test_...`), which means subscriptions "work" but no real money moves. Lesson 12.5 swaps to live Stripe keys, registers the production webhook endpoint with Stripe, and makes Contactly a real paid product.
