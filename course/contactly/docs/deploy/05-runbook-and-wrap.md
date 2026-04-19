# 11.5 — Production deploy runbook

> **Module 11 — Production deploy & adapter swap.**
>
> Lesson 5 of 5. The on-call playbook for everything we shipped
> in lessons 11.1–11.4. Read top-to-bottom once during onboarding;
> use as a reference during incidents.

This runbook is **incident-shaped** rather than feature-shaped.
Every section starts with the symptom an operator will see
("503 from `/api/version`", "Sentry showing minified frames")
and ends with a fix that doesn't require digging.

## Preflight (one-time setup)

These are the things to do **before** the runbook below becomes
useful. If a section says "see preflight" and the preflight item
isn't done, that's the bug.

1. **Vercel project linked.**

   ```bash
   pnpm dlx vercel link
   pnpm dlx vercel env pull .env.production.local
   ```

   The pulled file is gitignored; never commit it.

2. **Production env vars configured in Vercel** (`Project →
Settings → Environment Variables`):

   | Var                             | Where                | Example value                                  |
   | ------------------------------- | -------------------- | ---------------------------------------------- |
   | `PUBLIC_SUPABASE_URL`           | Production           | `https://abc.supabase.co`                      |
   | `PUBLIC_SUPABASE_ANON_KEY`      | Production           | `eyJ...`                                       |
   | `SUPABASE_SERVICE_ROLE_KEY`     | Production           | `eyJ...` (service role)                        |
   | `STRIPE_SECRET_KEY`             | Production           | `rk_live_...` (Restricted)                     |
   | `STRIPE_WEBHOOK_SECRET`         | Production           | `whsec_...` (live endpoint)                    |
   | `PUBLIC_STRIPE_PUBLISHABLE_KEY` | Production           | `pk_live_...`                                  |
   | `PUBLIC_SENTRY_DSN`             | Production + Preview | `https://...sentry.io/1`                       |
   | `SENTRY_AUTH_TOKEN`             | Production + Preview | `sntrys_...`                                   |
   | `SENTRY_ORG`                    | Production + Preview | your slug                                      |
   | `SENTRY_PROJECT`                | Production + Preview | `contactly`                                    |
   | `OPS_API_TOKEN`                 | Production           | `crypto.randomBytes(32).toString('base64url')` |
   | `RESEND_API_KEY`                | Production           | `re_...`                                       |

3. **Stripe live webhook endpoint pointed at**
   `https://contactly.app/api/webhooks/stripe` with these
   events: `invoice.*`, `customer.subscription.*`,
   `checkout.session.completed`. Copy the live signing secret
   into `STRIPE_WEBHOOK_SECRET` (production scope only).

4. **Sentry release-tracking** smoke-tested:
   - Push a small change to `main`.
   - In Vercel build logs, look for
     `[sentry-vite-plugin] Successfully uploaded source maps to Sentry`.
   - In Sentry → Releases, confirm the new
     `contactly@<sha>` appears with non-zero artifact count.
   - Trigger an error (`/api/admin/webhooks/replay` with a
     malformed event id, signed in as a platform admin); the
     resulting issue should show `.svelte` / `.ts` source frames,
     not minified chunks.

5. **First-deploy admin promotion** — the migration from
   Module 10.3 ships `is_platform_admin = false` for everyone.
   To promote yourself:

   ```sql
   -- Run via Supabase SQL editor while signed in as service role.
   update public.profiles set is_platform_admin = true
   where id = '<your-auth-uid>';
   ```

   The `profiles_protect_admin_flag` trigger ensures only the
   service role can flip this column.

6. **Monitor wired up** (UptimeRobot, Datadog Synthetics, ...):
   - `GET /api/version` — every 1 min, alert on non-200 or
     `commit` mismatching the latest deploy SHA.
   - `GET /api/admin/webhooks/health` with `Authorization:
Bearer <OPS_API_TOKEN>` — every 5 min, alert on 503.

## Incident: `/api/version` returns the wrong commit

**Symptom:** monitor flags that the deployed `commit` doesn't
match the SHA the CI runner pushed, or `/api/version` 404s.

**Likely causes, in order:**

1. **Deploy still in progress.** Vercel shows "Building" / "Deploying"
   in the Deployments tab. Wait, then re-check.
2. **CDN cache serving the previous version's response.** The
   handler explicitly sets `Cache-Control: no-store`, but a
   custom Vercel cache rule could override it. Inspect:
   ```bash
   curl -sI https://contactly.app/api/version | grep -i cache
   ```
3. **A deploy was rolled back.** Check `Vercel → Deployments → Promote`
   history for the production alias.
4. **Vercel didn't inject `VERCEL_GIT_COMMIT_SHA`.** Should
   never happen for a git-driven deploy, but a `vercel deploy`
   from a detached HEAD (manual deploy) leaves the var unset and
   `/api/version` returns `contactly@dev`. Re-deploy from the
   git integration.

