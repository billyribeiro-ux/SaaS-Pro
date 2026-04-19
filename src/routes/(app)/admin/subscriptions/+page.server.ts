import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';
import { requireAdmin } from '$server/admin';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireAdmin(locals);
	const status = url.searchParams.get('status');
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') | 0);
	const from = (page - 1) * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;

	let query = supabaseAdmin
		.from('subscriptions')
		.select(
			'id, user_id, status, price_id, current_period_start, current_period_end, cancel_at_period_end, trial_end, prices(lookup_key, unit_amount, currency)',
			{ count: 'exact' }
		)
		.order('current_period_end', { ascending: false })
		.range(from, to);

	if (status) query = query.eq('status', status);

	const { data, count } = await query;

	const userIds = Array.from(new Set((data ?? []).map((s) => s.user_id)));
	const profilesRes = userIds.length
		? await supabaseAdmin.from('profiles').select('id, email, full_name').in('id', userIds)
		: { data: [] as Array<{ id: string; email: string; full_name: string | null }> };
	const profileById = new Map((profilesRes.data ?? []).map((p) => [p.id, p] as const));

	return {
		subscriptions: (data ?? []).map((s) => ({
			...s,
			profile: profileById.get(s.user_id) ?? null
		})),
		total: count ?? 0,
		page,
		pageSize: PAGE_SIZE,
		status: status ?? ''
	};
};
