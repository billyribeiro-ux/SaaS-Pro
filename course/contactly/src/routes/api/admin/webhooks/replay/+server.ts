/**
 * Webhook replay endpoint (Module 10.4).
 *
 * POST /api/admin/webhooks/replay
 *
 * Body shapes:
 *
 *   { "eventId": "evt_..." }                 single-event replay
 *   { "olderThanMs": 600000, "limit": 10 }    batch replay
 *   { "dryRun": true, ... }                   preview-only on either
 *
 * Auth: `requireAdminOrToken` (bearer or signed-in platform admin).
 *
 * The endpoint deliberately does NOT pretend to be idempotent
 * across calls — Stripe's own retry logic gives us delivery
 * idempotency; replay is a *recovery* primitive for the cases
 * where dispatch already crashed mid-way and the operator wants
 * to re-apply the missed side effects.
 *
 * The classification of "the request body itself was bad" lives
 * here (400). Anything beyond that — the actual dispatch outcome
 * — comes back as a per-event status inside the response body so
 * a partial-success batch reads as 200 with mixed outcomes,
 * never a 5xx that hides which events failed.
 */
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminOrToken } from '$lib/server/auth/admin';
import {
	MAX_BATCH_REPLAY,
	replayStripeEvent,
	replayStuckEvents
} from '$lib/server/billing/webhook-replay';

interface ReplayRequestBody {
	eventId?: unknown;
	olderThanMs?: unknown;
	limit?: unknown;
	dryRun?: unknown;
}

export const POST: RequestHandler = async (event) => {
	const principal = await requireAdminOrToken(event);
	const log = event.locals.logger.child({
		admin_principal: principal.kind,
		user_id: principal.kind === 'user' ? principal.userId : undefined
	});

	const body = await readJsonBody(event.request);
	if (!body) throw error(400, 'Request body must be a JSON object');

	const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
	const dryRun = body.dryRun === true;

	if (eventId) {
		if (!isValidEventId(eventId)) {
			throw error(400, 'eventId must look like `evt_…`');
		}
		const outcome = await replayStripeEvent(eventId, log, { dryRun });
		return json({ mode: 'single', outcome });
	}

	const olderThanMs = isNonNegativeInt(body.olderThanMs) ? Number(body.olderThanMs) : 0;
	const limit = isPositiveInt(body.limit)
		? Math.min(MAX_BATCH_REPLAY, Number(body.limit))
		: MAX_BATCH_REPLAY;

	const result = await replayStuckEvents({ olderThanMs, limit, dryRun }, log);
	return json({ mode: 'batch', ...result });
};

async function readJsonBody(req: Request): Promise<ReplayRequestBody | null> {
	const contentType = req.headers.get('content-type') ?? '';
	// Empty body is fine — treat as `{}` (default batch replay).
	if (contentType === '' || req.headers.get('content-length') === '0') return {};
	if (!contentType.toLowerCase().includes('application/json')) return null;
	try {
		const parsed: unknown = await req.json();
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as ReplayRequestBody;
	} catch {
		return null;
	}
}

function isValidEventId(s: string): boolean {
	return /^evt_[A-Za-z0-9_]+$/.test(s);
}

function isNonNegativeInt(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.trunc(v) === v;
}

function isPositiveInt(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= 1 && Math.trunc(v) === v;
}
