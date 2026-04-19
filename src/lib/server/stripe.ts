import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

// Lazily initialised so SvelteKit's post-build `analyse` pass (which imports
// every server module) does not crash when env vars are not yet injected.
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
	if (_stripe) return _stripe;
	const key = env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error('Missing STRIPE_SECRET_KEY env var.');
	}
	_stripe = new Stripe(key, {
		apiVersion: '2026-03-25.dahlia',
		appInfo: { name: 'saas-pro', version: '0.1.0' },
		typescript: true
	});
	return _stripe;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
	get(_target, prop, receiver) {
		const client = getStripe();
		const value = Reflect.get(client as object, prop, receiver);
		return typeof value === 'function' ? value.bind(client) : value;
	}
});
