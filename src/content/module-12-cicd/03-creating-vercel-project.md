---
title: '12.3 - Creating Vercel Project'
module: 12
lesson: 3
moduleSlug: 'module-12-cicd'
lessonSlug: '03-creating-vercel-project'
description: 'Deploy Contactly to Vercel by importing your GitHub repo and configuring environment variables.'
duration: 10
preview: false
---

## Overview

Your production database is live. Now we need an application server — something that takes an incoming `GET /dashboard` request, runs the SvelteKit server code, queries Supabase, renders the HTML, and returns it to the browser. For Contactly that server is Vercel.

This lesson turns the Contactly repository into a Vercel project. By the end, you'll visit an `https://contactly-*.vercel.app` URL and see your working app — register, log in, the whole flow — running against the production Supabase you built in 12.2. The deploy is manual for now; lesson 12.4 will automate it.

Three concrete things happen:

1. We install `@sveltejs/adapter-vercel` and update `svelte.config.js` to use it.
2. We import the Contactly GitHub repo into Vercel and configure build settings.
3. We paste every production environment variable into Vercel's dashboard and trigger the first deploy.

## Prerequisites

- Lesson 12.2 completed — production Supabase is up and you have `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in a password manager.
- Contactly pushed to a GitHub repository.
- A Vercel account (free — sign up with GitHub OAuth for tight integration).
- Your full local `.env` file handy — we'll be copying values from it, modified for production.

## What You'll Build

- `svelte.config.js` updated to use `@sveltejs/adapter-vercel`.
- A `vercel.json` at the repo root pinning region and framework detection.
- A Vercel project linked to your GitHub repo, auto-building on every push (for now — we'll override this in 12.4).
- Every production environment variable configured in Vercel's dashboard.
- A first production deploy serving a live URL.

---

## Step 1: Install the Vercel Adapter

SvelteKit ships with a **pluggable adapter system**. The core framework compiles your routes into a platform-neutral internal representation; an adapter translates that into whatever your host expects. Node server? `adapter-node`. Cloudflare Workers? `adapter-cloudflare`. Vercel? `adapter-vercel`.

We're on Vercel. Install the adapter:

```bash
pnpm add -D @sveltejs/adapter-vercel
```

The `-D` flag puts it in `devDependencies` — it's only needed at build time, not at runtime. The adapter's job is done once the build completes; the output is plain JavaScript functions Vercel executes, with no runtime dependency on the adapter itself.

**Don't** uninstall any other adapter you might have. If `@sveltejs/adapter-auto` is in your `package.json` (it is by default in new SvelteKit projects), leave it. We're about to explicitly wire up `adapter-vercel` in `svelte.config.js`; the auto adapter will no longer be used but it doesn't hurt to leave it listed.

---

## Step 2: Update `svelte.config.js`

Open `svelte.config.js` at the repo root. You'll see something like this:

```javascript
// svelte.config.js (before)
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter()
	}
};

export default config;
```

Replace the import and the adapter options:

```javascript
// svelte.config.js (after)
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x',
			regions: ['iad1']
		})
	}
};

