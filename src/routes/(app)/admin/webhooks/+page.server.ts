import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';
import { requireAdmin } from '$server/admin';

const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireAdmin(locals);
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') | 0);
	const from = (page - 1) * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;
	const type = url.searchParams.get('type') ?? '';

	let query = supabaseAdmin
		.from('stripe_events')
		.select('id, type, received_at', { count: 'exact' })
		.order('received_at', { ascending: false })
		.range(from, to);

	if (type) query = query.eq('type', type);

	const { data, count } = await query;
	return {
		events: data ?? [],
		total: count ?? 0,
		page,
		pageSize: PAGE_SIZE,
		type
	};
};
