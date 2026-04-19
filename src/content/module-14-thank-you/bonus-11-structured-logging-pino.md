---
title: 'Bonus: Structured Logging with Pino'
module: 14
lesson: 11
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-11-structured-logging-pino'
description: 'Replace ad-hoc console.log with a per-request, JSON-structured logger that ships verbatim to Vercel and any aggregator (Datadog, Better Stack, Logtail) — with redaction, request IDs, and zero noise in tests.'
duration: 22
preview: false
---

# Bonus: Structured Logging with Pino

It is 2 a.m. A user reports that their checkout failed. You SSH (well, `vercel logs`) into production and you see this:

```
[stripe-webhook] received event
[stripe-webhook] received event
[stripe-webhook] dispatch failed: TypeError ...
[stripe-webhook] received event
[stripe-webhook] processed
[stripe-webhook] received event
```

Which event failed? For which user? In which region? At what request ID? You have no idea, because every line is a free-form `console.warn` and the lines have interleaved across six concurrent webhook deliveries.

This is the problem **structured logging** solves. Every line is a JSON object with the same set of base fields (`req_id`, `route_id`, `user_id`, `service`, `env`), and every additional field is a typed key — `event_id`, `event_type`, `pg_code`, `err`. Log aggregators index those fields and let you ask "show me every line with `event_id = evt_1234`" in milliseconds.

