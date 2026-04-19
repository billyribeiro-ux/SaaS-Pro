---
title: 'Bonus: Vercel Adapter & Edge Deployment'
module: 14
lesson: 16
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-16-vercel-adapter-edge'
description: "Pin runtime, region, memory, maxDuration, and build commands so 'works on my machine' is identical to 'works on Vercel'. Plus when to use Edge vs Node and how to override per-route."
duration: 20
preview: false
---

# Bonus: Vercel adapter & edge deployment

By default a SvelteKit project ships with `@sveltejs/adapter-auto`. It looks at the host you're running on at build time and picks the "right" platform-specific adapter — handy for tutorials, dangerous for production.

Three concrete failure modes adapter-auto invites:

1. **Silent platform drift.** A teammate runs `pnpm run build` inside a Docker image with no Vercel hints in the env. Adapter-auto falls through to `adapter-node`. The same code shipped with `pnpm run build` on Vercel. You now have two build shapes for "production" with different bug surfaces.
2. **Region surprises.** adapter-auto-on-Vercel uses the platform's defaults, which today means "all regions" for some accounts. Your Supabase project lives in `iad1`. Cross-region round-trips silently widen p99 latency by 50–200 ms.
3. **Runtime drift.** No pin means "current Node.js." A breaking change in Node 22.10 → 22.11 (it has happened) breaks a deploy you shipped with no code change.

This lesson swaps to `@sveltejs/adapter-vercel`, pins all four production knobs (runtime, region, memory, maxDuration), and locks down `vercel.json` so the install + build + cache headers don't drift either.

By the end of this lesson you will:

- Replace `adapter-auto` with `@sveltejs/adapter-vercel` and pin runtime, region, memory, and `maxDuration`.
- Understand when to choose Node vs Edge runtime per route.
- Pin `installCommand` to `pnpm install --frozen-lockfile` so build-time dep drift fails closed.
- Add cache headers for `/_app/immutable/*` (immutable) and `/api/*` (no-store).
- Verify the Vercel build output structure locally.

## 1. Install

```bash
pnpm remove @sveltejs/adapter-auto
pnpm add -D @sveltejs/adapter-vercel
```

## 2. Configure the adapter

`svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x',
			regions: ['iad1'],
			memory: 1024,
			maxDuration: 30
		})
	}
};

export default config;
```

Each knob defended below.

### `runtime: 'nodejs22.x'`

You need Node, not Edge. Node gets you:

- `pino`'s worker-thread transport for structured logs (Bonus 11).
- Long-lived TCP to Supabase via the Postgres pooler.
- Stripe webhook signature verification using `crypto` APIs whose semantics are stable in Node.

Edge would shave ~50 ms off cold starts at the price of a materially larger blast radius (no `worker_threads`, different `fetch` quirks, different streams). Node is the right default.

`22.x` rather than `latest` because Vercel will roll the runtime forward without telling you. Pin = boring deploy.

### `regions: ['iad1']`

Single-region (US-East). Co-located with Supabase (default region for new US projects) and the Stripe webhook listener (their delivery region for US endpoints).

Multi-region in SvelteKit is `regions: 'all'`, but it is a billing decision: Vercel charges per-region active time. Single region until p99 latency from EU/APAC users actually hurts.

### `memory: 1024`

Vercel's default is 1024 MB; set it explicitly so a future "let's bump it because Vercel changed the default" discussion shows up in `git blame` rather than mystery downtime. Higher values shorten cold starts (Vercel scales CPU with memory) but cost proportionally more per ms.

### `maxDuration: 30`

30 seconds is plenty for the slowest path you have today (Stripe checkout creation: ~2 s p99) and well under Vercel's Pro tier upper bound. It exists primarily as a "this request hung — kill it" backstop. Webhook backlog work has its own retry budget (Bonus 14), so a hung dispatcher won't accidentally chew through the function quota.

## 3. `vercel.json`