**Resolution:**

```bash
# Force-purge the Vercel CDN for this path:
pnpm dlx vercel deploy --prod
# (Re-deploys with the same code; new immutable URL flushes the alias.)

# Sanity check:
deployed=$(curl -s https://contactly.app/api/version | jq -r .commit)
expected=$(git rev-parse HEAD)
[[ "$deployed" == "$expected" ]] && echo "ok" || echo "MISMATCH"
```

## Incident: Sentry stack traces are minified

**Symptom:** opened a Sentry issue, frames look like
`f3 (chunks/dashboard-Br4VGqxs.js:1:14821)` instead of
`PlanSection.svelte:62`.

**Likely causes:**

1. **Source-map upload skipped.** Vercel build logs do not
   contain `[sentry-vite-plugin] Successfully uploaded source
maps to Sentry`. Causes:
   - One of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
     missing from the deploy env. The cross-field validator
     catches "token without org/project" at server boot — check
     the deploy's runtime logs.
   - Plugin's `disable: true` (it's our explicit gate) because
     the env-var triple isn't set in the build environment, only
     in the runtime environment. **Both** environments need the
     three Sentry vars set in Vercel (Build + Runtime, not just
     Runtime).
2. **Release tag mismatch.** Plugin uploaded under one name,
   runtime SDK tagged events with another. Confirm by:
   - The Sentry issue → "Release" — note the value.
   - Sentry → Releases → search for that exact value. If the
     release exists but has 0 artifacts, the plugin uploaded to
     a different release name.
   - Module 11.3 collapsed both call sites onto
     `src/lib/release.ts`, so the only way for them to drift is
     a code-level change. `git log src/lib/release.ts
vite.config.ts src/lib/sentry-shared.ts` — whatever's most
     recent is the suspect.
3. **Source maps were emitted but not uploaded.** A Sentry API
   outage during the build, with the plugin's `errorHandler`
   downgrading to a warning. Re-deploy after Sentry's status
   page shows green; the source-map upload uses
   `filesToDeleteAfterUpload` so subsequent deploys re-create the
   maps.

**Resolution:** force a re-deploy after fixing the env var or
the API outage. The runtime SDK lazy-symbolicates from the
**latest** release that has artifacts, so the next clean upload
fixes already-captured events too.

## Incident: HSTS pinned a wrong host

**Symptom:** developer reports `localhost:5173` refusing HTTP
("This site cannot be reached. localhost sent an invalid
response. NET::ERR_CERT_AUTHORITY_INVALID").

**Likely cause:** they navigated to a production-staging URL
once (which set HSTS), then opened a dev server on the same
hostname (some teams use `app.dev.contactly` for both). The
browser is honouring the HSTS pin from the staging session.

**Resolution:**

```bash
# Chrome / Edge:
#   chrome://net-internals/#hsts
#   "Delete domain security policies" → enter the host

# Firefox:
#   Settings → Privacy & Security → Cookies and Site Data → Manage Data
#   Remove the host

# Production HSTS is set with `preload` so once the host is
# accepted into the HSTS preload list, no opt-out path exists for
# end users. That's intentional for production; the production
# hostname (`contactly.app`) is a stable, dedicated zone.
```

The header itself is **only** set when `resolveEnvironment()` is
`'production'`, so this should never affect dev URLs unless one
machine accidentally serves both production and dev from the
same hostname. Don't.

## Incident: Preview deploy showing up in Google search

**Symptom:** `site:vercel.app contactly` returns a result.

**Likely cause:** a third party linked the preview URL from a
public page; Google followed the link before our `noindex`
header was in place, or before the dynamic `/robots.txt` was
deployed.

**Resolution:**

1. Verify the headers are now correct:
   ```bash
   curl -sI https://contactly-git-feature-x-d3f.vercel.app/ \
     | grep -i x-robots-tag
   # X-Robots-Tag: noindex, nofollow
   curl -s https://contactly-git-feature-x-d3f.vercel.app/robots.txt
   # User-agent: *
   # Disallow: /
   ```
2. Submit a removal request via Google Search Console
   ("Removals" → "Outdated content").
3. The next crawl will find the noindex header and drop the URL.
   Lead time: hours-to-days.

If the headers are **not** correct, the `securityHeadersHandle`
isn't running on that route. Likely cause: a `+server.ts` or
`+page.server.ts` returning a `Response` object directly without
going through SvelteKit's lifecycle (rare; we don't do this
today). Audit + add the missing call.

## Incident: a deploy times out at 30 seconds

**Symptom:** Vercel function logs show `Function execution
timed out after 30000 ms`.

**Root cause possibilities:**