export default config;
```

### Walking through the changes

**`import adapter from '@sveltejs/adapter-vercel'`** — swap from `adapter-auto` (which guesses based on env variables) to the explicit Vercel adapter. Explicit is better — you know exactly what's being used, not what a heuristic decided.

**`runtime: 'nodejs22.x'`** — which runtime Vercel uses to execute your serverless functions. Node 22 is the LTS track we standardize on throughout the course. You can also target `edge` for ultra-low-latency routes, but edge runtime has a reduced API surface (no full Node built-ins, smaller bundles, no Prisma, etc.). Node runtime is the safe default; we'll be explicit about edge opt-ins on a per-route basis when needed.

**`regions: ['iad1']`** — which Vercel data center runs your functions. `iad1` is Washington DC (us-east-1). **Pick the region closest to your Supabase project.** Cross-region DB round-trips — Vercel in iad1 talking to Supabase in eu-central-1 — add 80-100ms per query, and a dashboard load might do 3-4 queries. That's half a second of UX loss for nothing.

If your production Supabase is in:

- US East (N. Virginia) → Vercel `iad1`
- US West (Oregon) → Vercel `pdx1`
- West Europe (Ireland) → Vercel `dub1`
- Central Europe (Frankfurt) → Vercel `fra1`
- Asia (Singapore) → Vercel `sin1`

The full list is in the [Vercel regions docs](https://vercel.com/docs/edge-network/regions). Match your adapter's `regions` array to where your DB lives. You **can** list multiple regions for redundancy, but your Supabase instance only lives in one region, so multi-region compute mostly adds latency for extra-regional requests with no DB failover benefit. Stick with one.

### Why explicit is better than auto

The `adapter-auto` detects its environment (checks for `VERCEL`, `NETLIFY`, `CF_PAGES` env vars) and picks an adapter accordingly. Convenient for zero-config demos; dangerous for production. If a teammate sets up a different host and the adapter silently switches, you get subtly different behavior across deploys. Pin the adapter to the target you care about. No auto-magic.

---

## Step 3: Create `vercel.json`

`vercel.json` is Vercel's config file. Most projects don't need one — Vercel's auto-detection handles framework + build correctly. We create one to pin a few things explicitly, because implicit config is a pipeline bug waiting to happen.

Create `vercel.json` at the repo root:

```json
{
	"$schema": "https://openapi.vercel.sh/vercel.json",
	"framework": "sveltekit",
	"installCommand": "pnpm install --frozen-lockfile",
	"buildCommand": "pnpm build",
	"regions": ["iad1"]
}
```

Field by field:

- **`$schema`** — tells your editor where to fetch JSON schema validation from. Most editors (VS Code, JetBrains) will now autocomplete valid field names and warn about typos in this file.
- **`framework: "sveltekit"`** — tells Vercel to apply SvelteKit-specific build logic (route file convention, adapter output shape). Vercel auto-detects this, but pinning it prevents surprises if their heuristics change in a future version.
- **`installCommand: "pnpm install --frozen-lockfile"`** — pnpm (not npm, not yarn), frozen lockfile (fail if `pnpm-lock.yaml` is out of sync with `package.json`). Frozen lockfile is critical — without it, Vercel might resolve slightly different dependency versions than your CI, and "works on my machine" strikes again.
- **`buildCommand: "pnpm build"`** — runs the `build` script from `package.json`, which executes `vite build`. The Vercel adapter hooks into that build and emits the serverless function handlers.
- **`regions: ["iad1"]`** — redundant with what's in `svelte.config.js` but explicit here too. Belt and suspenders.

Commit these changes:

```bash
git add svelte.config.js vercel.json package.json pnpm-lock.yaml
git commit -m "Configure Vercel adapter for deployment"
git push
```

The push is important — we're about to import the repo into Vercel, and Vercel pulls from GitHub. Whatever's on main right now is what gets deployed.

---

## Step 4: Create a Vercel Account

Go to [vercel.com](https://vercel.com) and click **Sign Up**. Choose **Continue with GitHub**. Authorize Vercel to access your GitHub account.

The GitHub OAuth flow grants Vercel permission to list your repos. It does **not** grant write access — Vercel can only read the code. The exception is when you import a repo: Vercel asks for additional permission to install the Vercel GitHub App, which adds a webhook and allows Vercel to post build status to PRs.

Vercel pitches a few addons (Vercel Teams, Vercel Pro). For Contactly, the free Hobby tier is enough — it includes unlimited preview deploys, custom domains, analytics, and serverless function hours. Skip the paid tier. You can always upgrade later.

---

## Step 5: Import the Repo

From the Vercel dashboard, click **Add New...** → **Project**. You'll see a list of your GitHub repositories (if you don't, click **Configure GitHub App** and grant Vercel access to your Contactly repo).

Find `contactly` (or whatever you named the repo) and click **Import**.

The import screen has three sections:

### Project Name

Defaults to your repo name. Change to `contactly` or leave it — this becomes part of your default URL, like `https://contactly-abc123.vercel.app`.

### Framework Preset

Should auto-detect as **SvelteKit**. If not, select it manually. Vercel looks for `svelte.config.js` + `@sveltejs/kit` in `dependencies` to make this call; since both are present, the auto-detect rarely fails.

