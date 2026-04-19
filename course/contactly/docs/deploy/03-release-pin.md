# 11.3 — Build-time release pin & shared SHA across runtimes

> **Module 11 — Production deploy & adapter swap.**
>
> Lesson 3 of 5. We collapse the two near-identical
> `resolveRelease` implementations into a single primitive both
> the build pipeline and the runtime SDK import from, and surface
> the resolved release in the admin chrome + a no-auth `/api/version`
> endpoint.

## Why this is its own lesson

Lesson 11.2 introduced a `resolveBuildRelease()` helper inside
`vite.config.ts` and explained that it had to mirror the
`resolveRelease()` in `src/lib/sentry-shared.ts`. "Has to mirror"
is the foundation of every silent failure mode worth worrying
about:

- The two functions live in different files, in different
  runtimes, with different lint surfaces. PR review will not
  catch a one-character drift.
- Sentry's "I have a stack trace but no maps" UI shows _minified_
  frames, not "release tag mismatch — change here." The drift is
  invisible until you're already triaging an incident.
- The fix is structural, not procedural: collapse the duplicate
  to one source.

This lesson does that, plus two follow-ons that fall out of
having a clean primitive:

1. A `/api/version` endpoint — the smallest possible "what's
   deployed?" probe, callable from any monitoring tool.
2. A deploy-identity strip in the admin chrome — every operator
   action is now visibly bound to "this release, this commit,
   this environment."

## The shape of the change

```
┌─────────────────────────────────────┐
│  src/lib/release.ts  (new)          │
│                                     │
│  resolveRelease(env?)               │
│  resolveEnvironment(env?)           │
│  resolveCommitSha(env?)             │
│  resolveCommitBranch(env?)          │
└────┬───────────────────┬────────────┘
     │                   │
     │ relative path     │ $lib import
     ▼                   ▼
┌─────────────────┐  ┌──────────────────────┐
│ vite.config.ts  │  │ src/lib/sentry-      │
│  (build-time    │  │  shared.ts           │
│   plugin)       │  │  (runtime SDK)       │
└─────────────────┘  └──────────────────────┘
```