- **A `load` is awaiting an external API that's down.** Stripe
  is the most likely culprit; Supabase next. Both have status
  pages.
- **A webhook handler is in a loop.** `pnpm run db:status` against
  the prod schema; check `select count(*) from stripe_events
where processed_at is null;` — if the count is climbing, the
  dispatcher is stuck.
- **`maxDuration` was bumped past 30s previously and rolled
  back.** Check `svelte.config.js`'s `adapter({ maxDuration })`
  — should be `30`. Bumping it for a single slow route is the
  wrong shape; refactor the route to do the slow work async
  (queue + worker) instead.

**Resolution:**

- Roll back to the previous known-good deploy via Vercel's
  Promote action.
- File the root cause in the postmortem template.
- If the root cause is a stuck webhook, Module 10.4's
  `/admin/webhooks` dashboard's "Replay" button is the recovery
  path — once you've root-caused the stuck dispatch logic and
  shipped a fix, replay the backlog.

## Routine hygiene

Done weekly during low-traffic windows.

| Item                                                  | Where                                    | Frequency  |
| ----------------------------------------------------- | ---------------------------------------- | ---------- |
| Sentry quota usage                                    | Sentry → Stats                           | Weekly     |
| Webhook backlog count (should be 0 most of the time)  | `/admin/webhooks`                        | Daily      |
| Vercel function execution time p95 (should be < 1 s)  | Vercel → Analytics → Functions           | Weekly     |
| Vercel build logs for `[sentry-vite-plugin] Uploaded` | Per deploy                               | Per deploy |
| Stripe live-mode webhook delivery success rate        | Stripe Dashboard → Developers → Webhooks | Weekly     |
| `OPS_API_TOKEN` rotation                              | Vercel env + monitor configs             | Quarterly  |
| Sentry `SENTRY_AUTH_TOKEN` rotation                   | Vercel env + Sentry settings             | Quarterly  |

## Token rotation procedure (`SENTRY_AUTH_TOKEN`)

1. Mint the new token in Sentry (`Settings → Auth Tokens →
Create Internal Integration`). Same scopes:
   `project:write`, `release:admin`. Nothing more.
2. Add it to Vercel **alongside** the old one (use a different
   name temporarily, e.g. `SENTRY_AUTH_TOKEN_NEW`).
3. Trigger a deploy with the new token name; verify source-map
   upload succeeds.
4. Promote `SENTRY_AUTH_TOKEN_NEW` → `SENTRY_AUTH_TOKEN` (rename
   in Vercel).
5. Revoke the old token in Sentry.

The cross-field validator (`SENTRY_AUTH_TOKEN` set without
org/project) catches the "wrong env var name" mistake at server
boot, which is the failure mode rotation procedures most often
hit.

## Token rotation procedure (`OPS_API_TOKEN`)

1. Generate the new token:
   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
   ```
2. Add it to Vercel under a new name (e.g.
   `OPS_API_TOKEN_NEW`).
3. Add the new value to every monitor that calls
   `/api/admin/webhooks/health`.
4. Trigger a deploy that has both names set. Verify the monitors
   still get 200s.
5. Rename `OPS_API_TOKEN_NEW` → `OPS_API_TOKEN` in Vercel; the
   constant-time comparison in `requireAdminOrToken` will now
   accept only the new value.

## Verification matrix

The single command to confirm everything wired in this module is
healthy:

```bash
prod=https://contactly.app

# Release identity exposed
curl -s "$prod/api/version" | jq .

# Headers
curl -sI "$prod/" | egrep -i 'strict-transport|x-content|x-frame|referrer|coop|corp|permissions|x-robots' | sort

# robots.txt is the production variant
curl -s "$prod/robots.txt"

# Webhook backlog is healthy
curl -sH "Authorization: Bearer $OPS_API_TOKEN" "$prod/api/admin/webhooks/health" | jq .status
```

Expected results:

- `/api/version`: `release` matches the latest commit, `commit`
  is the full SHA, `environment` is `'production'`, `branch` is
  `null`.
- Headers: HSTS present, `X-Robots-Tag` absent (production is
  indexable).
- `/robots.txt`: includes the `Sitemap: https://contactly.app/sitemap.xml`
  line and the marketing-friendly Disallow list.
- `/api/admin/webhooks/health`: `"healthy"`.

If any line above is wrong, the corresponding incident section
is the next read.

---

## Module 11 — wrap

Five lessons. One unified production-deploy story.

### What we built