### Root Directory

Should be `./` (the repo root). Only change this if your SvelteKit app lives in a subfolder (monorepos).

### Build and Output Settings

Click to expand. You'll see defaults:

- Install Command: `pnpm install` — **change to `pnpm install --frozen-lockfile`** (or leave default and rely on `vercel.json`'s value — they'll reconcile).
- Build Command: `pnpm run build` — good.
- Output Directory: auto-detected — leave.

Vercel reconciles `vercel.json` with dashboard settings; when both exist, `vercel.json` wins. So the dashboard values are more advisory than authoritative once you've committed `vercel.json` to the repo.

---

## Step 6: Configure Environment Variables

**This is the most important step in the lesson.** Before clicking Deploy, expand **Environment Variables**. Paste in every variable Contactly needs to run. Getting this wrong is the #1 cause of "deploy succeeded but the app crashes on first load."

The variables Contactly needs in production (from earlier modules):

| Key                             | Value                              | Scope                            |
| ------------------------------- | ---------------------------------- | -------------------------------- |
| `PUBLIC_SUPABASE_URL`           | `https://xyzabcdefgh.supabase.co`  | Production, Preview, Development |
| `PUBLIC_SUPABASE_ANON_KEY`      | `eyJ...` (anon key)                | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY`     | `eyJ...` (service role key)        | **Production only**              |
| `PUBLIC_APP_URL`                | `https://contactly-xyz.vercel.app` | Production                       |
| `STRIPE_SECRET_KEY`             | `sk_test_...` (for now, test key)  | Production                       |
| `STRIPE_WEBHOOK_SECRET`         | `whsec_...`                        | Production                       |
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (for now)            | Production                       |

Rules of thumb for each variable:

**`PUBLIC_*` variables** — the `PUBLIC_` prefix means SvelteKit inlines this value into the client bundle. Safe for values that would otherwise appear in page source anyway (Supabase project URL, anon key, Stripe publishable key, app URL). **Never** put a secret in a `PUBLIC_` var.

**`SUPABASE_SERVICE_ROLE_KEY`** — the nuclear key. Server-side only. Scoping to Production-only prevents preview builds from using the same key — a preview deploy that mutates production data through the service role is an incident waiting to happen. Lesson 12.4 covers test-environment keys for preview deploys.

**`STRIPE_SECRET_KEY`** — we're starting with the **test** key. Real paying customers will come in lesson 12.5 when we flip to live keys. The test key stays useful permanently for staging/preview deploys.

**`PUBLIC_APP_URL`** — the canonical origin of your site. We'll update this after the first deploy, once we know the actual URL Vercel assigned. It's referenced by Stripe redirects, email links, and anywhere the app needs to produce an absolute URL. Lesson 12.6 walks through plumbing this through correctly.

### How to add each variable

For each row in the table:

1. Click **Add Another**.
2. Key: paste the variable name (case-sensitive; `PUBLIC_SUPABASE_URL`, not `Public_Supabase_URL`).
3. Value: paste the value.
4. Environment: select **Production**, **Preview**, **Development** as appropriate. Most go to all three; `SUPABASE_SERVICE_ROLE_KEY` is Production-only.

There's also a CSV import option ("Paste .env file") at the top of the section — paste your `.env.production` file and Vercel parses it. Faster if you have many variables. **Double-check afterward** — easy to miss a Preview/Development toggle.

### Why preview gets different values (usually)

A **preview deploy** is a URL generated for a pull request. Every PR gets its own live URL, which is a huge UX for reviewers. But preview URLs shouldn't necessarily talk to prod Supabase — you don't want a reviewer clicking around a preview to accidentally create fake customer data in your real DB.

Options:

1. Preview uses the same Supabase as prod, but reviewers only click through. (Fine for low-risk apps.)
2. Preview uses a **second** Supabase project dedicated to ephemeral test data. (More correct.)
3. Preview uses a branch-scoped Supabase clone. (Advanced — Supabase supports database branching on paid plans.)

