# 11.4 — Security headers + preview-environment hardening

> **Module 11 — Production deploy & adapter swap.**
>
> Lesson 4 of 5. We layer the modern security-header table onto
> every response and harden preview deploys against accidental
> indexing.

## Why this is its own lesson

The Vercel adapter swap (11.1), source-map upload (11.2), and
release pin (11.3) all dealt with **what gets shipped**. This
lesson deals with **how the browser is told to handle what
ships** — the orthogonal half of "production-ready."

The headers in this table are individually small, collectively
the difference between an app that an OWASP scanner gives an A+
and one that gets flagged on every audit. None of them are new
inventions; the value of doing this lesson is **picking the right
defaults for a SaaS** rather than copy-pasting "all 12 headers"
from a static-site blog post.

## What changed

### Pure header table — `src/lib/server/security-headers.ts`

```ts
export function securityHeaders({ environment }: { environment: string }): Record<string, string>;
export function applySecurityHeaders(response: Response, environment: string): void;
```

Same pure-core / async-shell pattern as the Module 10 services:
the table is a pure function unit-tested in isolation, the hook
layer is a one-liner.

### `hooks.server.ts` — sequence wired in

```ts
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

`securityHeadersHandle` lives **last** so it sees the actual
outgoing response object — including 303 redirects, Supabase
auth-cookie cache busts, custom 503s from the webhook backlog.
Putting it earlier would mean `handleApp` or its child handlers
could short-circuit before the headers were applied.

### Dynamic `/robots.txt`

```ts
// src/routes/robots.txt/+server.ts
const PRODUCTION_BODY = '...allow marketing, disallow admin/api/account...';
const NON_PRODUCTION_BODY = 'User-agent: *\nDisallow: /\n';

export const GET = (): Response => {
	const body = resolveEnvironment() === 'production' ? PRODUCTION_BODY : NON_PRODUCTION_BODY;
	return new Response(body, { ... });
};
```

A static `static/robots.txt` would be served identically
everywhere — preview deploys at
`contactly-git-feature-billing-d3f.vercel.app` would be just as
crawlable as production. Two layers, same goal: the
`X-Robots-Tag: noindex, nofollow` header and the dynamic
`/robots.txt` both deny preview crawls.

## The header table, line by line

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

### `Permissions-Policy` highlights

Every powerful browser feature we don't use is set to `()` (no
origins allowed). Three exceptions where we explicitly allow:

- `fullscreen=(self)` — future "expand the contacts table to
  full screen" features.
- `web-share=(self)` — same; share a contact card from the app.
- `payment=(self "https://js.stripe.com" "https://checkout.stripe.com")`
  — Stripe Checkout uses the Payment Request API; locking it to
  Stripe's exact origins (rather than `*`) is the right
  least-privilege.

`browsing-topics=()` and `interest-cohort=()` opt out of
Google's cohort-based ad targeting. Orthogonal to security but
the right default for a SaaS that doesn't sell user behavioral
data.

### Why `same-origin` for COOP and `same-site` for CORP

- **COOP `same-origin`**: refuses to share a browsing context
  group with cross-origin popups. Stripe Checkout opens in a
  popup; their side runs `same-origin-allow-popups`, which is
  compatible with us being strict.
- **CORP `same-site`** (rather than `same-origin`): our
  marketing CDN and the app may share assets in the future. The
  `-site` boundary is enough to prevent unrelated origins from
  embedding our static assets but doesn't block our own
  subdomains.

### Why HSTS is **production only**

Setting `Strict-Transport-Security` from `localhost:5173` over
an `mkcert` cert would pin the developer's browser to "always
HTTPS, always" for two years. Painful when the same browser
later visits `http://localhost:8000` for an unrelated tool.

Setting it from a Vercel preview deploy is _harmless_ in
principle — Vercel preview URLs all serve real certs — but the
preview hostname rotates per branch, so the practical value is
zero. Limit it to production where the host is stable and the
cert is real.

## "No-stomp" semantics

`applySecurityHeaders` writes each header **only if the
response doesn't already have it**:

```ts
for (const [key, value] of Object.entries(headers)) {
	if (!response.headers.has(key)) {
		response.headers.set(key, value);
	}
}
```

A future route that needs to allow framing for an embedded UI
just sets `X-Frame-Options: ALLOW-FROM https://partner.example`
on the response itself, and the global hook leaves it alone.
Pin-defaults, allow-overrides — the same pattern as `cn()` from
the Tailwind utilities.

## Verification

### Headers are present on every route

```bash
curl -I http://localhost:5173/
# HTTP/1.1 200 OK
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Referrer-Policy: strict-origin-when-cross-origin
# X-DNS-Prefetch-Control: off
# Cross-Origin-Opener-Policy: same-origin
# Cross-Origin-Resource-Policy: same-site
# Permissions-Policy: accelerometer=(), ...
# X-Robots-Tag: noindex, nofollow         ← dev/preview only
```

### `robots.txt` reflects the environment

```bash
curl -s http://localhost:5173/robots.txt
# User-agent: *
# Disallow: /

# (production would emit the marketing-friendly version with the sitemap line)
```

### Unit suite pins the table

`pnpm run test:unit` runs 31 cases across `securityHeaders` +
`applySecurityHeaders` covering every transition in the matrix
above and the no-stomp behaviour. A regression — someone
disabling HSTS to fix a local cert and forgetting to restore
it — breaks the suite immediately.

## What's deliberately **not** here

- **Content-Security-Policy.** CSP is the highest-impact header
  on the list and the easiest to break. Doing it right requires
  per-route audit (Stripe.js, Sentry SDK loader, Tailwind in
  dev, the `<meta>` tag the Sentry SDK injects, …) plus a
  report-only rollout phase. Lands as its own module. The
  `X-Frame-Options: DENY` we ship now covers the single most
  important CSP directive (`frame-ancestors`).
- **HTTP Public Key Pinning.** Deprecated by every modern
  browser; CT-monitored CAs cover the threat. No.
- **Per-route header overrides.** The no-stomp semantics give
  individual routes the escape hatch; we'll wire the actual
  override callsites (admin → CSP relaxation for Stripe iframe,
  …) in the modules that need them.
- **A non-production sitemap.** Preview deploys publish a "no
  indexing" robots.txt; pointing at a sitemap nobody should be
  reading would just be confusing.

## Next

→ [11.5 — Production runbook + module-11 wrap doc](./05-runbook-and-wrap.md)
