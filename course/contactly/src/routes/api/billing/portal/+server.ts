/**
 * POST /api/billing/portal — open the Stripe Customer Portal.
 *
 * Mirror of /api/billing/checkout (Lesson 9.1) — auth, CSRF (via
 * SvelteKit's built-in origin check), thin dispatch, 303 to the
 * Stripe-hosted page. The user comes back to `return_url` (defaults
 * to /account) once they're done.
 *
 * REFUSAL PATH
 * ------------
 * `kind: 'refused', reason: 'no_customer'` fires when the user has
 * never had a Stripe customer (i.e. has never opened Checkout).
 * Sending them to the empty Portal would be confusing — we 303 to
 * /pricing instead, where the upgrade CTAs live.
 *
 * INPUT
 * -----
 * Optional `return_path` form field overrides the default return URL
 * (`/account`). The override is path-only (no protocol/host) and is
 * sanitized via `safeRedirectPath` to prevent open-redirect through
 * the Stripe round-trip. Anything that doesn't pass falls back to
 * `/account`.
 */
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPortalSession } from '$lib/server/billing/portal';
import { safeRedirectPath } from '$lib/utils/safe-redirect';

export const POST: RequestHandler = async ({ request, url, locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();

	if (!user) {
		// Send them through sign-in and bring them back to /account
		// where the "Manage billing" button lives.
		redirect(303, `/sign-in?next=${encodeURIComponent('/account')}`);
	}

	let returnPath: string | undefined;
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		const body = (await request.json().catch(() => null)) as { return_path?: unknown } | null;
		const raw = typeof body?.return_path === 'string' ? body.return_path : undefined;
		returnPath = raw ? safeRedirectPath(raw, '/account') : undefined;
	} else {
		const form = await request.formData();
		const raw = form.get('return_path');
		returnPath = typeof raw === 'string' ? safeRedirectPath(raw, '/account') : undefined;
	}

	try {
		const result = await createPortalSession({
			user: { id: user.id },
			origin: url.origin,
			returnPath
		});

		if (result.kind === 'refused') {
			redirect(303, '/pricing?portal=no-customer');
		}

		redirect(303, result.url);
	} catch (err) {
		// Re-throw SvelteKit's redirect sentinel — same logic as
		// /api/billing/checkout. See that file for rationale.
		if (err instanceof Response) throw err;
		if (
			typeof err === 'object' &&
			err !== null &&
			'status' in err &&
			'location' in err &&
			typeof (err as { status: unknown }).status === 'number'
		) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'unknown portal error';
		console.error('[portal] session creation failed', {
			user_id: user.id,
			error: message
		});
		return new Response('Could not open billing portal. Please try again.', { status: 502 });
	}
};