For Contactly at launch, option 1 is fine — we're the only ones pushing PRs. When collaborators appear, upgrade to option 2 or 3. For now, let Preview share the production env vars and promise yourself not to abuse it.

---

## Step 7: Deploy

Click the big **Deploy** button. Vercel starts the first build. You'll watch a streaming log:

1. **Cloning repo** — Vercel pulls the current main branch from GitHub.
2. **Installing dependencies** — runs `pnpm install --frozen-lockfile`. Should take 30-60 seconds.
3. **Building** — runs `pnpm build` → `vite build`. The SvelteKit build compiles every route and the Vercel adapter emits the serverless functions. 30-90 seconds.
4. **Collecting build assets** — Vercel packages static files (JS bundles, CSS, images from `static/`) for the edge CDN.
5. **Deploying outputs** — serverless function handlers go to iad1.
6. **Assigning domains** — you get `https://contactly-<hash>.vercel.app` and `https://contactly-<yourname>.vercel.app`.

Total: ~2-3 minutes for a first deploy. Subsequent deploys are faster because Vercel caches `node_modules`.

If the build fails:

- **`pnpm: command not found`** → Vercel isn't using pnpm. Check that `installCommand` in `vercel.json` specifies pnpm; Vercel should also auto-detect pnpm from the presence of `pnpm-lock.yaml`.
- **`Error: Missing environment variable PUBLIC_SUPABASE_URL`** → you forgot to add it in Step 6. Settings → Environment Variables, add it, redeploy.
- **Type errors** → your local build passed but prod build fails. Probably you have `.env` values that are typed loosely in one environment but strict in another. Fix the types.

If the build succeeds, click the generated URL. Contactly should load. Register, log in — use real credentials; your data is now in production Supabase. Head to the Supabase dashboard → Authentication → Users — your test user is there.

---

## Step 8: Circle Back to `PUBLIC_APP_URL`

Now that the deploy succeeded, you know your URL (e.g., `https://contactly-xyz.vercel.app`). Go to **Settings** → **Environment Variables** and set `PUBLIC_APP_URL` to that URL.

Redeploy to pick up the change: **Deployments** tab → most recent deploy → **⋯** → **Redeploy**.

Why redeploy? Vercel only picks up new env vars on the next build. A running deploy has its env baked in at build time (for `PUBLIC_*` vars, which get inlined into the bundle). Changing an env var in the dashboard doesn't retroactively patch the running deploy.

We'll revisit this URL in lesson 12.6, when we add a custom domain and swap the Vercel default for `https://contactly.app`.

---

## Common Mistakes

- **Forgot `--frozen-lockfile`.** Without it, pnpm in CI resolves whatever the latest-matching version of each dep is, which can differ from what you tested locally. Deploys become time-dependent — a build that worked yesterday can fail today because a transitive dependency shipped a patch. Always `--frozen-lockfile` in non-local builds.
- **Shipped the service_role key to the client.** Naming it `PUBLIC_SUPABASE_SERVICE_ROLE_KEY` inlines it into the browser bundle. An attacker viewing-source finds it, and owns your database. Name server-only secrets **without** the `PUBLIC_` prefix. SvelteKit's runtime keeps those server-only.
- **Set env vars for Development scope only.** You're testing on Vercel's Preview URL, it works; you deploy to Production, it 500s because the vars aren't scoped to Production. Always select all three (Production, Preview, Development) unless you have a reason not to.
- **Pushed to main before setting env vars.** Your pipeline runs, deploy fires, production crashes. Sequence matters: configure env vars first, then trigger the deploy. In lesson 12.4 we'll ensure the workflow fails if required env vars are missing.
- **Hard-coded `https://localhost:5173` anywhere in source.** `fetch('http://localhost:5173/api/...')` works in dev, 500s in production because localhost isn't reachable from Vercel's servers. Always use relative URLs (`fetch('/api/...')`) for same-origin server-to-server calls, and `PUBLIC_APP_URL` for absolute URLs where needed (Stripe success URLs, email links).

---

## Principal Engineer Notes

### Edge vs. serverless functions

Vercel supports two runtimes for your SvelteKit server code:

