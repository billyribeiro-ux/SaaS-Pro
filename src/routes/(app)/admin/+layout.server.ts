import type { LayoutServerLoad } from './$types';
import { requireAdmin } from '$server/admin';

// Hard guard for the entire /admin section. Inherits the (app) layout's auth
// redirect for anonymous users; this layer adds the role check on top.
export const load: LayoutServerLoad = async ({ locals }) => {
	const admin = await requireAdmin(locals);
	return { admin: { id: admin.id, email: admin.email ?? null } };
};
