import { fail } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { stripe } from '$server/stripe';
import { requireAdmin, logAdminAction } from '$server/admin';

// Coupons live in Stripe (source of truth). The admin UI lists the most
// recent coupons + promotion codes and lets you mint either with one click.
// We never persist them locally — Stripe is the system of record.
export const load: PageServerLoad = async ({ locals }) => {
	await requireAdmin(locals);

	const [coupons, promos] = await Promise.all([
		stripe.coupons.list({ limit: 25 }),
		stripe.promotionCodes.list({ limit: 25 })
	]);

	return {
		coupons: coupons.data.map((c) => ({
			id: c.id,
			name: c.name,
			percent_off: c.percent_off,
			amount_off: c.amount_off,
			currency: c.currency,
			duration: c.duration,
			duration_in_months: c.duration_in_months,
			redeem_by: c.redeem_by,
			times_redeemed: c.times_redeemed,
			max_redemptions: c.max_redemptions,
			valid: c.valid,
			created: c.created
		})),
		promotionCodes: promos.data.map((p) => {
			// Stripe dahlia (2026-03-25) wraps the underlying coupon in a `promotion`
			// envelope — `p.promotion.coupon` is `string | Coupon | null`.
			const couponRef = p.promotion?.coupon;
			const couponId = typeof couponRef === 'string' ? couponRef : (couponRef?.id ?? null);
			return {
				id: p.id,
				code: p.code,
				active: p.active,
				coupon_id: couponId,
				max_redemptions: p.max_redemptions,
				times_redeemed: p.times_redeemed,
				expires_at: p.expires_at,
				created: p.created
			};
		})
	};
};

const couponSchema = z
	.object({
		name: z.string().min(1).max(100).optional(),
		percentOff: z
			.string()
			.optional()
			.transform((v) => (v && v.length ? Number(v) : null)),
		amountOffCents: z
			.string()
			.optional()
			.transform((v) => (v && v.length ? Number(v) : null)),
		currency: z.string().min(3).max(3).optional().default('usd'),
		duration: z.enum(['once', 'forever', 'repeating']).default('once'),
		durationInMonths: z
			.string()
			.optional()
			.transform((v) => (v && v.length ? Number(v) : null)),
		maxRedemptions: z
			.string()
			.optional()
			.transform((v) => (v && v.length ? Number(v) : null))
	})
	.refine(
		(d) => (d.percentOff != null) !== (d.amountOffCents != null),
		'Provide exactly one of percentOff or amountOffCents'
	);

const promoSchema = z.object({
	couponId: z.string().min(1),
	code: z.string().min(3).max(40),
	maxRedemptions: z
		.string()
		.optional()
		.transform((v) => (v && v.length ? Number(v) : null))
});

export const actions: Actions = {
	createCoupon: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const parsed = couponSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues.map((i) => i.message).join('; ') });
		}
		const d = parsed.data;
		const coupon = await stripe.coupons.create({
			name: d.name,
			percent_off: d.percentOff ?? undefined,
			amount_off: d.amountOffCents ?? undefined,
			currency: d.amountOffCents != null ? d.currency : undefined,
			duration: d.duration,
			duration_in_months:
				d.duration === 'repeating' && d.durationInMonths ? d.durationInMonths : undefined,
			max_redemptions: d.maxRedemptions ?? undefined
		});
		await logAdminAction({
			actorId: admin.id,
			action: 'coupon.create',
			metadata: { coupon_id: coupon.id }
		});
		return { success: true as const, action: 'createCoupon' as const };
	},

	createPromotion: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const parsed = promoSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues.map((i) => i.message).join('; ') });
		}
		const promo = await stripe.promotionCodes.create({
			promotion: { type: 'coupon', coupon: parsed.data.couponId },
			code: parsed.data.code.toUpperCase(),
			max_redemptions: parsed.data.maxRedemptions ?? undefined
		});
		const couponRef = promo.promotion?.coupon;
		const promoCouponId = typeof couponRef === 'string' ? couponRef : (couponRef?.id ?? null);
		await logAdminAction({
			actorId: admin.id,
			action: 'promotion.create',
			metadata: { promo_id: promo.id, code: promo.code, coupon_id: promoCouponId }
		});
		return { success: true as const, action: 'createPromotion' as const };
	}
};
