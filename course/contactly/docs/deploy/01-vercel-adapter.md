# 11.1 — Vercel adapter swap

> **Module 11 — Production deploy & adapter swap.**
>
> Lesson 1 of 5. We bind the build output to a real deployment
> target so every later lesson (source-map upload, header
> hardening, runbook updates) has a stable shape to plug into.

## Why this comes first in Module 11

Up to and including Module 10, `kit.adapter` was
`@sveltejs/adapter-auto`. That adapter looks at the host you're
running on at build time and picks the "right" platform-specific
adapter — handy for tutorials, _wrong_ for production.

Three concrete failure modes adapter-auto invites:

1. **Silent platform drift.** A teammate runs `pnpm run build`
   inside a Docker image with no Vercel hints in the env, so
   adapter-auto falls through to `adapter-node`. The same code
   shipped with `pnpm run build` on Vercel. We now have two build
   shapes for "production".
2. **Region surprises.** adapter-auto-on-Vercel uses Vercel's
   defaults, which today means "all regions" for some accounts.
   Our Supabase and Stripe webhook signing live in `iad1`. Cross-
   region round-trips silently widen p99 latency.
3. **Runtime drift.** No pin = "current Node.js." A breaking
   change in Node 22.10 → 22.11 (it has happened) breaks a deploy
   we shipped with no code change.

Pinning the adapter, runtime, region, memory, and timeout makes
"works on my machine" identical to "works on Vercel."

## What changed

### `package.json`

```diff
-"@sveltejs/adapter-auto": "^6.1.0",
+"@sveltejs/adapter-vercel": "^6.3.3",
```

### `svelte.config.js`

```js
import adapter from '@sveltejs/adapter-vercel';

const config = {
	// ... compilerOptions / preprocess unchanged ...
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x',
			regions: ['iad1'],
			memory: 1024,
			maxDuration: 30
		})
	}
};
```

> SvelteKit's CSRF Origin check is on by default
> (`csrf.trustedOrigins: []`). We deliberately leave the block out
> of the config so we never accidentally disable it; if a partner
> needs to post into us, the right knob is to _add_ a trusted
> origin, not to flip the global check.

Each knob defended below.

## The four production knobs

### `runtime: 'nodejs22.x'`

We need Node, not Edge. Node gets us:

- `pino`'s worker-thread transport for structured logs.
- Long-lived TCP to Supabase via the Postgres pooler.
- Stripe webhook signature verification using `crypto` APIs
  whose semantics we know are stable in Node.

Edge would shave ~50 ms off cold starts at the price of a
materially larger blast radius (no `worker_threads`, different
`fetch` quirks, different streams). Module 13 will benchmark
per-route runtime overrides; today, one runtime, one Node
version, one mental model.

`22.x` rather than `latest` because Vercel will roll the runtime
forward without telling you. Pin = boring deploy.

### `regions: ['iad1']`

Single-region (US-East). Co-located with:

- Supabase (default region for new US Supabase projects).
- The Stripe webhook listener (their delivery region for US
  endpoints).

Multi-region in SvelteKit is `regions: 'all'`, but it is a
billing decision: Vercel charges per-region active time. Single
region until p99 latency from EU/APAC users actually hurts.

### `memory: 1024`

Vercel's default is 1024 MB; we set it explicitly so a future
"let's bump it because Vercel changed the default" discussion
shows up in `git blame` rather than mystery downtime. Higher
values shorten cold starts (Vercel scales CPU with memory) but
cost proportionally more per ms.

### `maxDuration: 30`

30 seconds is plenty for the slowest path we have today (Stripe
checkout creation: ~2 s p99) and well under Vercel's Pro tier
upper bound. It exists primarily as a "this request hung — kill
it" backstop. Webhook backlog work has its own retry budget
(Module 10), so a hung dispatcher won't accidentally chew through
the function quota.

## `vercel.json`

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

- **`/_app/immutable/*`** — SvelteKit fingerprints these. Telling
  the browser to cache them for a year is safe by construction
  and is the single highest-impact perf knob.
- **`/api/*` no-store** — every API endpoint is auth-bound and
  user-specific. The "default cache-everything-the-user-touches"
  posture some CDNs still ship is a bug-magnet.

`installCommand` is pinned to `pnpm install --frozen-lockfile`
so a Vercel build that drifts from `pnpm-lock.yaml` fails closed
rather than silently picking newer transitive deps.

## Verification

```bash
pnpm run build
# → Building app for Vercel...
# → Output written to .vercel/output
ls .vercel/output/functions/fn.func/
# package.json + handler.mjs + chunks
```

Production (`vercel deploy --prod`) inherits everything in
`vercel.json` plus the adapter knobs above. Preview deploys (`git
push` to a branch) inherit the same shape with `VERCEL_ENV=preview`
— Sentry's `resolveEnvironment()` already routes preview events
to a separate scope (Module 10.2).

## What's deliberately **not** here

- **Source-map upload to Sentry** — Lesson 11.2.
- **Build-time `PUBLIC_SENTRY_RELEASE` pinning** — Lesson 11.3.
- **Security headers** — Lesson 11.4.
- **CDN warming / stale-while-revalidate on marketing pages** —
  Module 13.
- **Per-route runtime overrides (edge for `/marketing/*`,
  Node for `/api/*`)** — Module 13 with benchmarks.

Each of these wants the adapter swap to be already in place. With
that done, we can iterate on production behavior knob-by-knob
without re-running the "is this the right adapter?" debate.

## Next

→ [11.2 — Sentry source-map upload via @sentry/vite-plugin](./02-sentry-source-maps.md)
