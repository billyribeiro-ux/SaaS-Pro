/**
 * Client hooks (Module 10.2) — Sentry browser SDK + `handleError`.
 *
 * What this file does:
 *
 *  1. Initialises Sentry's browser SDK with the shared base config
 *     (DSN, release, environment, sample rate).
 *  2. Wires `handleErrorWithSentry` so every uncaught client-side
 *     error reaches Sentry with the canonical SvelteKit context
 *     (route, params, status code).
 *  3. Wraps the user-facing return so the page receives back a
 *     stable `eventId` shape — `+error.svelte` can show "Reference
 *     id: …" to the user, and support can grep Sentry by that id.
 *
 * What it deliberately does NOT do:
 *
 *  - Capture Web Vitals / performance traces beyond Sentry's
 *    defaults. That's Module 11+; the SDK already ships sensible
 *    instrumentation out of the box and we're not paying the bytes
 *    for tweaks until we have a real reason.
 *
 *  - Fall back to `console.error` when `handleError` runs. Sentry's
 *    SDK already prints a dev-mode warning when an error is reported
 *    *and* re-throws into the console for SvelteKit's default
 *    rendering. Adding our own `console.error` would just produce a
 *    second stack trace.
 */
import { handleErrorWithSentry, init as sentryInit } from '@sentry/sveltekit';
import { publicEnv } from '$lib/env.public';
import { baseInitOptions } from '$lib/sentry-shared';

sentryInit({
	...baseInitOptions(publicEnv.PUBLIC_SENTRY_DSN ?? '')
});

/**
 * `handleErrorWithSentry` returns a SvelteKit `HandleClientError`
 * that captures + reports the error, then delegates to our optional
 * inner handler for any extra wiring (extra tags, return-shape
 * override, etc.). We don't need anything beyond the defaults today
 * — the inner handler stays a one-liner that returns the Sentry
 * `eventId` so `+error.svelte` can surface it.
 */
export const handleError = handleErrorWithSentry();
