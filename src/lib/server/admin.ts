import { error, redirect } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$server/supabase';
import type { Database, Json } from '$types/database.types';
import type { PricingTier } from '$config/pricing.config';

// Server-only admin module. Two layers cooperate to decide "is this user an
// admin": the row in `public.profiles.role` (the source of truth), and the
// `ADMIN_EMAILS` env-allowlist (a recovery hatch that promotes a matching
// email on next sign-up via the `handle_new_user` trigger). The runtime
// helpers below check the DB, never the env, so revoking is a single UPDATE.

export type AdminProfile = Database['public']['Tables']['profiles']['Row'];

export function getAdminEmails(): string[] {
	const raw = env.ADMIN_EMAILS ?? '';
	return raw
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

// Fast path used in layouts to decide whether to render admin chrome. Caches
// per-request via a WeakMap keyed by the User object (the same object lives
// for the lifetime of one request inside `locals.user`).
const adminCheckCache = new WeakMap<User, Promise<boolean>>();

export function isAdmin(user: User | null | undefined): Promise<boolean> {
	if (!user) return Promise.resolve(false);
	const cached = adminCheckCache.get(user);
	if (cached) return cached;

	const promise = (async () => {
		const { data, error: dbError } = await supabaseAdmin
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.maybeSingle();
		if (dbError) {
			console.error('[admin] role lookup failed:', dbError.message);
			return false;
		}
		return data?.role === 'admin';
	})();

	adminCheckCache.set(user, promise);
	return promise;
}

// Hard guard: throws redirect to /login if anonymous, 403 if logged-in but
// not admin. Use at the top of admin route loaders / actions.
export async function requireAdmin(locals: App.Locals): Promise<User> {
	if (!locals.user) throw redirect(303, '/login?next=/admin');
	const ok = await isAdmin(locals.user);
	if (!ok) throw error(403, 'Admin access required');
	return locals.user;
}

// Audit. Intentionally swallow errors here — the action that triggered the
// log line should not fail because the audit insert had a transient hiccup.
// The DB has indexes on (created_at desc, target_user_id) for ops queries.
export async function logAdminAction(input: {
	actorId: string;
	action: string;
	targetUserId?: string | null;
	metadata?: Record<string, unknown>;
}): Promise<void> {
	try {
		const { error: insertError } = await supabaseAdmin.from('admin_audit_log').insert({
			actor_id: input.actorId,
			action: input.action,
			target_user_id: input.targetUserId ?? null,
			metadata: (input.metadata ?? null) as Json | null
		});
		if (insertError) {
			console.warn('[admin] audit insert failed:', insertError.message);
		}
	} catch (err) {
		console.warn('[admin] audit insert threw:', err);
	}
}

// Role mutations -------------------------------------------------------------
export async function setUserRole(input: {
	actorId: string;
	targetUserId: string;
	role: 'user' | 'admin';
}): Promise<void> {
	const { error: dbError } = await supabaseAdmin
		.from('profiles')
		.update({ role: input.role })
		.eq('id', input.targetUserId);
	if (dbError) {
		throw new Error(`[admin] setUserRole failed: ${dbError.message}`);
	}
	await logAdminAction({
		actorId: input.actorId,
		action: input.role === 'admin' ? 'role.grant_admin' : 'role.revoke_admin',
		targetUserId: input.targetUserId
	});
}

// Entitlement mutations ------------------------------------------------------
export async function grantEntitlement(input: {
	actorId: string;
	targetUserId: string;
	tier: PricingTier;
	reason: string;
	expiresAt?: string | null;
}): Promise<void> {
	const { error: dbError } = await supabaseAdmin.from('entitlements').insert({
		user_id: input.targetUserId,
		tier: input.tier,
		reason: input.reason,
		granted_by: input.actorId,
		expires_at: input.expiresAt ?? null
	});
	if (dbError) {
		throw new Error(`[admin] grantEntitlement failed: ${dbError.message}`);
	}
	await logAdminAction({
		actorId: input.actorId,
		action: 'entitlement.grant',
		targetUserId: input.targetUserId,
		metadata: { tier: input.tier, reason: input.reason, expires_at: input.expiresAt ?? null }
	});
}

export async function revokeEntitlement(input: {
	actorId: string;
	entitlementId: string;
	targetUserId: string;
}): Promise<void> {
	const { error: dbError } = await supabaseAdmin
		.from('entitlements')
		.update({ revoked_at: new Date().toISOString() })
		.eq('id', input.entitlementId)
		.is('revoked_at', null);
	if (dbError) {
		throw new Error(`[admin] revokeEntitlement failed: ${dbError.message}`);
	}
	await logAdminAction({
		actorId: input.actorId,
		action: 'entitlement.revoke',
		targetUserId: input.targetUserId,
		metadata: { entitlement_id: input.entitlementId }
	});
}

// Active-entitlement read used by the access layer.
export async function getActiveEntitlementTier(userId: string): Promise<PricingTier | null> {
	const nowIso = new Date().toISOString();
	const { data, error: dbError } = await supabaseAdmin
		.from('entitlements')
		.select('tier, expires_at')
		.eq('user_id', userId)
		.is('revoked_at', null)
		.order('granted_at', { ascending: false });
	if (dbError) {
		console.error('[admin] entitlement lookup failed:', dbError.message);
		return null;
	}
	for (const row of data ?? []) {
		if (!row.expires_at || row.expires_at > nowIso) {
			return row.tier as PricingTier;
		}
	}
	return null;
}
