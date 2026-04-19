import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({ email: url.searchParams.get('email') ?? '' });
