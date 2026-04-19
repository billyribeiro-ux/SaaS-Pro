---
title: 'Bonus: Security Headers — CSP, HSTS, COOP'
module: 14
lesson: 19
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-19-security-headers-csp'
description: 'Layer the modern security-header table onto every response — HSTS, COOP, CORP, Permissions-Policy, X-Frame-Options — with environment-aware rules so dev never pins HSTS and previews stay out of Google. Plus a roadmap to a real CSP.'
duration: 25
preview: false
---

# Bonus: Security headers — CSP, HSTS, COOP

The headers in this lesson are individually small, collectively the difference between a SaaS that an OWASP scanner gives an A+ and one that gets flagged on every audit. None of them are new inventions; the value of doing this lesson is **picking the right defaults for a SaaS app** rather than copy-pasting "all 12 headers" from a static-site blog post.

By the end of this lesson you will:

- Build a pure `securityHeaders({ environment })` table that returns the right header map for prod / preview / dev.
- Wire it into `hooks.server.ts` so every outgoing response carries the right headers.
- Use **no-stomp semantics** — the global hook only sets a header if the response doesn't already have it, so per-route overrides keep working.
- Limit `Strict-Transport-Security` to production (never pin HSTS from `localhost`).
- Serve a dynamic `/robots.txt` that disallows everything outside production.
- Understand why CSP is the most impactful header but the easiest to break, and the report-only rollout strategy.

## 1. The header table

```ts
// src/lib/server/security-headers.ts
const PERMISSIONS_POLICY = [
	'accelerometer=()',
	'autoplay=()',
	'browsing-topics=()',
	'camera=()',
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
	'publickey-credentials-get=(self)',
	'screen-wake-lock=()',
	'serial=()',
	'usb=()',
	'web-share=(self)',
	'xr-spatial-tracking=()'
].join(', ');

export function securityHeaders({ environment }: { environment: string }): Record<string, string> {
	const isProd = environment === 'production';
	const headers: Record<string, string> = {
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'X-DNS-Prefetch-Control': 'off',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Resource-Policy': 'same-site',
		'Permissions-Policy': PERMISSIONS_POLICY
	};
	if (isProd) {
		headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
	} else {
		headers['X-Robots-Tag'] = 'noindex, nofollow';
	}
	return headers;
}

export function applySecurityHeaders(response: Response, environment: string): void {
	const headers = securityHeaders({ environment });
	for (const [key, value] of Object.entries(headers)) {
		if (!response.headers.has(key)) {
			response.headers.set(key, value);
		}
	}
}
```

## 2. The header table, line by line

| Header                         | Production                                     | Preview             | Dev                 | Why                                                     |
| ------------------------------ | ---------------------------------------------- | ------------------- | ------------------- | ------------------------------------------------------- |
| `X-Content-Type-Options`       | `nosniff`                                      | same                | same                | Polyglot file → executable JS pivot defeated            |
| `X-Frame-Options`              | `DENY`                                         | same                | same                | Clickjacking on `?/replay`, sign-out                    |
| `Referrer-Policy`              | `strict-origin-when-cross-origin`              | same                | same                | No path leakage on outbound clicks                      |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                  | same                | same                | Spectre / window-handle isolation                       |
| `Cross-Origin-Resource-Policy` | `same-site`                                    | same                | same                | Stops `<img>` embedding of our static assets cross-site |
| `X-DNS-Prefetch-Control`       | `off`                                          | same                | same                | Hover ≠ user telling DNS provider what they hover over  |
| `Permissions-Policy`           | (long list — see below)                        | same                | same                | Opt out of every powerful API we don't use              |
| `Strict-Transport-Security`    | `max-age=63072000; includeSubDomains; preload` | _omitted_           | _omitted_           | 2-year HSTS, preload-eligible. **Production only.**     |
| `X-Robots-Tag`                 | _omitted_ (production should be indexed)       | `noindex, nofollow` | `noindex, nofollow` | Preview / dev URLs must never reach Google              |

## 3. Permissions-Policy highlights

Every powerful browser feature you don't use is set to `()` (no origins allowed). Three exceptions where you explicitly allow:

- `fullscreen=(self)` — for any "expand to full screen" features.
- `web-share=(self)` — sharing a contact card from the app.
- `payment=(self "https://js.stripe.com" "https://checkout.stripe.com")` — Stripe Checkout uses the Payment Request API; locking it to Stripe's exact origins (rather than `*`) is the right least-privilege.

`browsing-topics=()` and `interest-cohort=()` opt out of Google's cohort-based ad targeting. Orthogonal to security but the right default for a SaaS that doesn't sell user behavioural data.

## 4. Why same-origin for COOP and same-site for CORP

- **COOP `same-origin`** refuses to share a browsing context group with cross-origin popups. Stripe Checkout opens in a popup; their side runs `same-origin-allow-popups`, which is compatible with you being strict.
- **CORP `same-site`** (rather than `same-origin`) — your marketing CDN and the app may share assets in the future. The `-site` boundary is enough to prevent unrelated origins from embedding your static assets but doesn't block your own subdomains.

