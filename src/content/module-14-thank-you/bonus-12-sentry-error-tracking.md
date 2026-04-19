---
title: 'Bonus: Sentry — Catch Errors in Production'
module: 14
lesson: 12
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-12-sentry-error-tracking'
description: 'Wire Sentry into both server and client runtimes with shared init options, release tagging from the Vercel git SHA, environment-aware sampling, and req_id correlation that links every Sentry issue to a single line in your structured logs.'
duration: 25
preview: false
---

# Bonus: Sentry — catch errors in production

Logs (Bonus 11) tell you _what_ happened. Sentry tells you _that something broke_, with a stack trace, the offending line of source code, the user it happened to, the browser they were on, and a dedupe count so the same crash across 10,000 users shows up as one issue with `× 10,000` next to it.

You can ship Contactly without Sentry — and you can also ship a car without seatbelts. The first time something breaks in production for a user you'll never hear from, you'll wish you'd added it on day one.

This lesson wires `@sentry/sveltekit` into both runtimes (server hooks + client hooks) with a single source of truth for init options, release tagging from the Vercel-provided git SHA, and `req_id` correlation that lets you click from a Sentry issue straight to the matching line in your structured logs.

By the end of this lesson you will:

- Install `@sentry/sveltekit` and configure both `hooks.server.ts` and `hooks.client.ts`.
- Share init options between runtimes via a `sentry-shared.ts` helper so they cannot drift.
- Resolve `release` from `PUBLIC_SENTRY_RELEASE` → `VERCEL_GIT_COMMIT_SHA` → `'dev'`.
- Resolve `environment` from `VERCEL_ENV` → `NODE_ENV` so previews never fire production alerts.
- Add `req_id`, `route_id`, `stripe_event_id`, `stripe_event_type` Sentry tags for one-click triage.
- Make the SDK a true no-op when `PUBLIC_SENTRY_DSN` is empty (the local-dev default).
- Wire `handleError` so unhandled errors land in both Sentry and your structured log.

## 1. Install

```bash
pnpm add @sentry/sveltekit
```

The package ships both runtimes — Node SDK for server, browser SDK for client — and SvelteKit-specific helpers (`sentryHandle`, `handleErrorWithSentry`) that compose with `@sveltejs/kit/hooks`.

## 2. Add the env var

Add `PUBLIC_SENTRY_DSN` to `.env.example` and your env validator:

```ts
import { z } from 'zod';

export const publicEnvSchema = z.object({
	PUBLIC_SUPABASE_URL: z.string().url(),
	PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
	PUBLIC_SENTRY_DSN: z
		.string()
		.refine((v) => v === '' || /^https:\/\/[^@]+@[^/]+\/\d+$/.test(v))
		.default(''),
	PUBLIC_SENTRY_RELEASE: z.string().optional()
});
```

Three valid states:

- **Empty** (default in `.env.example`) — Sentry disabled. Local dev never reports to the production project.
- **A real DSN** (`https://<key>@<host>/<project>`) — Sentry enabled.
- **Anything else** — boot fails loudly with a precise validator error.

That last case is the value of validating env at all: a typo'd DSN that silently disables Sentry would only be discovered the day you needed Sentry the most.

## 3. The shared init helper

Create `src/lib/sentry-shared.ts`:

```ts
export function resolveRelease(env: Record<string, string | undefined> = process.env): string {
	if (env.PUBLIC_SENTRY_RELEASE) return env.PUBLIC_SENTRY_RELEASE;
	const sha = env.VERCEL_GIT_COMMIT_SHA;
	if (sha) return `contactly@${sha.slice(0, 12)}`;
	return 'contactly@dev';
}

export function resolveEnvironment(env: Record<string, string | undefined> = process.env): string {
	return env.VERCEL_ENV || env.NODE_ENV || 'development';
}

export function baseInitOptions(dsn: string) {
	const isProd = resolveEnvironment() === 'production';
	return {
		dsn,
		enabled: dsn.length > 0,
		release: resolveRelease(),
		environment: resolveEnvironment(),
		tracesSampleRate: isProd ? 0.1 : 1.0,
		sendDefaultPii: false
	} as const;
}
```

The decisions:

| Field              | Value                          | Why                                                                                       |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `enabled`          | `dsn.length > 0`               | Empty DSN ⇒ true no-op; the SDK won't start its transport at all.                         |
| `release`          | `resolveRelease()`             | Tied to git SHA so source maps (Bonus 17) match the deployed bundle.                      |
| `environment`      | `resolveEnvironment()`         | Previews route to a separate Sentry environment and don't trip prod alerts.               |
| `tracesSampleRate` | `0.1` in prod, `1.0` otherwise | Spot regressions in prod cheaply; capture every span in dev.                              |
| `sendDefaultPii`   | `false`                        | We attach `user_id` ourselves where it's relevant; implicit IP-address capture stays off. |

## 4. Server wiring

In `src/hooks.server.ts`:

```ts
import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry, sentryHandle } from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as publicEnv } from '$env/dynamic/public';
import { baseInitOptions } from '$lib/sentry-shared';
import { requestLogger, logger as rootLogger } from '$lib/server/logger';

Sentry.init({ ...baseInitOptions(publicEnv.PUBLIC_SENTRY_DSN ?? '') });

const handleApp: Handle = async ({ event, resolve }) => {
	event.locals.logger = requestLogger(event);
	const reqId = event.locals.logger.bindings().req_id;
	if (typeof reqId === 'string') Sentry.setTag('req_id', reqId);
	if (event.route.id) Sentry.setTag('route_id', event.route.id);
	return resolve(event);
};

export const handle: Handle = sequence(sentryHandle(), handleApp);

export const handleError: HandleServerError = handleErrorWithSentry(
	({ error, event, status, message }) => {
		const log = event.locals.logger ?? rootLogger;
		log.error(
			{
				err: error instanceof Error ? error.message : String(error),
				status,
				route_id: event.route.id ?? null
			},
			message ?? 'Uncaught server error'
		);
	}
);
```

