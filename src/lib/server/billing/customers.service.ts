import { stripe } from '$server/stripe';
import { supabaseAdmin } from '$server/supabase';

// Returns the Stripe customer ID for a profile, creating one if needed.
// Idempotent: safe to call on every checkout attempt.
export async function getOrCreateStripeCustomer(params: {
	userId: string;
	email: string;
	fullName?: string | null;
}): Promise<string> {
	const { userId, email, fullName } = params;

	const { data: existing, error: lookupError } = await supabaseAdmin
		.from('customers')
		.select('stripe_customer_id')
		.eq('id', userId)
		.maybeSingle();

	if (lookupError) {
		throw new Error(`[customers.service] lookup failed for ${userId}: ${lookupError.message}`);
	}
	if (existing?.stripe_customer_id) return existing.stripe_customer_id;

	const customer = await stripe.customers.create({
		email,
		name: fullName ?? undefined,
		metadata: { supabase_user_id: userId }
	});

	const { error: insertError } = await supabaseAdmin.from('customers').insert({
		id: userId,
		stripe_customer_id: customer.id
	});
	if (insertError) {
		// Roll back the Stripe customer so the next call can create cleanly.
		await stripe.customers.del(customer.id).catch(() => undefined);
		throw new Error(
			`[customers.service] insert failed for ${userId}: ${insertError.message}`
		);
	}

	return customer.id;
}

export async function findUserIdByStripeCustomerId(
	stripeCustomerId: string
): Promise<string | null> {
	const { data, error } = await supabaseAdmin
		.from('customers')
		.select('id')
		.eq('stripe_customer_id', stripeCustomerId)
		.maybeSingle();

	if (error) {
		throw new Error(
			`[customers.service] reverse lookup failed for ${stripeCustomerId}: ${error.message}`
		);
	}
	return data?.id ?? null;
}
