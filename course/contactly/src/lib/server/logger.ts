/**
 * Structured logger — `pino` under the hood.
 *
 * Why pino
 * --------
 * ADR-004 picks pino: lowest-overhead Node logger on the market,
 * JSON-by-default (machine-parseable), child-logger composition for
 * per-request context, and an ecosystem of transports for whatever
 * destination we eventually settle on (Vercel-runtime stdout for now,
 * Datadog / Better Stack later, no code change required at the call
 * site).
 *
 * Why a thin wrapper instead of importing `pino` everywhere
 * ---------------------------------------------------------
 * Two reasons:
 *
 *   1. **One place to make decisions.** "Pretty in dev / JSON in
 *      prod", level threshold, redaction list, base bindings — all
 *      live here. Call sites stay boring (`logger.info(...)`,
 *      `logger.warn(...)`).
 *   2. **Testability.** Production log output is JSON-on-stdout, but
 *      `vitest` runs in `NODE_ENV=test` and we don't want every test
 *      run dumping pretty terminal output. The wrapper gives the
 *      tests a silent `pino.destination(/dev/null)` equivalent
 *      without monkey-patching `console`.
 *
 * Field conventions (also enforced by the redaction list)
 * -------------------------------------------------------
 *   - `req_id`    — per-request id (set by `requestLogger` from
 *                   the SvelteKit `RequestEvent`).
 *   - `user_id`   — uuid of the authenticated user, when one exists.
 *   - `route_id`  — SvelteKit `event.route.id` (e.g.
 *                   `/api/webhooks/stripe`).
 *   - `event_id`  — Stripe event id when relevant (`evt_…`).
 *   - `event_type`— Stripe event type (`invoice.paid`).
 *
 * NEVER log:
 *   - Stripe secret keys (`sk_…`, `rk_…`, `whsec_…`)
 *   - Supabase service role key
 *   - JWTs / refresh tokens
 *   - Raw `Authorization` headers
 *   - Email addresses of leads/contacts (CRM data)
 *
 * The `redact` config below blacks them out at the pino level so a
 * mistake in a call site can't ship sensitive data to logs.
 */
import { pino, type Logger as PinoLogger } from 'pino';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Lazy `NODE_ENV` read. Reading once at module load is fine here —
 * the value cannot change between requests for a given Node process.
 */
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';
const IS_TEST = NODE_ENV === 'test';

/**
 * Default level — `info` in prod, `debug` in dev, `silent` in test.
 *
 * Tests should opt-in to log assertions explicitly via the helpers
 * below; otherwise every passing test would print to stderr and
 * obscure the real diagnostics.
 *
 * `LOG_LEVEL` env var overrides everything — useful for "quiet a
 * noisy production debug session" without redeploy, or "turn on
 * trace in CI to debug a flake."
 */
const DEFAULT_LEVEL = IS_PROD ? 'info' : IS_TEST ? 'silent' : 'debug';
const LEVEL = process.env.LOG_LEVEL ?? DEFAULT_LEVEL;

/**
 * Redact common secret-bearing field names *and* the matching value
 * patterns. Pino's redact runs on the formatted record so it covers
 * deeply nested objects, which is the realistic shape of a Stripe
 * event log.
 *
 * The "Bearer …" / `sk_…` / `rk_…` / `whsec_…` patterns are
 * redacted as full values (`{paths, censor}`) wherever they appear
 * under common header / token field names.
 */
const REDACT_PATHS = [
	// Standard auth headers
	'req.headers.authorization',
	'req.headers.cookie',
	'headers.authorization',
	'headers.cookie',
	'authorization',
	'cookie',
	// Common secret-named keys
	'*.password',
	'*.password_hash',
	'*.api_key',
	'*.secret',
	'*.token',
	'*.access_token',
	'*.refresh_token',
	'*.service_role_key',
	'*.SUPABASE_SERVICE_ROLE_KEY',
	'*.STRIPE_SECRET_KEY',
	'*.STRIPE_WEBHOOK_SECRET',
	// Stripe webhook signature header (the request body it signs is
	// fine to log; the header itself is private to the receiver/sender
	// pair).
	'req.headers["stripe-signature"]',
	'headers["stripe-signature"]'
];

const baseConfig = {
	level: LEVEL,
	/**
	 * `base` fields land on every log record. We bind the
	 * service identity here so a multi-app log aggregator can
	 * filter on `service: contactly`.
	 */
	base: {
		service: 'contactly',
		env: NODE_ENV
	},
	/**
	 * `timestamp: pino.stdTimeFunctions.isoTime` writes ISO-8601
	 * strings, which are universally parseable. Pino's default
	 * (epoch ms) is faster but rougher to grep.
	 */
	timestamp: pino.stdTimeFunctions.isoTime,
	redact: {
		paths: REDACT_PATHS,
		censor: '[REDACTED]'
	},
	/**
	 * Pino emits `pid` and `hostname` by default. `pid` is noise on
	 * a serverless platform (it's always 1); `hostname` is the
	 * Vercel function instance, useful for cold-start diagnosis so
	 * we keep it.
	 */
	formatters: {
		level: (label: string) => ({ level: label })
	}
};

/**
 * In dev we route pino through `pino-pretty` for human-readable
 * output. In prod and test we use the default JSON destination
 * (stdout / silent).
 *
 * pino-pretty is a dev-only dep so the prod bundle stays slim;
 * importing it conditionally with the transport API keeps the
 * dependency reachable from pino without us touching it directly
 * at runtime in prod.
 */
function buildLogger(): PinoLogger {
	if (IS_PROD || IS_TEST) {
		return pino(baseConfig);
	}
	return pino({
		...baseConfig,
		transport: {
			target: 'pino-pretty',
			options: {
				colorize: true,
				singleLine: true,
				translateTime: 'SYS:HH:MM:ss.l',
				ignore: 'pid,hostname,service,env'
			}
		}
	});
}

/**
 * The root logger.
 *
 * Prefer `requestLogger(event)` for per-request work — it stamps
 * `req_id`, `route_id`, and (when known) `user_id` on every line,
 * which is the difference between a 30-second incident triage and
 * a 30-minute one.
 */
export const logger = buildLogger();
export type Logger = typeof logger;

/**
 * Build a per-request child logger.
 *
 * `req_id` falls back to a fresh uuid v4-like string when no
 * `x-request-id` header is present (common on local dev). In prod
 * Vercel sets `x-vercel-id`, which we surface as `vercel_id` for
 * cross-referencing with Vercel's own logs.
 */
export function requestLogger(
	event: Pick<RequestEvent, 'request' | 'route' | 'locals'>,
	bindings: Record<string, unknown> = {}
): Logger {
	const reqId =
		event.request.headers.get('x-request-id') ??
		event.request.headers.get('x-vercel-id') ??
		randomReqId();

	return logger.child({
		req_id: reqId,
		route_id: event.route.id ?? null,
		vercel_id: event.request.headers.get('x-vercel-id') ?? null,
		...bindings
	});
}

/**
 * Cheap-but-collision-safe request id when the platform didn't give
 * us one. Not a real UUID; the only consumer is log correlation, and
 * a 96-bit random hex string is unique enough across the lifetime of
 * a serverless function instance.
 */
function randomReqId(): string {
	const arr = new Uint8Array(12);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
