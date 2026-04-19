/**
 * Webhook backlog health endpoint (Module 10.3).
 *
 * GET /api/admin/webhooks/health
 *
 * Returns a JSON snapshot of the unprocessed-event backlog with
 * the HTTP status the classifier picked:
 *
 *   - `200` when healthy or degraded.
 *   - `503` when unhealthy.
 *
 * Auth comes from `requireAdminOrToken`: a bearer
 * `OPS_API_TOKEN` for monitors, or a signed-in `is_platform_admin`
 * profile for human triage. Unauthorised callers see a 404 — the
 * very existence of the endpoint is invisible to them.
 *
 * The response intentionally mirrors what
 * Vercel/Datadog/UptimeRobot want out of a health check: a small,
 * stable JSON shape and a status code that's enough on its own to
 * fire an alert. Detail fields (`oldestUnprocessedAgeMs`,
 * `byEventType`) are there so the admin dashboard can avoid a
 * second roundtrip.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminOrToken } from '$lib/server/auth/admin';
import { getWebhookHealth } from '$lib/server/billing/webhook-health';

export const GET: RequestHandler = async (event) => {
	const principal = await requireAdminOrToken(event);
	const log = event.locals.logger.child({
		admin_principal: principal.kind,
		user_id: principal.kind === 'user' ? principal.userId : undefined
	});

	const snapshot = await getWebhookHealth(log);

	if (snapshot.status !== 'healthy') {
		log.warn(
			{
				webhook_status: snapshot.status,
				unprocessed_count: snapshot.unprocessedCount,
				oldest_age_ms: snapshot.oldestUnprocessedAgeMs
			},
			'webhook backlog non-healthy'
		);
	}

	// `Cache-Control: no-store` is mandatory — a CDN that caches
	// even a "healthy" 200 will silently mask the next regression.
	return json(snapshot, {
		status: snapshot.httpStatus,
		headers: {
			'cache-control': 'no-store'
		}
	});
};
