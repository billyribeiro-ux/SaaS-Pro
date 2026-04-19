/**
 * GET /robots.txt — environment-aware crawler policy.
 *
 * Module 11.4. The contents change per environment:
 *
 *   - production : "crawl the marketing pages, stay out of /admin,
 *                   /api, /account, /sign-in, /contacts."
 *   - everywhere : "do not index this entire host."
 *
 * Why a route and not a static file?
 *
 *   A static `static/robots.txt` would be served identically on
 *   production and on every preview deploy — and preview URLs
 *   like `contactly-git-feature-billing-d3f.vercel.app` showing
 *   up in Google search results are exactly the kind of leak the
 *   `noindex` X-Robots-Tag header (set by the security-headers
 *   hook) is fighting. Two layers, same goal.
 *
 *   The dynamic route also lets us point at the canonical
 *   sitemap from the production response without making the
 *   preview file lie ("here's a sitemap that won't actually be
 *   indexed").
 *
 * `Content-Type: text/plain; charset=utf-8` because some
 * crawlers (Google's is forgiving, Bing's isn't) refuse to parse
 * a robots.txt served as `text/html` or with no charset.
 */
import { resolveEnvironment } from '$lib/release';

const PRODUCTION_BODY = `# Contactly robots policy
User-agent: *
Disallow: /admin
Disallow: /api
Disallow: /account
Disallow: /contacts
Disallow: /sign-in
Disallow: /sign-out
Disallow: /sign-up
Allow: /

Sitemap: https://contactly.app/sitemap.xml
`;

const NON_PRODUCTION_BODY = `# Contactly preview / dev — full disallow
User-agent: *
Disallow: /
`;

export const prerender = false;

export const GET = (): Response => {
	const body = resolveEnvironment() === 'production' ? PRODUCTION_BODY : NON_PRODUCTION_BODY;
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			// Crawlers honour Cache-Control on /robots.txt; an hour
			// is plenty (we're not pushing new versions per request)
			// and a stale copy after a deploy is harmless.
			'cache-control': 'public, max-age=3600'
		}
	});
};
