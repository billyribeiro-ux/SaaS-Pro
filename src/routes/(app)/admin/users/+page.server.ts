import { fail } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { supabaseAdmin } from '$server/supabase';
import { requireAdmin, setUserRole, grantEntitlement, revokeEntitlement } from '$server/admin';
import { PRICING_LOOKUP_KEYS } from '$config/pricing.config';

const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireAdmin(locals);

	const q = (url.searchParams.get('q') ?? '').trim();
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') | 0);
	const from = (page - 1) * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;

	let profilesQuery = supabaseAdmin
		.from('profiles')
		.select('id, email, full_name, role, created_at', { count: 'exact' })
		.order('created_at', { ascending: false })
		.range(from, to);

	if (q) {
		// Single ilike on email/full_name. Postgres uses lower-case ILIKE under
		// the hood; pattern is wrapped in % so partial matches work.
		profilesQuery = profilesQuery.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
	}

	const { data: profiles, count } = await profilesQuery;

	const ids = (profiles ?? []).map((p) => p.id);
	const [subsRes, entitlementsRes] = await Promise.all([
		ids.length === 0
			? Promise.resolve({
					data: [] as Array<{ user_id: string; status: string; price_id: string | null }>
				})
			: supabaseAdmin.from('subscriptions').select('user_id, status, price_id').in('user_id', ids),
		ids.length === 0
			? Promise.resolve({
					data: [] as Array<{
						id: string;
						user_id: string;
						tier: string;
						reason: string;
						granted_at: string;
						expires_at: string | null;
						revoked_at: string | null;
					}>
				})
			: supabaseAdmin
					.from('entitlements')
					.select('id, user_id, tier, reason, granted_at, expires_at, revoked_at')
					.in('user_id', ids)
					.is('revoked_at', null)
	]);

	const subsByUser = new Map<string, Array<{ status: string; price_id: string | null }>>();
	for (const s of subsRes.data ?? []) {
		const list = subsByUser.get(s.user_id) ?? [];
		list.push({ status: s.status, price_id: s.price_id });
		subsByUser.set(s.user_id, list);
	}

	const entByUser = new Map<
		string,
		Array<{
			id: string;
			tier: string;
			reason: string;
			granted_at: string;
			expires_at: string | null;
		}>
	>();
	for (const e of entitlementsRes.data ?? []) {
		const list = entByUser.get(e.user_id) ?? [];
		list.push({
			id: e.id,
			tier: e.tier,
			reason: e.reason,
			granted_at: e.granted_at,
			expires_at: e.expires_at
		});
		entByUser.set(e.user_id, list);
	}

	return {
		users: (profiles ?? []).map((p) => ({
			...p,
			subscriptions: subsByUser.get(p.id) ?? [],
			entitlements: entByUser.get(p.id) ?? []
		})),
		total: count ?? 0,
		page,
		pageSize: PAGE_SIZE,
		q
	};
};

const setRoleSchema = z.object({
	userId: z.string().uuid(),
	role: z.enum(['user', 'admin'])
});

const grantSchema = z.object({
	userId: z.string().uuid(),
	tier: z.enum([
		PRICING_LOOKUP_KEYS.monthly,
		PRICING_LOOKUP_KEYS.yearly,
		PRICING_LOOKUP_KEYS.lifetime
	] as unknown as ['saas_pro_monthly', 'saas_pro_yearly', 'saas_pro_lifetime']),
	reason: z.string().min(1).max(500),
	expiresAt: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? new Date(v).toISOString() : null))
});

const revokeSchema = z.object({
	userId: z.string().uuid(),
	entitlementId: z.string().uuid()
});

// We accept the full Stripe lookup key string in `tier` for ergonomics in the
// form; map back to the abstract tier name we store in `entitlements.tier`.
function lookupKeyToTier(lookupKey: string): 'monthly' | 'yearly' | 'lifetime' {
	if (lookupKey === PRICING_LOOKUP_KEYS.monthly) return 'monthly';
	if (lookupKey === PRICING_LOOKUP_KEYS.yearly) return 'yearly';
	return 'lifetime';
}

export const actions: Actions = {
	setRole: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const parsed = setRoleSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid input' });
		if (parsed.data.userId === admin.id && parsed.data.role !== 'admin') {
			return fail(400, { error: "You can't demote yourself." });
		}
		await setUserRole({
			actorId: admin.id,
			targetUserId: parsed.data.userId,
			role: parsed.data.role
		});
		return { success: true as const, action: 'setRole' as const };
	},

	grant: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const parsed = grantSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid input' });
		await grantEntitlement({
			actorId: admin.id,
			targetUserId: parsed.data.userId,
			tier: lookupKeyToTier(parsed.data.tier),
			reason: parsed.data.reason,
			expiresAt: parsed.data.expiresAt
		});
		return { success: true as const, action: 'grant' as const };
	},

	revoke: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const parsed = revokeSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid input' });
		await revokeEntitlement({
			actorId: admin.id,
			entitlementId: parsed.data.entitlementId,
			targetUserId: parsed.data.userId
		});
		return { success: true as const, action: 'revoke' as const };
	}
};
