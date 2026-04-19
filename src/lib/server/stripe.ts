import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';

// Stripe v22 requires `new Stripe()`. Pinning apiVersion keeps behavior stable
// across SDK patch releases — upgrade deliberately, never implicitly.
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-03-25.dahlia',
	appInfo: {
		name: 'saas-pro',
		version: '0.1.0'
	},
	typescript: true
});
