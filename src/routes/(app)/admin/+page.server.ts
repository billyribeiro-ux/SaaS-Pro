import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';

// Single round-trip per metric using head-only `count: 'exact'`. We avoid
// pulling rows; we want O(1) numbers for the cards.
async function countWhere(
	table: 'profiles' | 'subscriptions' | 'entitlements' | 'stripe_events',
	apply?: (q: ReturnType<typeof supabaseAdmin.from>) => unknown
) {
	const base = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
	const final = apply ? (apply(base) as typeof base) : base;
	const { count, error } = await final;
	if (error) {
		console.error(`[admin/dashboard] count failed for ${table}:`, error.message);
		return 0;
	}
	return count ?? 0;
}

export const load: PageServerLoad = async () => {
	const [
		totalUsers,
		totalAdmins,
		activeSubs,
		trialingSubs,
		canceledSubs,
		activeEntitlements,
		webhookEvents,
		recentWebhooksRes,
		recentUsersRes,
		recentSubsRes,
		recentAuditRes
	] = await Promise.all([
		countWhere('profiles'),
		countWhere('profiles', (q) => q.eq('role', 'admin')),
		countWhere('subscriptions', (q) => q.eq('status', 'active')),
		countWhere('subscriptions', (q) => q.eq('status', 'trialing')),
		countWhere('subscriptions', (q) => q.eq('status', 'canceled')),
		countWhere('entitlements', (q) => q.is('revoked_at', null)),
		countWhere('stripe_events'),
		supabaseAdmin
			.from('stripe_events')
			.select('id, type, received_at')
			.order('received_at', { ascending: false })
			.limit(8),
		supabaseAdmin
			.from('profiles')
			.select('id, email, full_name, role, created_at')
			.order('created_at', { ascending: false })
			.limit(8),
		supabaseAdmin
			.from('subscriptions')
			.select('id, user_id, status, current_period_end, price_id')
			.order('current_period_end', { ascending: false })
			.limit(8),
		supabaseAdmin
			.from('admin_audit_log')
			.select('id, action, target_user_id, actor_id, metadata, created_at')
			.order('created_at', { ascending: false })
			.limit(8)
	]);

	return {
		stats: {
			totalUsers,
			totalAdmins,
			activeSubs,
			trialingSubs,
			canceledSubs,
			activeEntitlements,
			webhookEvents
		},
		recentWebhooks: recentWebhooksRes.data ?? [],
		recentUsers: recentUsersRes.data ?? [],
		recentSubs: recentSubsRes.data ?? [],
		recentAudit: recentAuditRes.data ?? []
	};
};
