/**
 * GET /api/version — what's running, right now.
 *
 * Module 11.3. A no-secrets, no-auth-required endpoint that
 * returns the same release identifier the runtime SDK and the
 * source-map plugin both use. Two readers in mind:
 *
 *   1. Operators triaging an alert — quick answer to "what
 *      commit is on production right now?", without needing
 *      the Vercel dashboard or git log.
 *   2. Smoke-test scripts after a deploy — assert that the
 *      deployed release matches the SHA the CI runner just
 *      pushed. Mismatch = the deploy is partial / a CDN is
 *      stale / cache is sticking.
 *
 * The `release` and `commit` fields are *non-secret by design*:
 *
 *   - `release` is already on every error event in Sentry; if
 *     someone wanted it badly enough they'd grab it from the
 *     `<meta>` tag the SDK injects.
 *   - `commit` is the SHA of the deployed code, which is public
 *     in any open-source repo and disclosed in the JS bundle's
 *     fingerprinted asset URLs anyway.
 *
 * `branch` is *only* exposed in non-production environments to
 * avoid leaking internal feature names from preview deploys
 * into production response bodies.
 *
 * `Cache-Control: no-store` because the value can change on
 * every deploy. Even a 60-second CDN cache turns "is the new
 * code live?" into a guessing game.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import {
	resolveCommitBranch,
	resolveCommitSha,
	resolveEnvironment,
	resolveRelease
} from '$lib/release';

export const GET: RequestHandler = () => {
	const environment = resolveEnvironment();
	const branch = environment === 'production' ? null : resolveCommitBranch();

	return json(
		{
			service: 'contactly',
			release: resolveRelease(),
			commit: resolveCommitSha(),
			environment,
			branch,
			now: new Date().toISOString()
		},
		{
			headers: { 'cache-control': 'no-store' }
		}
	);
};