Three things matter here:

1. **Module-load `Sentry.init`** runs once per Node process, not per request.
2. **`sentryHandle()` is outermost** in the `sequence(...)` because the SDK has to wrap the rest of the request lifecycle to instrument the request span.
3. **The Sentry tags `req_id` + `route_id`** come from the same `requestLogger` that stamps log lines. Pick whichever side of the system you noticed the problem from; the other side is one search away.

## 5. Client wiring

Create `src/hooks.client.ts`:

```ts
import { init as sentryInit, handleErrorWithSentry } from '@sentry/sveltekit';
import { env as publicEnv } from '$env/dynamic/public';
import { baseInitOptions } from '$lib/sentry-shared';

sentryInit({ ...baseInitOptions(publicEnv.PUBLIC_SENTRY_DSN ?? '') });

export const handleError = handleErrorWithSentry();
```

Lean on purpose. Future breadcrumbs (Web Vitals, PII redaction filters, custom integrations) land here as additive options — never moved out into a separate file.

## 6. Webhook tagging

Inside `src/routes/api/webhooks/stripe/+server.ts`, right after signature verification:

```ts
import { setTag as sentrySetTag } from '@sentry/sveltekit';

const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
sentrySetTag('stripe_event_id', event.id);
sentrySetTag('stripe_event_type', event.type);
```

A failing `invoice.payment_failed` now surfaces in Sentry with:

- `route_id: '/api/webhooks/stripe'`
- `req_id: …` (matches the structured log line)
- `stripe_event_id: 'evt_…'`
- `stripe_event_type: 'invoice.payment_failed'`
- `release: 'contactly@a1b2c3d4e5f6'`
- `environment: 'production'`

That's everything an on-call engineer needs to triage in one glance.

## 7. Testing

Two things to test:

**Test the helper.** `src/lib/sentry-shared.test.ts` covers env precedence and the empty-DSN no-op:

```ts
import { describe, it, expect } from 'vitest';
import { resolveRelease, resolveEnvironment, baseInitOptions } from './sentry-shared';

describe('resolveRelease', () => {
	it('uses PUBLIC_SENTRY_RELEASE when set', () => {
		expect(resolveRelease({ PUBLIC_SENTRY_RELEASE: 'contactly@v1.2.3' })).toBe('contactly@v1.2.3');
	});
	it('falls back to truncated VERCEL_GIT_COMMIT_SHA', () => {
		expect(resolveRelease({ VERCEL_GIT_COMMIT_SHA: 'a1b2c3d4e5f6789012345' })).toBe(
			'contactly@a1b2c3d4e5f6'
		);
	});
	it('falls back to contactly@dev', () => {
		expect(resolveRelease({})).toBe('contactly@dev');
	});
});

describe('baseInitOptions', () => {
	it('disables when DSN is empty', () => {
		expect(baseInitOptions('').enabled).toBe(false);
	});
	it('enables when DSN is set', () => {
		expect(baseInitOptions('https://abc@o.ingest.sentry.io/123').enabled).toBe(true);
	});
});
```

**Mock the SDK in webhook tests.** Otherwise unit tests pull in the SDK transport:

```ts
vi.mock('@sentry/sveltekit', () => ({
	setTag: vi.fn(),
	captureException: vi.fn()
}));
```

End-to-end "an unhandled error reaches Sentry" coverage lands in Bonus 21–25 (cassette harness).

## 8. How to verify locally

1. Set `PUBLIC_SENTRY_DSN` to a project DSN in `.env`.
2. `pnpm run dev` and visit a route that throws.
3. Sentry's "Issues" tab should show the event within seconds, with `req_id`, `route_id`, `release`, `environment`, and any Stripe tags attached.
4. Cross-check the structured-log output for the same `req_id` — the lines line up exactly.

Leaving the DSN empty is the right local default; the SDK warns once at startup that it's disabled and then never speaks again.

## 9. Acceptance checklist

- [ ] `@sentry/sveltekit` installed.
- [ ] `PUBLIC_SENTRY_DSN` validated as `''` or a real DSN URL.
- [ ] `src/lib/sentry-shared.ts` exports `resolveRelease`, `resolveEnvironment`, `baseInitOptions`.
- [ ] `hooks.server.ts` calls `Sentry.init` at module load and uses `sentryHandle()` outermost in the sequence.
- [ ] `hooks.client.ts` initialises with the same shared options.
- [ ] `handleError` (server + client) is wrapped via `handleErrorWithSentry`.
- [ ] Webhook receiver tags `stripe_event_id` + `stripe_event_type` after signature verification.
- [ ] `req_id` is set as a Sentry tag and matches the structured-log `req_id`.
- [ ] Empty DSN ⇒ SDK is a no-op (asserted in tests).

## What's next

Bonus 17 closes the loop on Sentry by uploading source maps from CI so production stack traces resolve to original TypeScript filenames + line numbers — the difference between "TypeError at chunk-A8B7.js:1:2453" and "TypeError at src/lib/server/billing/checkout.ts:142:18".