## 5. Why HSTS is production only

Setting `Strict-Transport-Security` from `localhost:5173` over an `mkcert` cert would pin the developer's browser to "always HTTPS, always" for two years. Painful when the same browser later visits `http://localhost:8000` for an unrelated tool.

Setting it from a Vercel preview deploy is _harmless_ in principle — preview URLs all serve real certs — but the preview hostname rotates per branch, so the practical value is zero. Limit it to production where the host is stable and the cert is real.

## 6. Wire it into hooks.server.ts

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { resolveEnvironment } from '$lib/release';
import { applySecurityHeaders } from '$lib/server/security-headers';

const ENVIRONMENT = resolveEnvironment();

const securityHeadersHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	applySecurityHeaders(response, ENVIRONMENT);
	return response;
};

export const handle: Handle = sequence(
	sentryHandle(), // outermost: must wrap the whole request
	handleApp, // auth + Supabase + structured logger
	securityHeadersHandle // outermost outgoing: layers headers onto the final response
);
```

`securityHeadersHandle` lives **last** in the sequence so it sees the actual outgoing response object — including 303 redirects, Supabase auth-cookie cache busts, custom 503s from the webhook backlog. Putting it earlier would mean another handler could short-circuit before the headers were applied.

## 7. No-stomp semantics

`applySecurityHeaders` writes each header **only if the response doesn't already have it**. A future route that needs to allow framing for an embedded UI just sets `X-Frame-Options: ALLOW-FROM https://partner.example` on the response itself, and the global hook leaves it alone.

Pin-defaults, allow-overrides — same pattern as `cn()` from the Tailwind utilities.

## 8. Dynamic robots.txt

A static `static/robots.txt` would be served identically everywhere — preview deploys at `contactly-git-feature-billing-d3f.vercel.app` would be just as crawlable as production. Two layers, same goal: the `X-Robots-Tag: noindex, nofollow` header **and** a dynamic `/robots.txt` both deny preview crawls.

`src/routes/robots.txt/+server.ts`:

```ts
import { resolveEnvironment } from '$lib/release';

const PRODUCTION = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /account/
Sitemap: https://contactly.io/sitemap.xml
`;

const NON_PRODUCTION = `User-agent: *
Disallow: /
`;

export const GET = (): Response => {
	const body = resolveEnvironment() === 'production' ? PRODUCTION : NON_PRODUCTION;
	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
```

## 9. Verification

```bash
curl -I http://localhost:5173/
# HTTP/1.1 200 OK
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Referrer-Policy: strict-origin-when-cross-origin
# X-DNS-Prefetch-Control: off
# Cross-Origin-Opener-Policy: same-origin
# Cross-Origin-Resource-Policy: same-site
# Permissions-Policy: accelerometer=(), …
# X-Robots-Tag: noindex, nofollow         ← dev/preview only

curl -s http://localhost:5173/robots.txt
# User-agent: *
# Disallow: /
```

Test the production header set with [securityheaders.com](https://securityheaders.com) once deployed. A+ is the goal.

## 10. The CSP roadmap

You'll notice **`Content-Security-Policy` is not in the table yet**. That's intentional. CSP is the highest-impact header on the list and the easiest to break. Doing it right requires per-route audit (Stripe.js loader, Sentry SDK loader, Tailwind in dev, the `<meta>` tag the Sentry SDK injects, the inline JSON SvelteKit emits for hydration) plus a report-only rollout phase.

The pragmatic path:

1. **Week 1:** ship `Content-Security-Policy-Report-Only: …` with a strict policy (`default-src 'self'`, allow-list for Stripe + Sentry). Wire `report-uri` to a Sentry endpoint. Watch the violation reports for a week.
2. **Week 2:** loosen the policy where real violations show up (Tailwind's inline styles in dev, etc.). Don't loosen for theoretical violations.
3. **Week 3:** flip from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.

Any other rollout sequence will break a real user flow within hours.

The `X-Frame-Options: DENY` you ship today covers the single most important CSP directive (`frame-ancestors`). That's enough for an A on securityheaders.com. The full A+ comes from the CSP rollout above.

## 11. Acceptance checklist

- [ ] `securityHeaders({ environment })` is a pure function with unit-test coverage.
- [ ] `applySecurityHeaders` uses no-stomp semantics.
- [ ] Hook is **last** in the `sequence(...)`.
- [ ] HSTS is production-only.
- [ ] `X-Robots-Tag: noindex` on preview/dev.
- [ ] `/robots.txt` body switches on environment.
- [ ] `curl -I` against a deployed page shows the full table.
- [ ] securityheaders.com gives at least an A.

## What's next

Bonus 20 closes the deploy track with **secret rotation without downtime** — how to roll a new `STRIPE_WEBHOOK_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` while traffic is in flight, with zero failed requests.
