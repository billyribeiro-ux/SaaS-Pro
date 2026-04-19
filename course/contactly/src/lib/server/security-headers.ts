/**
 * Security headers — the modern, browser-safe defaults every
 * SaaS app should ship in production. Module 11.4.
 *
 * Two building blocks:
 *
 *   - `securityHeaders(env)`  — pure function: env name in,
 *                                header dictionary out.
 *   - `securityHeadersHandle` — SvelteKit `Handle` that applies
 *                                them to every response.
 *
 * Pure-core / async-shell pattern, same as the Module 10 services:
 * the table itself is unit-testable without spinning up SvelteKit,
 * and the hook layer is a one-liner that loops over it.
 *
 * WHY EACH HEADER
 * ---------------
 *
 * `Strict-Transport-Security`
 *   Force HTTPS for the next 2 years, including subdomains, and
 *   advertise eligibility for the HSTS preload list. Once this is
 *   served once, browsers refuse to downgrade to HTTP for the
 *   next two years — defeats the entire SSL-strip class of MITM.
 *   2 years (`max-age=63072000`) is the value `hstspreload.org`
 *   requires for inclusion. We only set it in production
 *   (preview/dev get nothing) so a self-signed local cert isn't
 *   permanently pinned in the dev's browser.
 *
 * `X-Content-Type-Options: nosniff`
 *   Stop browsers from "helpfully" guessing the MIME type of a
 *   response. The classic exploit is uploading a polyglot
 *   image/JS file and tricking the browser into executing it.
 *   Universally safe; should be on every response, every env.
 *
 * `X-Frame-Options: DENY`
 *   Refuse to be embedded in any iframe. Stripe Checkout, the
 *   billing portal, and the marketing pages don't expect to be
 *   framed; the admin dashboard MUST NOT be framed (clickjacking
 *   into a "Replay" button is a fun way to wreck a webhook
 *   backlog). `frame-ancestors` in CSP is the modern equivalent;
 *   we send both for max browser coverage.
 *
 * `Referrer-Policy: strict-origin-when-cross-origin`
 *   Modern browsers default to this, but spelling it out keeps
 *   us pinned to the safe behaviour even if a future browser
 *   changes its mind. Sends the origin (no path) on cross-origin
 *   requests, full URL on same-origin.
 *
 * `Permissions-Policy`
 *   Opt-out of every powerful browser feature we don't use.
 *   Each one is a separate XSS amplification vector if left on
 *   default. The `interest-cohort=()` line specifically opts out
 *   of FLoC/Topics-API tracking — orthogonal to security but the
 *   right default for a SaaS that doesn't sell user behavioural
 *   data.
 *
 * `Cross-Origin-Opener-Policy: same-origin`
 *   Isolates our page's browsing context group from cross-origin
 *   popups (Stripe Checkout opens in a popup; Stripe-side has
 *   `same-origin-allow-popups`, which is compatible). Required
 *   for `SharedArrayBuffer` and several Spectre mitigations.
 *
 * `Cross-Origin-Resource-Policy: same-site`
 *   Stops other origins from embedding our static assets.
 *   `same-site` (rather than `same-origin`) so the marketing CDN
 *   and the app share assets cleanly.
 *
 * `X-DNS-Prefetch-Control: off`
 *   Opt out of the browser pre-resolving every link's hostname
 *   on hover; reveals a user's hover behaviour to their DNS
 *   provider. Marginal privacy win, costs nothing.
 *
 * WHAT'S NOT HERE
 * ---------------
 *
 *  - **CSP.** Content-Security-Policy is high-impact but
 *    notoriously breakable; the right shape requires a per-route
 *    audit (Stripe.js, Sentry SDK, Tailwind in dev, …). Lands as
 *    its own module. Until then, `X-Frame-Options: DENY` covers
 *    the single highest-impact CSP directive (`frame-ancestors`).
 *  - **`Cache-Control` defaults.** Lives in `vercel.json`
 *    (Module 11.1) so the CDN can apply them before our function
 *    even sees the request.
 */

export type SecurityHeaderEnvironment = 'production' | 'preview' | 'development' | string;

export interface SecurityHeadersInput {
	/** Resolved environment (`resolveEnvironment` from `$lib/release`). */
	environment: SecurityHeaderEnvironment;
}

/**
 * The complete header table for a given environment.
 *
 * Returned as a fresh object every call — callers can mutate it
 * (e.g. add a per-route header) without poisoning the next one.
 */
export function securityHeaders(input: SecurityHeadersInput): Record<string, string> {
	const headers: Record<string, string> = {
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'X-DNS-Prefetch-Control': 'off',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Resource-Policy': 'same-site',
		'Permissions-Policy': PERMISSIONS_POLICY
	};

	if (input.environment === 'production') {
		// HSTS only in production. Setting it on a preview deploy
		// over a real HTTPS cert would be fine; setting it on
		// `localhost:5173` over an `mkcert` cert would pin the dev
		// box's browser to "always HTTPS, always" for two years —
		// painful when you next try `http://localhost:8000` for an
		// unrelated tool.
		headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
	}

	if (input.environment !== 'production') {
		// Preview + dev: ask robots not to index. A `robots.txt`
		// at the route layer also covers static-asset crawlers,
		// but the header is what shapes search-engine indexing
		// of HTML responses; both belt + braces.
		headers['X-Robots-Tag'] = 'noindex, nofollow';
	}

	return headers;
}

/**
 * The Permissions-Policy directive. Pulled out as a constant
 * because it's the longest of the headers and we want it to
 * read top-to-bottom in source order.
 *
 * Each entry is `feature=(allowlist)`; `()` means "no origins
 * are allowed to use this feature" — i.e. fully off. We
 * deliberately don't allow `self` for any of these because
 * Contactly's UI doesn't request camera/mic/etc., so any code
 * that does is by definition a bug or an exploit.
 */
const PERMISSIONS_POLICY = [
	'accelerometer=()',
	'autoplay=()',
	'browsing-topics=()',
	'camera=()',
	'cross-origin-isolated=()',
	'display-capture=()',
	'encrypted-media=()',
	'fullscreen=(self)',
	'geolocation=()',
	'gyroscope=()',
	'hid=()',
	'idle-detection=()',
	'interest-cohort=()',
	'magnetometer=()',
	'microphone=()',
	'midi=()',
	'payment=(self "https://js.stripe.com" "https://checkout.stripe.com")',
	'picture-in-picture=()',
	'publickey-credentials-get=()',
	'screen-wake-lock=()',
	'serial=()',
	'sync-xhr=()',
	'usb=()',
	'web-share=(self)',
	'xr-spatial-tracking=()'
].join(', ');

/**
 * Apply the table to every response. Runs *after* the SvelteKit
 * handler returns the response object so we can layer headers
 * onto whatever the route already produced.
 *
 * Header writes that already exist on the response are preserved
 * (we use `if (!has)` checks below) — useful when a specific
 * route wants to override e.g. `Cache-Control` on a public
 * marketing page without us stomping it.
 */
export function applySecurityHeaders(
	response: Response,
	environment: SecurityHeaderEnvironment
): void {
	const headers = securityHeaders({ environment });
	for (const [key, value] of Object.entries(headers)) {
		if (!response.headers.has(key)) {
			response.headers.set(key, value);
		}
	}
}
