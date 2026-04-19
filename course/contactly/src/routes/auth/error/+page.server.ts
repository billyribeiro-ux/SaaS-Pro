import type { PageServerLoad } from './$types';
import { safeRedirectPath } from '$lib/utils/safe-redirect';

const REASONS: Record<string, string> = {
	missing_token: 'The link is missing required information.',
	invalid_type: 'The link is for an unsupported action.',
	verify_failed:
		'We could not confirm this link. It may have expired or already been used. ' +
		'Try signing in or requesting a new link.'
};

const DEFAULT_REASON = 'Something went wrong while processing your link.';

export const load: PageServerLoad = ({ url }) => {
	const reasonKey = url.searchParams.get('reason') ?? '';
	const message = REASONS[reasonKey] ?? DEFAULT_REASON;
	const next = safeRedirectPath(url.searchParams.get('next'), '/');
	return { message, next };
};
