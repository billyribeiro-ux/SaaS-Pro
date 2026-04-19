# 11.2 — Sentry source-map upload via @sentry/vite-plugin

> **Module 11 — Production deploy & adapter swap.**
>
> Lesson 2 of 5. We close the symbolication loop so a Sentry stack
> trace points at TypeScript line numbers rather than `_d`/`_a`
> minified blobs from the production bundle.

## The problem

When the runtime SDK from Lesson 10.2 reports an error from a
production build, the stack trace looks like:

```
TypeError: Cannot read properties of undefined (reading 'tier')
    at f3 (chunks/dashboard-Br4VGqxs.js:1:14821)
    at d2 (chunks/dashboard-Br4VGqxs.js:1:13072)
    at e1 (chunks/internal-DqhqQpRs.js:1:8891)
```

That's correct, useful to nobody. We need:

```
TypeError: Cannot read properties of undefined (reading 'tier')
    at PlanSection (src/lib/components/billing/PlanSection.svelte:62:18)
    at +layout (src/routes/(app)/+layout.svelte:24:6)
```

The bridge between the two is **source maps + a release identifier
that Sentry can join on**.

## The shape of the fix

```
┌──────────────────┐  build      ┌────────────────┐
│  vite build      │──────────►  │  emit *.map    │
└──────────────────┘             │  (hidden)      │
        │                        └───────┬────────┘
        │ resolveBuildRelease()          │
        ▼                                ▼
┌──────────────────┐  upload     ┌─────────────────┐
│  @sentry/vite-   │────────────►│  Sentry         │
│  plugin          │             │  release X.Y.Z  │
│  (release: same) │             └─────────────────┘
└──────────────────┘
        │
        ▼  (same release tag at runtime)
┌──────────────────┐
│  Sentry SDK init │
│  release: X.Y.Z  │ ◄── runtime SDK from Lesson 10.2
└──────────────────┘
```

Key: the **release string the plugin uploads under** has to equal
the **release string the runtime SDK tags events with**. Otherwise
Sentry has the maps and the events but no join key, and the UI
shows minified frames anyway.

## What changed

### `vite.config.ts`

```ts
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig, loadEnv } from 'vite';

function resolveBuildRelease(env: Record<string, string>): string {
	const explicit = env.PUBLIC_SENTRY_RELEASE?.trim();
	if (explicit) return explicit;
	const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
	if (sha) return `contactly@${sha.slice(0, 12)}`;
	return 'contactly@dev';
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');

	const sentryEnabled =
		Boolean(env.SENTRY_AUTH_TOKEN) && Boolean(env.SENTRY_ORG) && Boolean(env.SENTRY_PROJECT);

	const sentryPlugins = sentryVitePlugin({
		disable: !sentryEnabled,
		org: env.SENTRY_ORG,
		project: env.SENTRY_PROJECT,
		authToken: env.SENTRY_AUTH_TOKEN,
		release: { name: resolveBuildRelease(env), create: false, finalize: false },
		sourcemaps: {
			filesToDeleteAfterUpload: ['./.svelte-kit/output/**/*.map', './.vercel/output/**/*.map']
		},
		errorHandler: (err) => console.warn('[sentry-vite-plugin] upload skipped:', err.message),
		telemetry: false
	});

	return {
		plugins: [tailwindcss(), sveltekit(), ...sentryPlugins],
		build: { sourcemap: 'hidden' }
		// ...
	};
});
```

Six knobs are doing real work here. Each defended below.

### `disable: !sentryEnabled`

The plugin is **always** registered in the plugins array, but the
`disable` flag short-circuits its IO whenever any of the three env
vars is missing. That means:

- Local dev with no Sentry creds: zero upload attempts, no
  noisy warnings, no extra build time.
- CI on a feature branch (`SENTRY_AUTH_TOKEN` not yet propagated):
  same — build still completes, just no maps reach Sentry.
- Production deploy (all three present): upload proceeds.

The cross-field validator in `src/lib/server/env.ts`
(`SENTRY_AUTH_TOKEN` set without org/project) catches the
"forgot one of the three" footgun **at server boot**, not as a
silent build-time skip.

### `release.name: resolveBuildRelease(env)`

Re-implements `resolveRelease()` from `src/lib/sentry-shared.ts`
in pure JS so this file stays runnable without TS compilation.
The two implementations share the **exact same precedence**:

1. `PUBLIC_SENTRY_RELEASE` (explicit override).
2. `VERCEL_GIT_COMMIT_SHA` (Vercel-injected) → `contactly@<12 char sha>`.
3. `'contactly@dev'`.

Lesson 11.3 collapses the two implementations into a single
shared module that both runtimes import; for now, both code paths
are mechanically identical and the unit suite (Module 10.2's
`sentry-shared.test.ts`) pins the contract.

### `release.create: false` + `release.finalize: false`

The plugin's defaults will create a release at build start and
finalize it at build end, calling Sentry's release API both
times. We turn both off because:

- The runtime SDK already creates the release implicitly the
  first time it sees an event tagged with that release name —
  saving an HTTP round-trip per build.
- "Finalize" means setting `released: true`, which is a deploy
  event in Sentry's mental model. The right time for that signal
  is the deploy promotion, not the build. (Vercel's deploy hook
  → Sentry deploys API is the right shape; lands as a follow-up.)

### `sourcemaps.filesToDeleteAfterUpload`

Source maps are world-readable plain text. The original sources
they point at are your IP. Leaving them on the CDN
turns "deployed code" into "deployed source." Two glob patterns
catch both possible output paths:

- `./.svelte-kit/output/**/*.map` — the SvelteKit build output
  before the adapter rewrites it.
- `./.vercel/output/**/*.map` — the Vercel adapter's
  post-processed output.

Belt-and-braces; either alone would miss the other.

### `errorHandler: (err) => console.warn(...)`

The plugin's default behavior is to **throw**, which would tank
the deploy if Sentry's symbolicator returned a 5xx. That is the
wrong tradeoff: a Sentry outage should never block a fix from
shipping. Override to `console.warn` so the build still succeeds;
the runtime SDK will lazy-symbolicate from the next deploy's
maps.

### `build.sourcemap: 'hidden'`

`'hidden'` rather than `true` because:

- `true` ⇒ each chunk gets a `//# sourceMappingURL=...` footer
  pointing the browser at the `.map`. Useless to us (we're about
  to delete the file).
- `'hidden'` ⇒ maps written, no footer emitted. Net result:
  Sentry gets a stack trace it can resolve, the browser never
  asks for a 404'd map, no source leakage at the edge.

## Env var matrix

| Var                     | Where read       | Required when                                | Effect of missing                          |
| ----------------------- | ---------------- | -------------------------------------------- | ------------------------------------------ |
| `SENTRY_AUTH_TOKEN`     | `vite.config.ts` | Wanting source-map upload                    | Plugin disabled, build continues unchanged |
| `SENTRY_ORG`            | `vite.config.ts` | `SENTRY_AUTH_TOKEN` set                      | Server boot fails with cross-field error   |
| `SENTRY_PROJECT`        | `vite.config.ts` | `SENTRY_AUTH_TOKEN` set                      | Server boot fails with cross-field error   |
| `PUBLIC_SENTRY_RELEASE` | both runtimes    | Wanting an explicit release name             | Falls back to git SHA, then `'dev'`        |
| `VERCEL_GIT_COMMIT_SHA` | both runtimes    | Auto-set by Vercel (no manual config needed) | Release tag falls back to `'dev'`          |

Token + org + project are **all-or-nothing**: the env validator
in `src/lib/server/env.ts` adds a `superRefine` issue if a token
shows up without the slugs:

```ts
.superRefine((cfg, ctx) => {
  if (cfg.SENTRY_AUTH_TOKEN.trim() && (!cfg.SENTRY_ORG.trim() || !cfg.SENTRY_PROJECT.trim())) {
    ctx.addIssue({
      code: 'custom',
      path: ['SENTRY_AUTH_TOKEN'],
      message: 'SENTRY_AUTH_TOKEN is set, but SENTRY_ORG and/or SENTRY_PROJECT are not. ...'
    });
  }
});
```

That fail-fast catches the classic "rotated the token, forgot to
re-add the slugs" mistake at server boot rather than at the next
deploy.

## How to issue the auth token

1. **Sentry → Settings → Auth Tokens** → New Internal Integration.
2. Scope: `project:write`, `release:admin`. Nothing more.
3. Copy the value once — Sentry won't show it again.
4. Paste into Vercel project's Production env vars (and Preview
   if you want maps from preview deploys too — recommended). Use
   the same token in CI for any pre-deploy build steps.

A token that gives any more permission than these two scopes is
a token a leaked deploy log can use to wreck things. Don't.

## Verification (locally)

With a real `SENTRY_AUTH_TOKEN` set in `.env`:

```bash
pnpm run build
# ...
# [sentry-vite-plugin] Found 12 source maps for upload
# [sentry-vite-plugin] Uploaded files to Sentry
# [sentry-vite-plugin] Successfully uploaded source maps to Sentry
# [sentry-vite-plugin] Removed 12 source maps after upload
```

In `https://<your-org>.sentry.io/releases/`, the new release
appears with the `contactly@<sha>` name and the artifact count
matches the file count printed by the plugin.

## Verification (production)

After a Vercel production deploy:

1. Force an error: visit a page that throws (or use the
   `/admin/webhooks/replay` form to replay an event whose handler
   intentionally errors in a staging fixture).
2. Open the resulting Sentry issue.
3. The stack frames should show `.svelte` / `.ts` paths, not
   minified chunk names.

If frames are still minified:

- **No release tag on the event** — runtime SDK isn't reading
  `VERCEL_GIT_COMMIT_SHA`. Check Lesson 11.3.
- **Release tag mismatch** — plugin uploaded under one name,
  runtime tagged under another. Re-check `resolveBuildRelease`
  vs `resolveRelease` precedence ordering.
- **No artifacts on the release** — token didn't have the right
  scopes, or the build skipped the plugin (`pnpm run build`
  output didn't include the `[sentry-vite-plugin]` lines).

## What's deliberately **not** here

- **Auto-creating a Sentry deploy entry on every Vercel
  promotion.** Vercel deploy hook → Sentry deploys API is the
  right shape but is a separate one-page lesson; we'll fold it
  into Module 11's wrap if there's room.
- **Commit association (`setCommits`).** Sentry can scrape git
  for "what commits are in this release" and surface them next
  to issues. Our `release.setCommits` is implicit-default; as
  soon as we run a build inside a real CI runner, Sentry's
  default `auto: true` finds the commits without further config.
- **Per-environment release scoping.** Today, `preview` and
  `production` upload to the **same** Sentry project, scoped by
  the `environment` tag (`'preview'` vs `'production'`). Lesson
  11.4 hardens preview behavior; splitting the Sentry projects
  is a billing decision, not a wiring one.

## Next

→ [11.3 — Build-time release pin & shared SHA across runtimes](./03-release-pin.md)