This lesson swaps `console.*` for [Pino](https://getpino.io) — the lowest-overhead Node logger by a wide margin — wires a per-request logger onto SvelteKit's `event.locals`, and bakes in redaction so a sloppy call site can never ship `Authorization: Bearer …` to your log aggregator.

By the end of this lesson you will:

- Understand why structured logs beat `console.*` in any system bigger than one user.
- Install Pino with `pino-pretty` for dev and JSON-to-stdout for prod.
- Wire a per-request logger onto `event.locals.logger` in `hooks.server.ts`.
- Bind contextual fields (`req_id`, `route_id`, `user_id`, webhook `event_id`) via Pino's `child()` API.
- Redact secrets at the logger layer — `Authorization`, `Cookie`, `Stripe-Signature`, `*.password`, `*.token`.
- Stay silent in unit tests so test runs aren't drowned in production-shaped log lines.
- Test that critical code paths emit the structured fields you expect.

## 1. Why Pino and not console

The case for swapping `console.*` for a real logger boils down to four things:

1. **Format consistency.** Pino emits one JSON object per line, every line. `grep`, `jq`, and every log aggregator on earth can parse it. `console.warn('something happened:', someObject)` produces a string with an object literal mashed onto the end — unparseable.
2. **Context inheritance.** A "child" logger inherits its parent's bindings for free. Bind `req_id` once on the way in, every subsequent `info()` carries it. With `console.*`, every call site has to remember to include the same context, and no two will spell the same field the same way.
3. **Level discipline.** `pino.info` and `pino.warn` produce different `level` numbers in the JSON. Your aggregator can route `level >= 50` (warn and above) to PagerDuty without any regex.
4. **Redaction is built-in.** A single config line — `redact: { paths: ['*.password', 'headers.authorization'], censor: '[REDACTED]' }` — applies to every log call in the app. You don't have to remember to scrub at the call site.

Pino specifically (vs Winston / Bunyan / etc.) wins on raw throughput; the webhook receiver runs on the hot path of every Stripe delivery, and we don't want to pay 5–10× the per-call cost just to write a JSON line.

## 2. Install

```bash
pnpm add pino
pnpm add -D pino-pretty
```

Two packages:

- `pino` is the production logger; ships JSON to `stdout`.
- `pino-pretty` is the dev transport; reformats those JSON lines into colourised single-line output so you can read them in your terminal.

## 3. The logger module

Create `src/lib/server/logger.ts`:

```ts
import pino, { type Logger, type LoggerOptions, stdTimeFunctions } from 'pino';
import type { RequestEvent } from '@sveltejs/kit';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const baseOptions: LoggerOptions = {
	level: process.env.LOG_LEVEL ?? (isProd ? 'info' : isTest ? 'silent' : 'debug'),
	timestamp: stdTimeFunctions.isoTime,
	base: { service: 'contactly', env: process.env.NODE_ENV },
	redact: {
		paths: [
			'req.headers.authorization',
			'headers.authorization',
			'cookie',
			'headers.cookie',
			'headers["stripe-signature"]',
			'*.password',
			'*.password_hash',
			'*.api_key',
			'*.secret',
			'*.token',
			'*.access_token',
			'*.refresh_token',
			'*.SUPABASE_SERVICE_ROLE_KEY',
			'*.STRIPE_SECRET_KEY',
			'*.STRIPE_WEBHOOK_SECRET'
		],
		censor: '[REDACTED]'
	}
};

const transport = isProd
	? undefined
	: {
			target: 'pino-pretty',
			options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' }
		};

export const logger: Logger = pino({ ...baseOptions, transport });

export function requestLogger(event: RequestEvent, bindings: Record<string, unknown> = {}): Logger {
	const req_id =
		event.request.headers.get('x-request-id') ??
		event.request.headers.get('x-vercel-id') ??
		crypto.randomUUID();
	const vercel_id = event.request.headers.get('x-vercel-id') ?? undefined;
	return logger.child({ req_id, route_id: event.route.id, vercel_id, ...bindings });
}

export type { Logger };
```

The decisions baked in here:

| Decision      | Choice                                                                   | Why                                                                                                  |
| ------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Default level | `info` in prod, `debug` in dev, `silent` in test (`LOG_LEVEL` overrides) | Tests stay quiet by default; ops can dial up verbosity in production without redeploy.               |
| Time format   | `pino.stdTimeFunctions.isoTime`                                          | ISO-8601 strings are grep-friendly and timezone-explicit.                                            |
| Base bindings | `service: 'contactly', env: NODE_ENV`                                    | Multi-app log aggregator filtering — "show me only Contactly errors in prod".                        |
| Redact        | Auth headers + cookie + the obvious secret-shaped field names            | Failsafe for sloppy call sites; ~no measurable cost per log call.                                    |
| Censor string | `[REDACTED]`                                                             | Search-friendly — grep for `[REDACTED]` instantly surfaces every place a secret _would_ have leaked. |
| Request ID    | `x-request-id` → `x-vercel-id` → random UUID                             | Use the platform's id when present; synthesize otherwise so every line correlates.                   |

## 4. Wire it into hooks.server.ts

Update `src/app.d.ts` to type the logger on `App.Locals`:

```ts
declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			logger: import('$lib/server/logger').Logger;
		}
	}
}
```

Then in `src/hooks.server.ts`, attach the logger before any other locals:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { requestLogger } from '$lib/server/logger';

const logging: Handle = async ({ event, resolve }) => {
	event.locals.logger = requestLogger(event);
	return resolve(event);
};

export const handle = sequence(logging /* supabase, auth, etc. */);
```

Now every server `load`, form action, and `+server.ts` route gets a per-request logger off `event.locals.logger` with full TypeScript autocomplete.

## 5. Migrate a hot path — the Stripe webhook

Before, in `src/routes/api/webhooks/stripe/+server.ts`:

```ts
console.warn('[stripe-webhook] signature verification failed:', message);
```

After:

```ts
const log = locals.logger;
log.warn({ err: message }, 'webhook signature verification failed');
```

Once the event is verified, re-bind for the rest of the handler:

```ts
const eventLog = log.child({ event_id: event.id, event_type: event.type });
eventLog.info({ idempotent: alreadyProcessed }, 'webhook received');
// ...
eventLog.error({ err: dispatchError.message }, 'webhook dispatch failed');
```

Every line below the `child()` inherits `req_id`, `route_id`, `event_id`, and `event_type`. **"Find every log line for that one stuck event" is now a one-grep operation in production.**

## 6. Field conventions

Pick a small set of field names and stick to them. Inconsistent field names ("userId" vs "user_id" vs "uid") destroy the value of structured logging.

| Field        | Meaning                                                       | Set by                       |
| ------------ | ------------------------------------------------------------- | ---------------------------- |
| `service`    | Always `contactly`                                            | base binding                 |
| `env`        | `NODE_ENV` snapshot                                           | base binding                 |
| `req_id`     | Per-request id (`x-request-id` → `x-vercel-id` → random)      | `requestLogger`              |
| `route_id`   | SvelteKit `event.route.id`                                    | `requestLogger`              |
| `vercel_id`  | Vercel function instance id                                   | `requestLogger`              |
| `user_id`    | uuid of the authenticated user                                | the auth hook                |
| `event_id`   | Stripe event id (`evt_…`)                                     | webhook receiver `child()`   |
| `event_type` | Stripe event type (`invoice.paid`)                            | webhook receiver `child()`   |
| `pg_code`    | Postgres `SQLSTATE` code on a Supabase error                  | service-layer error branches |
| `err`        | Human-readable error message, never the `Error` object itself | every catch                  |

Why `err` is a string and not an `Error`: Pino can serialize an `Error` if you let it, but stack traces on every log line balloon log volume and cost. Stack traces for _real_ errors land in Sentry (Bonus 12); the log carries the message + correlating context, and Sentry has the rest.

## 7. Test silence + log assertions

Two patterns are enough to cover everything:

**Pattern 1 — let log calls happen, ignore them.** With `NODE_ENV=test`, the default level is `silent` and every log call is a no-op. Your unit tests don't have to mock anything.

**Pattern 2 — assert on logger calls when the log _is_ the contract.** Hand-roll a fake logger:

```ts
import type { Logger } from '$lib/server/logger';

export function fakeLogger() {
	const calls = { warn: [] as unknown[][], error: [] as unknown[][], info: [] as unknown[][] };
	const log = {
		trace: () => undefined,
		debug: () => undefined,
		info: (...a: unknown[]) => calls.info.push(a),
		warn: (...a: unknown[]) => calls.warn.push(a),
		error: (...a: unknown[]) => calls.error.push(a),
		fatal: () => undefined,
		child: () => log,
		__calls: calls
	};
	return log as unknown as Logger & { __calls: typeof calls };
}
```

Then in a test:

```ts
const log = fakeLogger();
await markEventProcessed({ id: 'evt_1' }, badDb, log);

expect(log.__calls.error[0]?.[0]).toMatchObject({ pg_code: '23505', err: expect.any(String) });
```

This double is intentionally _not_ `vi.fn()` per method because it lets the test assert on the structured **payload** shape, not just on whether `warn` was called. That is the property you actually care about: every error line should carry `pg_code`, `err`, etc., not just human-readable text.

## 8. What about client-side logs?

Pino is a server library. For client-side errors, see Bonus 12 (Sentry) — Sentry's browser SDK is the right tool for JavaScript runtime errors, unhandled promise rejections, and console capture. Don't try to ship Pino to the browser; you will pay for the bundle size and get nothing.

## 9. Production readout

Once deployed, `vercel logs --follow` (or your aggregator of choice) shows lines like:

```json
{"level":30,"time":"2026-04-19T10:23:17.123Z","service":"contactly","env":"production","req_id":"iad1::abc123","route_id":"/api/webhooks/stripe","event_id":"evt_1NXyzABC","event_type":"invoice.paid","msg":"webhook received"}
{"level":30,"time":"2026-04-19T10:23:17.241Z","service":"contactly","env":"production","req_id":"iad1::abc123","route_id":"/api/webhooks/stripe","event_id":"evt_1NXyzABC","event_type":"invoice.paid","msg":"webhook processed","duration_ms":118}
```

Now answering "what happened to evt_1NXyzABC" is `grep evt_1NXyzABC` and you get the full request timeline. That is the win.

## 10. Acceptance checklist

- [ ] `pino` and `pino-pretty` installed.
- [ ] `src/lib/server/logger.ts` exports `logger` and `requestLogger(event)`.
- [ ] `App.Locals.logger` typed in `app.d.ts`.
- [ ] `hooks.server.ts` populates `event.locals.logger` before any other locals.
- [ ] At least one hot-path file (e.g. the Stripe webhook receiver) migrated off `console.*` and onto `locals.logger`.
- [ ] `pnpm run dev` shows pretty single-line logs.
- [ ] `NODE_ENV=production node build/` would emit JSON.
- [ ] `LOG_LEVEL=trace` raises verbosity without code change.
- [ ] Unit tests stay silent (no `console.*` noise in `pnpm run test:unit`).

## What's next

Bonus 12 wires Sentry on top of this logger so unhandled errors get stack traces, source-map-resolved frames, and the `req_id` you just bound here flows through to every Sentry issue — turning "find the failing request" into a one-click operation.
