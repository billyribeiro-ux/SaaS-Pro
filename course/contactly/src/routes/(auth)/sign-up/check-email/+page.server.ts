import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	// `email` is set by the sign-up redirect. We display it back to the
	// user ("We sent a link to alice@example.com") so they can verify
	// the address they just typed and check the right inbox.
	//
	// Defensive: if someone visits this URL directly without `?email=`,
	// we render a generic message instead of crashing or showing
	// `undefined`.
	const email = url.searchParams.get('email');
	return { email };
};