Same module, two import paths (one relative because Vite's
config can't yet resolve `$lib`). Both emit identical strings
for identical env input — by construction, not by convention.

## Why `release.ts` has zero project imports

`vite.config.ts` is loaded by Vite **before** the SvelteKit
plugin sets up the `$lib` alias. Importing `$lib/release` from
the config file would crash at build start. The fix is to make
`release.ts` a leaf:

- No `$lib/...` imports.
- No `@sveltejs/kit` types (which would pull the SvelteKit
  module graph into a file that's supposed to be plain Node).
- No transitive dependencies that touch the framework.

That makes the module portable: vite-config imports it by
relative path, runtime code imports it via `$lib`, unit tests
import it directly. One implementation, three call sites.

## API surface

```ts
// Module 11.3 — src/lib/release.ts
export function resolveRelease(env?: Record<string, string | undefined>): string;
export function resolveEnvironment(env?: Record<string, string | undefined>): string;
export function resolveCommitSha(env?: Record<string, string | undefined>): string | null;
export function resolveCommitBranch(env?: Record<string, string | undefined>): string | null;
```

The optional `env` argument exists for one specific caller:
`vite.config.ts` already loaded a vars dict via Vite's `loadEnv`,
and we don't want to round-trip it through `process.env`. Every
other caller passes nothing and reads from `process.env`
lazily.

`resolveCommitSha` and `resolveCommitBranch` are new in 11.3
(neither lived in `sentry-shared.ts`). The first powers the
`commit` field on `/api/version`; the second feeds the deploy
strip in the admin chrome. Both gracefully return `null` when
the corresponding Vercel env var isn't injected, so local dev
shows a clean fallback rather than `'undefined'`.

## Precedence chain (unchanged from 11.2, now pinned by tests)

```
PUBLIC_SENTRY_RELEASE   (explicit override — CI pinning, semver tag)
       │
       ▼
VERCEL_GIT_COMMIT_SHA   (Vercel-injected, truncated to 12 chars)
       │
       ▼
'contactly@dev'         (local marker — Sentry rolls these together)
```

Six unit cases in `src/lib/release.test.ts` pin every transition
in this chain plus the explicit-`env`-dict path the build uses,
so a "small refactor" can't silently re-introduce drift.

## `/api/version`

```http
GET /api/version
Cache-Control: no-store

{
  "service": "contactly",
  "release": "contactly@a1b2c3d4e5f6",
  "commit":  "a1b2c3d4e5f6789abcdef0123456789abcdef012",
  "environment": "production",
  "branch": null,
  "now": "2026-04-19T18:32:00.000Z"
}
```

No auth, no rate limiting, no secrets. The fields are the same
ones already on every Sentry event from this build, so disclosure
is a no-op risk.

`branch` is intentionally suppressed in production — preview
deploys leak less interesting things ("we're working on
billing-portal-v2") to whoever pokes at `/api/version`. Operators
on a preview see the branch name; everyone else sees `null`.

`Cache-Control: no-store` is mandatory: the value changes on every
deploy, and a 60-second CDN cache turns "is the new code live?"
into a guessing game.

### Smoke-test usage

```bash
# After `vercel deploy --prod`, with the SHA from CI:
deployed_sha=$(curl -s https://contactly.app/api/version | jq -r .commit)
[[ "$deployed_sha" == "$GITHUB_SHA" ]] || exit 1
```

That single line catches:

- A partial deploy (functions updated, static assets stale).
- A failed source-map upload (release tag wrong = Sentry blind).
- A CDN misconfiguration (a stale edge cache serving the previous
  version's `/api/version`).

## Admin chrome — deploy-identity strip

`src/routes/(admin)/+layout.server.ts` now returns a `deploy`
object alongside the gated `user`:

```ts
return {
	user,
	deploy: {
		release: resolveRelease(),
		commit: resolveCommitSha(),
		environment: resolveEnvironment()
	}
};
```

The `(admin)/+layout.svelte` shell renders it as a tiny strip
next to the brand mark:

```
┌────────────────────────────────────────────────────────────────┐
│  Contactly admin   [production]  contactly@a1b2c3d4e5f6        │
│                                                                │
│                                                  Back to app   │
└────────────────────────────────────────────────────────────────┘
```

The environment pill is colour-coded:

| Environment   | Pill colour | Reason                                          |
| ------------- | ----------- | ----------------------------------------------- |
| `production`  | rose/red    | "you're acting on real customer data"           |
| `preview`     | amber       | "you're on a preview branch — expect surprises" |
| `development` | slate       | "this is your laptop"                           |

The full SHA hovers as a `title`. Ops staff who paste a
"Reference id" from a Sentry alert into the admin chrome get
unambiguous answer to "is this the deploy I'm looking at?"

## Cross-runtime guarantees

After 11.3 the following are tautologically true:

- `resolveRelease()` returns the same string in `vite.config.ts`,
  `src/hooks.server.ts`, `src/hooks.client.ts`, and the
  `/api/version` handler — they all import the same function.
- That string is the release tag on every uploaded source map
  (Sentry plugin) AND the release tag on every captured event
  (Sentry SDK). Symbolication "just works" — there is no path
  for the two to drift.
- An operator can read the deployed release in three places
  without leaving the app: the admin chrome, `/api/version`, and
  the `<meta>` tag the SDK injects. Three sources, one number.

## What's deliberately **not** here

- **Surfacing the deploy strip on every customer-facing page.**
  The chrome strip is admin-only. Customer pages get the same
  data via the `<meta>` tag the Sentry SDK injects automatically;
  that's already enough to grep for.
- **Auto-creating Sentry deploy entries.** Vercel's deploy hook
  → Sentry deploys API would close the loop (release exists →
  release deployed at `T`). Out of scope for Module 11; we'd add
  a new module for "deploy notification webhook" rather than
  bolting it onto the release pin.
- **Asserting release equality in CI.** The smoke-test snippet
  above is a runbook recipe, not framework code. We'll fold it
  into the runbook update in Lesson 11.5.

## Verification

```bash
pnpm run check        # ✓ 0 errors
pnpm run test:unit    # ✓ 186 tests pass (was 171; +15 from release.test.ts)
pnpm run lint         # ✓ clean
pnpm run build        # ✓ Vercel adapter output

curl -s http://localhost:5173/api/version | jq .
# {
#   "service": "contactly",
#   "release": "contactly@dev",
#   "commit": null,
#   "environment": "development",
#   "branch": null,
#   "now": "..."
# }
```

## Next

→ [11.4 — Security headers + preview-environment hardening](./04-security-headers.md)