```json
{
	"installCommand": "pnpm install --frozen-lockfile",
	"buildCommand": "pnpm run build",
	"framework": "sveltekit",
	"headers": [
		{
			"source": "/_app/immutable/(.*)",
			"headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
		},
		{
			"source": "/api/(.*)",
			"headers": [{ "key": "Cache-Control", "value": "no-store" }]
		}
	]
}
```

Two pieces of cache hygiene:

- **`/_app/immutable/*`** — SvelteKit fingerprints these (the filename includes a content hash). Telling the browser to cache them for a year is safe by construction and is the single highest-impact perf knob you can ship.
- **`/api/*` no-store** — every API endpoint is auth-bound and user-specific. The "default cache-everything-the-user-touches" posture some CDNs still ship is a bug-magnet.

`installCommand` is pinned to `pnpm install --frozen-lockfile` so a Vercel build that drifts from `pnpm-lock.yaml` fails closed rather than silently picking newer transitive deps.

## 4. Per-route runtime overrides

You can mix Node and Edge in the same project by exporting `runtime` from a `+server.ts` or `+page.server.ts`:

```ts
// src/routes/marketing/+page.server.ts
export const config = { runtime: 'edge' };
```

Useful candidates for Edge:

- Marketing pages (no DB, no auth, latency-sensitive).
- Health checks that call only `process.env`.
- Static-data API responses.

**Don't** put on Edge:

- Anything that calls Supabase. The connection pool semantics are designed for Node.
- Stripe webhook verification. Use Node-stable `crypto`.
- Anything using `pino` workers or `node:` modules.

Benchmark before you migrate. Edge isn't free; it's a different runtime with different bug shapes.

## 5. CSRF (don't disable it)

SvelteKit's CSRF Origin check is on by default (`csrf.trustedOrigins: []`). Leave the block out of your config so you never accidentally disable it. If a partner needs to post into your endpoints, the right knob is to _add_ a trusted origin, not to flip the global check:

```js
kit: {
	adapter: adapter({ /* ... */ }),
	csrf: { trustedOrigins: ['https://partner.example.com'] }
}
```

## 6. Verification

```bash
pnpm run build
# → Building app for Vercel...
# → Output written to .vercel/output
ls .vercel/output/functions/fn.func/
# package.json + handler.mjs + chunks
```

The output structure should match Vercel's [build output spec](https://vercel.com/docs/build-output-api/v3). If `ls .vercel/output/functions/fn.func/package.json` shows `"runtime": "nodejs22.x"` and `"regions": ["iad1"]`, the adapter knobs landed.

Production (`vercel deploy --prod`) inherits everything in `vercel.json` plus the adapter knobs above. Preview deploys (`git push` to a branch) inherit the same shape with `VERCEL_ENV=preview` — Sentry's `resolveEnvironment()` (Bonus 12) already routes preview events to a separate scope.

## 7. What's deliberately not here

- **Source-map upload to Sentry** — Bonus 17.
- **Build-time `PUBLIC_SENTRY_RELEASE` pinning** — Bonus 18.
- **Security headers** — Bonus 19.
- **Secret rotation** — Bonus 20.

Each of these wants the adapter swap to already be in place. With that done, you can iterate on production behaviour knob-by-knob without re-running the "is this the right adapter?" debate.

## 8. Acceptance checklist

- [ ] `@sveltejs/adapter-auto` removed; `@sveltejs/adapter-vercel` installed.
- [ ] `svelte.config.js` pins `runtime`, `regions`, `memory`, `maxDuration`.
- [ ] `vercel.json` pins `installCommand`, `buildCommand`, `framework`.
- [ ] `/_app/immutable/*` returns `Cache-Control: public, max-age=31536000, immutable` in production (verify with `curl -I`).
- [ ] `/api/*` returns `Cache-Control: no-store`.
- [ ] CSRF check is on (no `csrf: false` in config).
- [ ] `pnpm run build` produces `.vercel/output/` locally.

## What's next

Bonus 17 wires `@sentry/vite-plugin` to upload source maps from CI so production stack traces resolve to original TypeScript filenames + line numbers — the difference between "TypeError at chunk-A8B7.js:1:2453" and "TypeError at src/lib/server/billing/checkout.ts:142:18".