```
┌─────────────────────────────────────────────────┐
│  Operational runbook (Lesson 11.5)              │
│  Incident-shaped on-call playbook              │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────────────────────────────────────────┐
│  Security & preview hardening (Lesson 11.4)      │
│  - Per-env header table (HSTS, COOP, CORP, …)    │
│  - Dynamic /robots.txt                           │
└──────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────┐
│  Release identity (Lesson 11.3)                  │
│  - src/lib/release.ts (single source of truth)   │
│  - GET /api/version (smoke-test probe)           │
│  - Admin chrome deploy strip                     │
└──────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────┐
│  Source-map upload (Lesson 11.2)                 │
│  - @sentry/vite-plugin, gated by SENTRY_AUTH_TOKEN│
│  - Maps deleted post-upload                      │
└──────────────────────────────────────────────────┘
               │
┌──────────────────────────────────────────────────┐
│  Vercel adapter (Lesson 11.1)                    │
│  - Pinned runtime/region/memory/maxDuration      │
│  - vercel.json cache rules                       │
└──────────────────────────────────────────────────┘
```

Everything above the adapter inherits the adapter's pinned
shape; everything above the source-map upload inherits the
release tag; everything above the security headers inherits
defaults. No layer punches through to a layer below it.

### Cross-cutting design principles (Module 11)

- **Pin everything pinnable.** Adapter, runtime, region, memory,
  timeout, install command, build command, Node version. A
  deploy that worked yesterday must work today.
- **Single source of truth for release identity.** `release.ts`
  is the only place release shape is defined; both the build
  pipeline and the runtime SDK import from it.
- **Pure cores, async shells.** `securityHeaders` is a pure
  function tested without a Response object; `applySecurityHeaders`
  is the IO shell. Same pattern as Module 10.
- **Fail closed.** Security headers default to the strictest
  reasonable value; per-route override is the escape hatch. HSTS
  in production only because mis-pinning a dev cert is a
  multi-week operator pain.
- **Preview deploys are first-class but invisible to the
  internet.** Preview gets the full Sentry pipeline (including
  source-map upload), but `/robots.txt` and `X-Robots-Tag`
  guarantee no preview URL ever ships to a search index.
- **Local dev never lights up production.** No Sentry token,
  upload skipped. No Vercel SHA, release tag is `dev`. No
  `OPS_API_TOKEN`, bearer branch closed. The student running
  `pnpm run dev` after cloning sees nothing fire externally.

### What's deliberately out of scope

- **Content-Security-Policy.** Highest-impact remaining header,
  hardest to ship without breaking. Lands in a dedicated module
  with a report-only rollout phase.
- **Automatic Vercel→Sentry deploy notification.** Vercel deploy
  hook → Sentry deploys API would close the "release exists →
  release deployed at T" loop. One-page lesson on its own.
- **Per-route runtime overrides (edge for marketing, Node for
  app).** Module 13 with benchmarks.
- **Multi-region deploy.** Single-region is a billing decision,
  not a wiring decision.
- **End-to-end Stripe scenarios with recorded cassettes.** Module 12.

### Files added (cumulative across Module 11)

```
course/contactly/
├── .env.example                                  (modified — Sentry vars)
├── docs/deploy/
│   ├── 01-vercel-adapter.md                      (new — 11.1)
│   ├── 02-sentry-source-maps.md                  (new — 11.2)
│   ├── 03-release-pin.md                         (new — 11.3)
│   ├── 04-security-headers.md                    (new — 11.4)
│   └── 05-runbook-and-wrap.md                    (new — 11.5; this file)
├── package.json                                  (modified — adapter swap, sentry vite plugin)
├── svelte.config.js                              (modified — Vercel adapter pinned)
├── vercel.json                                   (new — install/build/cache)
├── vite.config.ts                                (modified — sentry plugin + sourcemaps)
├── src/
│   ├── hooks.server.ts                           (modified — securityHeadersHandle)
│   ├── lib/
│   │   ├── release.ts                            (new — single source of truth)
│   │   ├── release.test.ts                       (new)
│   │   ├── sentry-shared.ts                      (modified — import from release.ts)
│   │   └── server/
│   │       ├── env.ts                            (modified — Sentry build vars + cross-field)
│   │       ├── security-headers.ts               (new)
│   │       └── security-headers.test.ts          (new)
│   └── routes/
│       ├── (admin)/+layout.server.ts             (modified — deploy identity)
│       ├── (admin)/+layout.svelte                (modified — env pill + release tag)
│       ├── api/version/+server.ts                (new)
│       └── robots.txt/+server.ts                 (new)
```

### Tests added

| Suite                      | Cases | Notes       |
| -------------------------- | ----- | ----------- |
| `release.test.ts`          | 15    | Module 11.3 |
| `security-headers.test.ts` | 31    | Module 11.4 |

Total: **+46 new unit cases** across Module 11, on top of the
171 from Module 10. Suite total at the end of Module 11:
**217 tests, 21 files, ~350 ms**. Every lesson commit kept the
suite green.

## What's next

Module 12 — recorded-cassette test harness for end-to-end Stripe
scenarios. Builds on Module 10's webhook receiver + Module 11's
deploy primitives without modifying either.
