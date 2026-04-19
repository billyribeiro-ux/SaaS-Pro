import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Dev-only sanity check: `locals.supabase` + anon key can reach Postgres
 * (via public `products` RLS). Returns 404 in production builds.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!dev) {
		throw error(404, 'Not found');
	}

	const productsRes = await locals.supabase.from('products').select('id, name, active').limit(5);

	return {
		dbOk: !productsRes.error,
		dbError: productsRes.error?.message ?? null,
		products: productsRes.data ?? [],
		user: locals.user
			? { id: locals.user.id, email: locals.user.email ?? null }
			: null
	};
};
