/**
 * /pricing — public marketing page that lists the Contactly plan ladder.
 *
 * Single source of data: `listActivePlans()` (Module 7.2) reads every
 * active recurring price + its product from the local mirror tables.
 * That's then handed to `buildPricingCatalog` (Lesson 8.1) which
 * turns the rows into the typed view-model the template renders. The
 * page itself contains zero presentation math — see
 * `docs/billing/01-pricing-catalog.md` for the rationale.
 *
 * NO AUTH GUARD
 * -------------
 * `/pricing` is a marketing surface, NOT an `(app)` route. Visitors
 * who aren't signed in see "Sign up — it's free" CTAs; signed-in
 * visitors see "Go to dashboard". The page never reads the user's
 * tier — that decision belongs to the entitlements module
 * (Lesson 8.3) and surfaces inside `(app)`. Keeping the marketing
 * page tier-agnostic means it can be cached aggressively without
 * regard to who's looking.
 *
 * RESILIENCE: pricing page MUST render even if the DB hiccups
 * -----------------------------------------------------------
 * If `listActivePlans()` throws — e.g. transient Supabase outage —
 * we still render the four cards using the curated copy in
 * `STATIC_TIER_COPY` and a `loadError: true` flag. The visitor sees
 * the plan ladder + features + "Sign up" CTA; the only thing missing
 * is the dollar headlines. A blank pricing page costs revenue; a
 * "Pricing TBD" pricing page does not. The error is logged for
 * Sentry to pick up.
 *
 * NO PRERENDER
 * ------------
 * We deliberately skip `export const prerender = true`. The page is
 * data-driven and prices change in production via the webhook
 * stream, so the cached HTML would go stale silently. SSR + a CDN
 * Cache-Control header (revisit when the marketing site moves to its
 * own deployment in Module 12) is the right balance.
 */
import type { PageServerLoad } from './$types';
import { listActivePlans } from '$lib/server/billing/products';
import { buildPricingCatalog } from '$lib/billing/catalog';

export const load: PageServerLoad = async () => {
	try {
		const rows = await listActivePlans();
		return {
			cards: buildPricingCatalog(rows),
			loadError: false as const
		};
	} catch (err) {
		console.error('[pricing] failed to load plan catalog; rendering with empty rows', err);
		return {
			cards: buildPricingCatalog([]),
			loadError: true as const
		};
	}
};
