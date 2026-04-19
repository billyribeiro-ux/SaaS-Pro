/**
 * POST /api/billing/checkout — create a Stripe Checkout Session for
 * the authenticated user and 303 them to the hosted page.
 *
 * Lives under `/api/...` to make the side-effect-only contract
 * explicit: this route has no GET, no rendered HTML, and ALWAYS
 * either redirects (303) or refuses (4xx/5xx). Any caller — the
 * pricing page CTA, the contacts cap banner, the account page
 * Upgrade button — submits a plain HTML `<form>` to this endpoint
 * and the browser follows the redirect.
 *
 * SECURITY
 * --------
 *   1. **Auth.** `safeGetSession()` validates the JWT against
 *      `auth.users` (NOT just the cookie) — see hooks.server.ts.
 *      Anonymous POSTs get 303'd to `/sign-in?next=/pricing` so
 *      the user authenticates and can retry; we deliberately do
 *      NOT 401 because the natural caller is a logged-out visitor
 *      clicking "Upgrade" on /pricing.
 *
 *   2. **CSRF.** SvelteKit's built-in `csrf.checkOrigin` rejects
 *      cross-origin POSTs before this handler runs. No additional
 *      check needed at the application layer.
 *
 *   3. **Input narrowing.** `lookup_key` is parsed against the
 *      typed `LookupKey` union (Lesson 5.6). Anything else returns
 *      400 — never trust a form field to be a price id.
 *
 *   4. **Idempotency-shaped URL.** Two double-submitted clicks
 *      land on the SAME hosted Checkout URL because the Stripe
 *      Idempotency-Key inside `createSubscriptionCheckoutSession`
 *      is keyed by `(user, lookup_key, day)`.
 *
 * ON REFUSAL
 * ----------
 * `kind: 'refused', reason: 'already_subscribed'` is what fires when
 * the user already has a `trialing | active | past_due` subscription.
 * We send them to `/account?upgrade=needs-portal` so the (Lesson 9.3)
 * "Manage billing" button can take it from there.
 *
 * ON ERROR
 * --------
 * Stripe-API failures are caught at the outer try and returned as a
 * 502 with a generic message; the structured log carries the cause.
 * We do NOT leak Stripe error strings to the network.
 */
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isLookupKey } from '$lib/billing/lookup-keys';
import { createSubscriptionCheckoutSession } from '$lib/server/billing/checkout';

export const POST: RequestHandler = async ({ request, url, locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();

	if (!user) {
		// Bounce through sign-in and come back to /pricing — the
		// natural retry surface. Encoding `next` here means the user
		// keeps the lookup_key intent: they re-click after sign-in.
		redirect(303, `/sign-in?next=${encodeURIComponent('/pricing')}`);
	}

	let lookupKey: string | null;
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		const body = (await request.json().catch(() => null)) as { lookup_key?: unknown } | null;
		lookupKey = typeof body?.lookup_key === 'string' ? body.lookup_key : null;
	} else {
		const form = await request.formData();
		const raw = form.get('lookup_key');
		lookupKey = typeof raw === 'string' ? raw : null;
	}

	if (!lookupKey || !isLookupKey(lookupKey)) {
		// Bad/unknown lookup key. Either the form was tampered with or
		// our marketing page is rendering a stale price. Generic 400 to
		// the network; the structured log has the bad value.
		console.warn('[checkout] invalid lookup_key', {
			user_id: user.id,
			lookup_key: lookupKey
		});
		return new Response('Unknown plan', { status: 400 });
	}

	try {
		const result = await createSubscriptionCheckoutSession({
			user: { id: user.id, email: user.email ?? null },
			lookupKey,
			origin: url.origin
		});

		if (result.kind === 'refused') {
			// Already subscribed — push to the account page where the
			// Billing Portal button (Lesson 9.3) handles the upgrade.
			redirect(303, '/account?upgrade=needs-portal');
		}

		// Hosted Checkout. Browser follows the 303 to Stripe.
		redirect(303, result.url);
	} catch (err) {
		// Important: SvelteKit `redirect()` throws a special non-Error
		// object that we MUST re-throw, otherwise we'd swallow our own
		// happy-path redirect and turn it into a 502.
		if (err instanceof Response) throw err;
		// `redirect()` throws a `Redirect` object; check by shape.
		if (
			typeof err === 'object' &&
			err !== null &&
			'status' in err &&
			'location' in err &&
			typeof (err as { status: unknown }).status === 'number'
		) {
			throw err;
		}

		const message = err instanceof Error ? err.message : 'unknown checkout error';
		console.error('[checkout] session creation failed', {
			user_id: user.id,
			lookup_key: lookupKey,
			error: message
		});
		return new Response('Could not start checkout. Please try again.', { status: 502 });
	}
};
