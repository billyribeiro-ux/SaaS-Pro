/**
 * Validate a `next` query parameter as a safe, same-origin redirect path.
 *
 * Why this exists
 * ---------------
 * Every auth flow in the app accepts a `?next=...` query param so a user
 * who tried to view `/contacts/123` while logged out can be sent back
 * there after sign-in. That parameter is **untrusted user input** —
 * passed through email links, copy-pasted URLs, even the user's own
 * browser history. Trusting it verbatim is the textbook **open
 * redirect** vulnerability: an attacker sends
 *   `https://contactly.app/sign-in?next=https://evil.example.com`,
 * the user signs in, and our code happily redirects them off-site to a
 * phishing page that mimics our UI.
 *
 * Rules enforced here:
 *   1. Must be a string.
 *   2. Must start with a single `/`. Strings like `//evil.com/path` are
 *      protocol-relative URLs that the browser interprets as
 *      cross-origin — explicitly rejected.
 *   3. Must NOT contain `\` (some browsers normalize backslashes to
 *      forward slashes during navigation, which can sneak past a
 *      naive check).
 *   4. Must NOT start with `/\` (same reason).
 *
 * Anything that fails returns the `fallback` (default `/`).
 *
 * This helper is used by every redirect that consumes a user-supplied
 * `next` value: `/auth/confirm`, `(auth)/+layout.server.ts`,
 * `(app)/+layout.server.ts`, the sign-in form action, etc.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
	if (typeof next !== 'string' || next.length === 0) return fallback;
	if (!next.startsWith('/')) return fallback;
	// `//host/path` and `/\` are both browser-cross-origin attacks.
	if (next.startsWith('//') || next.startsWith('/\\')) return fallback;
	if (next.includes('\\')) return fallback;
	return next;
}
