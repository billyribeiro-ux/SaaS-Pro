/**
 * Admin → Webhook health page (Module 10.3).
 *
 * Reads the same `getWebhookHealth` snapshot the JSON endpoint
 * does and feeds it to the page component. The (admin) layout has
 * already gated the request to platform admins; we don't re-check.
 *
 * `loadError` is a soft-fail rather than `throw error(500)`: a
 * Postgres hiccup on this page should still render the chrome and
 * an explanatory banner, not a generic 500 that an on-call admin
 * has to ssh into something to interpret.
 */
import type { PageServerLoad } from './$types';
import { getWebhookHealth, type WebhookHealthSnapshot } from '$lib/server/billing/webhook-health';

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

	return { snapshot, loadError };
};
