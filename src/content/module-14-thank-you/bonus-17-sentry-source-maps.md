---
title: 'Bonus: Sentry Source Maps in CI'
module: 14
lesson: 17
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-17-sentry-source-maps'
description: 'Close the symbolication loop. Upload source maps from the Vite build to Sentry under the same release identifier the runtime SDK tags events with — so production stack traces show src/lib/billing/checkout.ts:142 instead of chunks/X.js:1:14821.'
duration: 22
preview: false
---

# Bonus: Sentry source maps in CI

You wired Sentry in Bonus 12. An exception fires in production. You open the issue and see this:

```
TypeError: Cannot read properties of undefined (reading 'tier')
    at f3 (chunks/dashboard-Br4VGqxs.js:1:14821)
    at d2 (chunks/dashboard-Br4VGqxs.js:1:13072)
    at e1 (chunks/internal-DqhqQpRs.js:1:8891)
```

That's correct, useful to nobody. What you want is:

```
TypeError: Cannot read properties of undefined (reading 'tier')
    at PlanSection (src/lib/components/billing/PlanSection.svelte:62:18)
    at +layout (src/routes/(app)/+layout.svelte:24:6)
```

The bridge between the two is **source maps + a release identifier that Sentry can join on**.

This lesson wires `@sentry/vite-plugin` so every production build emits source maps, uploads them to Sentry tagged with the same release string the runtime SDK uses, and then deletes the `.map` files from the deployed bundle so they're not publicly accessible.

By the end of this lesson you will:

- Install `@sentry/vite-plugin` and configure it in `vite.config.ts`.
- Compute a single source-of-truth release identifier (`PUBLIC_SENTRY_RELEASE` → `VERCEL_GIT_COMMIT_SHA` → `'dev'`) used by both the plugin and the runtime SDK.
- Generate hidden source maps at build time and upload them to Sentry.
- Delete the `.map` files from the Vercel output so they aren't served to the browser.
- Provision `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in CI without leaking them into client bundles.
- Verify symbolication actually works in a deployed build.

## 1. The shape of the fix

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
│  release: X.Y.Z  │ ◄── runtime SDK from Bonus 12
└──────────────────┘
```

**Key:** the release string the plugin uploads under has to equal the release string the runtime SDK tags events with. Otherwise Sentry has the maps and the events but no join key, and the UI shows minified frames anyway.

## 2. Install

```bash
pnpm add -D @sentry/vite-plugin
```

You need three secrets to upload:

- `SENTRY_AUTH_TOKEN` — generate at Sentry → Settings → Account → API → Auth Tokens. Scope to `project:releases` and `org:read`. Server-only (must NEVER reach the client).
- `SENTRY_ORG` — your org slug.
- `SENTRY_PROJECT` — the project slug.

Add all three to your CI secrets store and Vercel project env vars (Production + Preview, **not** Development).

## 3. Configure the plugin

`vite.config.ts`:

```ts
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
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
	};
});
```

The non-obvious flags:

| Flag                                       | Why                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `disable: !sentryEnabled`                  | Local builds and PRs from forks (no secrets) skip the upload step instead of crashing.                                                      |
| `release.create: false`, `finalize: false` | The plugin _references_ the release; the Sentry SDK at runtime is what creates+finalises it. Keeps the plugin idempotent across CI retries. |
| `sourcemaps.filesToDeleteAfterUpload`      | Maps are uploaded then deleted from the deployed bundle. Browsers can't fetch them; users can't inspect your unminified source.             |
| `build: { sourcemap: 'hidden' }`           | Generates the `.map` files but does NOT add the `//# sourceMappingURL=…` comment to the JS. Browsers don't request them; Sentry has them.   |
| `errorHandler: (err) => console.warn(...)` | Soft-fail. A flaky upload doesn't block a deploy.                                                                                           |
| `telemetry: false`                         | Don't ship plugin-level telemetry to Sentry's metering.                                                                                     |

## 4. Resolve the release the same way at runtime

The `resolveBuildRelease` function in `vite.config.ts` is intentionally identical to `resolveRelease` in `src/lib/sentry-shared.ts` (Bonus 12). Same inputs, same output. If you change one, change the other — or refactor both behind a shared helper.

A nice belt-and-braces is to make it impossible to drift by extracting both into a single TS module imported from each end. The catch: Vite plugins run in Node, and `vite.config.ts` can't import `$lib/...` aliases. So we either keep two copies (with a comment pointing to the other) or move the helper to a leaf path that both can import.

## 5. Deploy and verify

After CI runs `pnpm run build`:

1. Sentry → Settings → Releases should show a new release named `contactly@<sha-12>`.
2. Click it → "Source Maps" tab → you should see the uploaded `.map` files (one per chunk).
3. Trigger an exception in production (visit a route that throws or use Sentry's "Test event" button from the runtime side).
4. The Sentry issue's stack trace should now show TypeScript file paths and line numbers.

If you still see minified frames after upload:

- Check the runtime release matches the plugin release exactly. They're usually off by a leading `v` or trailing whitespace.
- Check `build.sourcemap: 'hidden'` is set; without it, the maps don't generate.
- Check the upload actually ran (CI log should include `[sentry-vite-plugin] Uploaded N source maps`).

## 6. Don't ship `.map` files to users

If you forget `filesToDeleteAfterUpload`, your production CDN serves `chunks/X.js.map` and any visitor can `view-source:` your unminified TypeScript. Verify after deploy:

```bash
curl -I https://contactly.io/_app/immutable/chunks/dashboard-Br4VGqxs.js.map
# Should be 404 or 403, NEVER 200.
```

If it's 200, the post-upload delete didn't happen — re-check `filesToDeleteAfterUpload` patterns against your actual output paths.

## 7. CI secret hygiene

`SENTRY_AUTH_TOKEN` is **server-only**. It must NOT have the `PUBLIC_` prefix. SvelteKit's `$env/dynamic/private` will refuse to import it client-side, but Vite plugins run in Node — they can read `process.env` directly, so the discipline is human, not enforced.

Two anti-patterns to avoid:

```ts
// ❌ DO NOT — leaks the token to the client bundle
import { SENTRY_AUTH_TOKEN } from '$env/static/public'; // would error, but conceptually
```

```ts
// ❌ DO NOT — token captured into a global accessible to the runtime
globalThis.__SENTRY_TOKEN__ = process.env.SENTRY_AUTH_TOKEN;
```

The plugin reads the token at build time only. Treat it like the `npm publish` token: CI-only, rotate quarterly.

## 8. Acceptance checklist

- [ ] `@sentry/vite-plugin` installed.
- [ ] `vite.config.ts` configures the plugin with `release.name = resolveBuildRelease(env)`.
- [ ] `build: { sourcemap: 'hidden' }` set.
- [ ] `filesToDeleteAfterUpload` lists `.svelte-kit/output/**/*.map` and `.vercel/output/**/*.map`.
- [ ] `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` set in CI + Vercel (Prod + Preview).
- [ ] No `PUBLIC_` prefix on the auth token.
- [ ] CI build log shows successful map upload.
- [ ] `curl -I` against any deployed `.map` URL returns 4xx.
- [ ] A test exception in production resolves to TypeScript file paths in Sentry.

## What's next

Bonus 18 takes the same release identifier and uses it for **drift detection** — pinning the SHA the browser tab loaded so a stale tab can detect a fresh deploy and prompt the user to reload before they hit a "this build is gone" 500.