- **Node.js serverless (iad1, fra1, etc.)** — full Node standard library, any npm package works, cold starts ~300ms, runs in one data center per deploy.
- **Edge (vercel edge runtime)** — V8 isolates, runs in every Vercel POP globally (~30 regions), cold starts ~5ms, restricted API surface (no `fs`, no native modules, limited node built-ins).

Edge is fantastic for read-heavy, low-complexity routes: landing pages, signed-in user dashboards that do one DB query, auth middleware. It's unusable for routes that need full Node — Prisma, image processing, most Stripe SDK operations.

Contactly uses Node runtime by default (`runtime: 'nodejs22.x'` in `svelte.config.js`). Specific routes can opt into edge by exporting `export const config = { runtime: 'edge' }` from `+server.ts` or `+page.server.ts`. For the launch build we stick with Node everywhere — simpler, no weirdness with Stripe's Node SDK, no surprise incompatibilities. When we need global-sub-100ms response times on a specific route, we'll surgically opt into edge.

### Preview deployments per PR

Every pull request gets a unique preview URL: `https://contactly-git-pr-42-yourname.vercel.app`. This is possibly the single best feature Vercel offers. Reviewers don't `git checkout the-branch && pnpm dev` — they click a link.

Wire this into your team workflow:

- Put the preview URL in the PR description.
- Include a QA checklist in the PR template ("test X, Y, Z on preview").
- Block merging on reviewers confirming they've clicked the preview URL.

The GitHub Vercel integration auto-posts the preview URL as a PR comment. Free.

### Domain configuration

Vercel gives you `*.vercel.app` URLs for free. When you're ready to go live publicly, add a custom domain in **Settings** → **Domains** and follow the DNS-record instructions:

- **Apex domain (`contactly.app`)** — create an A record pointing to `76.76.21.21`.
- **`www.` subdomain** — create a CNAME pointing to `cname.vercel-dns.com`.

Vercel issues a free Let's Encrypt SSL certificate automatically once DNS propagates (~5-60 minutes). You get both `contactly.app` and `www.contactly.app` serving HTTPS with auto-renewed certs for free. There's essentially no reason to run your own nginx in front of a Vercel deploy.

### Serverless function cold starts and their limits

Node serverless functions have **cold starts** — when a function hasn't been invoked in ~15 minutes, Vercel tears down the instance; next request has to boot a new Node process, load the bundle, establish DB connections. First request after idle: ~500ms-2s. Subsequent requests on the warm instance: ~20-100ms.

For Contactly's traffic profile (low-to-medium requests per hour), cold starts are noticeable. Mitigations:

- **Connection pooling** (Supabase's Supavisor) — we use this by default.
- **Keep bundle small** — every 500KB of bundle adds 50ms to cold starts. Don't ship the whole `date-fns` library when you use one function.
- **Cron-ping** — hit a cheap endpoint every 10 minutes to keep the instance warm. Hacky, sometimes worth it. Vercel's "Function Execution" pricing discourages it.
- **Edge runtime** for latency-critical routes — no cold start, milliseconds overhead.

At scale, cold starts become a feature rather than a bug: they let you scale to zero during quiet periods and pay nothing. The trade-off is the first requester after a quiet period waits longer.

### Function duration and memory limits

Vercel's Hobby tier caps serverless functions at 10s execution time and 1024MB memory. Pro raises it to 60s and 3008MB. If you have a long-running background task (generating a giant CSV export, processing a large uploaded file), either:

1. Bump Pro and extend function duration.
2. Offload to a queue (Inngest, Trigger.dev, or Supabase Edge Functions with a cron).
3. Stream the response, processing chunks as you go.

For Contactly's exports feature (module 8), we stream — `Response` with a streaming body. The export completes before the 10s limit in almost every practical case. If it doesn't, we'd move to option 2.

---

## What's Next

Manual deploys are fine for the first push to confirm everything works. They're not fine for day-to-day operations — too easy to forget, too easy to deploy from a dev branch by mistake. Lesson 12.4 writes the GitHub Actions workflow that takes over from here: every push to main triggers type check, migration push, Playwright run, and (if all green) an automatic Vercel deploy. No human in the loop.
