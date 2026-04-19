---
title: 'Bonus: Release Pinning & Drift Detection'
module: 14
lesson: 18
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-18-release-pin-drift-detection'
description: 'Collapse the build-time and runtime release helpers into one module, expose /api/version for monitors, surface the deployed SHA in the admin chrome, and detect when a long-open browser tab has drifted past a fresh deploy.'
duration: 20
preview: false
---

# Bonus: Release pinning & drift detection

Bonus 17 left a footnote: the `resolveBuildRelease()` in `vite.config.ts` and the `resolveRelease()` in `sentry-shared.ts` _have to_ produce the same string, or Sentry's source-map join silently fails.

"Has to mirror" is the foundation of every silent failure mode worth worrying about. The two functions live in different files, in different runtimes, with different lint surfaces — PR review will not catch a one-character drift, and the bug is invisible until you're already triaging an incident.

The fix is structural, not procedural: collapse the duplicate to one source.

This lesson does that, plus three follow-ons that fall out of having a clean primitive:

1. A `/api/version` endpoint — the smallest possible "what's deployed?" probe, callable from any monitoring tool.
2. A deploy-identity strip in the admin chrome — every operator action visibly bound to "this release, this commit, this environment."
3. A **drift detector** that compares the SHA the browser tab loaded with the SHA the server is currently serving, and prompts the user to reload before they hit a "this build is gone" 500.

By the end of this lesson you will:

- Move `resolveRelease`, `resolveEnvironment`, `resolveCommitSha`, `resolveCommitBranch` into a single `src/lib/release.ts` leaf module.
- Import the same module from `vite.config.ts` (relative path) and `$lib/sentry-shared.ts` ($lib path).
- Expose `GET /api/version` returning `{ release, environment, commit, branch, builtAt }`.
- Render a deploy-identity strip in the `(admin)` chrome.
- Add a client-side drift detector that polls `/api/version` and prompts on mismatch.
- Pin the precedence chain with unit tests so a sneaky refactor can't reintroduce drift.

## 1. The leaf module

`src/lib/release.ts`:

```ts
function from(env?: Record<string, string | undefined>) {
	return env ?? (typeof process !== 'undefined' ? process.env : {});
}

export function resolveRelease(env?: Record<string, string | undefined>): string {
	const e = from(env);
	const explicit = e.PUBLIC_SENTRY_RELEASE?.trim();
	if (explicit) return explicit;
	const sha = e.VERCEL_GIT_COMMIT_SHA?.trim();
	if (sha) return `contactly@${sha.slice(0, 12)}`;
	return 'contactly@dev';
}

export function resolveEnvironment(env?: Record<string, string | undefined>): string {
	const e = from(env);
	return e.VERCEL_ENV || e.NODE_ENV || 'development';
}

export function resolveCommitSha(env?: Record<string, string | undefined>): string | null {
	const e = from(env);
	return e.VERCEL_GIT_COMMIT_SHA?.trim() || null;
}

export function resolveCommitBranch(env?: Record<string, string | undefined>): string | null {
	const e = from(env);
	return e.VERCEL_GIT_COMMIT_REF?.trim() || null;
}
```

Critical constraints — keep the module a **leaf**:

- No `$lib/...` imports.
- No `@sveltejs/kit` types.
- No transitive dependencies that touch the framework.

That makes the module portable: `vite.config.ts` imports it by relative path, runtime code imports it via `$lib`, unit tests import it directly. One implementation, three call sites.

`vite.config.ts` is loaded by Vite **before** the SvelteKit plugin sets up the `$lib` alias. Importing `$lib/release` from the config file would crash at build start. The leaf-module rule sidesteps that.

## 2. Update both call sites

`vite.config.ts`:

```ts
import { resolveRelease } from './src/lib/release';
// ...
release: { name: resolveRelease(env), create: false, finalize: false }
```

`src/lib/sentry-shared.ts`:

```ts
import { resolveRelease, resolveEnvironment } from './release';

export function baseInitOptions(dsn: string) {
	const isProd = resolveEnvironment() === 'production';
	return {
		dsn,
		enabled: dsn.length > 0,
		release: resolveRelease(),
		environment: resolveEnvironment(),
		tracesSampleRate: isProd ? 0.1 : 1.0,
		sendDefaultPii: false
	};
}
```

Now the two paths cannot drift — they share the implementation.

## 3. `/api/version`

`src/routes/api/version/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import {
	resolveRelease,
	resolveEnvironment,
	resolveCommitSha,
	resolveCommitBranch
} from '$lib/release';

const builtAt = new Date().toISOString();

export const GET = () =>
	json(
		{
			release: resolveRelease(),
			environment: resolveEnvironment(),
			commit: resolveCommitSha(),
			branch: resolveCommitBranch(),
			builtAt
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
```

Three properties:

- **No auth.** This is a deploy-identity probe, not user data. It's safe to expose.
- **`builtAt` is captured at module load**, not on every request. It tells you "when did this Node process start?" — useful for spotting a stale instance.
- **`Cache-Control: no-store`.** A CDN that caches `/api/version` defeats every monitor downstream.

Now any external tool can `curl https://contactly.io/api/version` to know exactly what's deployed.

## 4. The admin chrome strip

In `(admin)/+layout.svelte`:

```svelte
<script lang="ts">
	let { children, data } = $props<{ children: Snippet; data: PageData }>();
	const releaseLabel = `${data.environment}@${data.commit?.slice(0, 7) ?? 'dev'}${
		data.branch ? ` (${data.branch})` : ''
	}`;
</script>

<div class="admin-chrome">
	<div class="release-strip">
		<span class="badge">internal</span>
		<span class="release">{releaseLabel}</span>
	</div>
	{@render children()}
</div>
```

Loaded in `(admin)/+layout.server.ts`:

```ts
import { resolveEnvironment, resolveCommitSha, resolveCommitBranch } from '$lib/release';

export function load() {
	return {
		environment: resolveEnvironment(),
		commit: resolveCommitSha(),
		branch: resolveCommitBranch()
	};
}
```

Every admin action is now visibly bound to a specific commit. No more "wait, which version was that on?" debates during a postmortem.

## 5. The drift detector

A user opens the dashboard, walks away from their desk, and comes back two hours later. Meanwhile you shipped a release. The browser tab still references chunk URLs from the OLD build. Their next interaction either 404s on `/_app/immutable/<old-hash>.js` or — more dangerously — succeeds with stale code that hits the new server's strict schema.

Detection is cheap: compare the SHA the page loaded with the SHA the server is currently serving.

`src/lib/components/system/DriftDetector.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';

	let { initialRelease }: { initialRelease: string } = $props();

	let driftDetected = $state(false);

	onMount(() => {
		const id = setInterval(async () => {
			try {
				const r = await fetch('/api/version', { cache: 'no-store' });
				if (!r.ok) return;
				const { release } = await r.json();
				if (release !== initialRelease) driftDetected = true;
			} catch {
				/* offline; try again next tick */
			}
		}, 60_000);
		return () => clearInterval(id);
	});

	function reload() {
		window.location.reload();
	}
</script>

{#if driftDetected}
	<div
		class="fixed inset-x-0 bottom-4 mx-auto w-fit rounded-lg bg-amber-500 px-4 py-3 text-white shadow-lg"
	>
		A new version of the app is available.
		<button class="ml-2 underline" onclick={reload}>Reload</button>
	</div>
{/if}
```

Wire it into `+layout.svelte` with the initial release from a server-load:

```svelte
<DriftDetector initialRelease={data.release} />
```

The 60-second poll is the right cadence for SaaS — short enough that a critical fix lands within ~1 min, long enough that 1,000 active tabs aren't a noticeable cost. Cheaper alternatives (websocket push, server-sent events) are doable but not worth the complexity at this scale.

## 6. Pin the precedence with tests

`src/lib/release.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveRelease, resolveEnvironment } from './release';

describe('resolveRelease precedence', () => {
	it('PUBLIC_SENTRY_RELEASE wins', () => {
		expect(resolveRelease({ PUBLIC_SENTRY_RELEASE: 'v1.2.3' })).toBe('v1.2.3');
	});
	it('falls back to truncated SHA', () => {
		expect(resolveRelease({ VERCEL_GIT_COMMIT_SHA: 'a1b2c3d4e5f6789012' })).toBe(
			'contactly@a1b2c3d4e5f6'
		);
	});
	it('falls back to contactly@dev', () => {
		expect(resolveRelease({})).toBe('contactly@dev');
	});
});

describe('resolveEnvironment precedence', () => {
	it('VERCEL_ENV wins', () => {
		expect(resolveEnvironment({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe('preview');
	});
	it('NODE_ENV next', () => {
		expect(resolveEnvironment({ NODE_ENV: 'test' })).toBe('test');
	});
	it('falls back to development', () => {
		expect(resolveEnvironment({})).toBe('development');
	});
});
```

These six cases pin the precedence chain. A "small refactor" can't silently change it without going red.

## 7. Acceptance checklist

- [ ] `src/lib/release.ts` is a leaf module (no `$lib`, no `@sveltejs/kit`).
- [ ] `vite.config.ts` and `sentry-shared.ts` import from the same `release.ts`.
- [ ] `GET /api/version` returns `{ release, environment, commit, branch, builtAt }` with `Cache-Control: no-store`.
- [ ] Admin chrome shows the release label.
- [ ] Drift detector polls `/api/version` every 60 s and prompts the user when `release` changes.
- [ ] Unit tests pin precedence for `resolveRelease` and `resolveEnvironment`.

## What's next

Bonus 19 hardens response headers — CSP, HSTS, COOP, Permissions-Policy — so even if a logic bug slips through, the browser refuses to execute it.
