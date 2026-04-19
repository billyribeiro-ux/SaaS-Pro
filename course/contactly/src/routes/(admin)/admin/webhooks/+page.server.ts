/**
 * Admin → Webhook health page (Module 10.3 / extended in 10.4).
 *
 * Reads the same `getWebhookHealth` snapshot the JSON endpoint
 * does and feeds it to the page component. The (admin) layout has
 * already gated the request to platform admins; we don't re-check.
 *
 * `loadError` is a soft-fail rather than `throw error(500)`: a
 * Postgres hiccup on this page should still render the chrome and
 * an explanatory banner, not a generic 500 that an on-call admin
 * has to ssh into something to interpret.
 *
 * Form actions (Module 10.4):
 *   - `?/replay`        — single-event replay. Form fields:
 *                         `eventId` (required), `dryRun` (bool).
 *   - `?/replayBatch`   — batch replay of the current backlog
 *                         (capped at `MAX_BATCH_REPLAY`).
 *                         `dryRun` (bool).
 *
 * Returning the action result via `message(...)` from
 * `sveltekit-superforms` would be heavier than the surface needs —
 * the form is two fields and a button. We use the built-in
 * `ActionResult` shape (success object literal) and surface it
 * via SvelteKit's `form` prop on the page.
 */
import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getWebhookHealth, type WebhookHealthSnapshot } from '$lib/server/billing/webhook-health';
import {
	MAX_BATCH_REPLAY,
	replayStripeEvent,
	replayStuckEvents,
	type ReplayOutcome
} from '$lib/server/billing/webhook-replay';

export const load: PageServerLoad = async ({ locals }) => {
	const log = locals.logger.child({ admin_page: 'webhooks' });
	let snapshot: WebhookHealthSnapshot | null = null;
	let loadError: string | null = null;

	try {
		snapshot = await getWebhookHealth(log);
	} catch (err) {
		loadError = err instanceof Error ? err.message : 'unknown error';
		log.error({ err: loadError }, 'admin/webhooks: getWebhookHealth threw');
	}

	return { snapshot, loadError, batchReplayCap: MAX_BATCH_REPLAY };
};

export const actions: Actions = {
	replay: async ({ request, locals }) => {
		const log = locals.logger.child({ admin_action: 'replay-single' });
		const data = await request.formData();
		const eventId = String(data.get('eventId') ?? '').trim();
		const dryRun = data.get('dryRun') === 'true';

		if (!/^evt_[A-Za-z0-9_]+$/.test(eventId)) {
			return fail(400, { kind: 'replay', error: 'Invalid eventId.' });
		}

		const outcome = await replayStripeEvent(eventId, log, { dryRun });
		return { kind: 'replay', outcome };
	},

	replayBatch: async ({ request, locals }) => {
		const log = locals.logger.child({ admin_action: 'replay-batch' });
		const data = await request.formData();
		const dryRun = data.get('dryRun') === 'true';

		const result = await replayStuckEvents({ dryRun }, log);
		return { kind: 'replayBatch', ...result };
	}
};

/**
 * Helpful re-export for tests + future deep links.
 */
export type { ReplayOutcome };
