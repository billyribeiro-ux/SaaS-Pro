import type Stripe from 'stripe';
import type { Tables, SubscriptionStatus } from './database.types';

export type ProductRow = Tables<'products'>;
export type PriceRow = Tables<'prices'>;
export type CustomerRow = Tables<'customers'>;
export type SubscriptionRow = Tables<'subscriptions'>;

export interface PriceWithProduct extends PriceRow {
	product: ProductRow | null;
}

export interface ResolvedPricing {
	monthly: PriceWithProduct | null;
	yearly: PriceWithProduct | null;
	lifetime: PriceWithProduct | null;
}

export interface ActiveSubscription {
	id: string;
	status: SubscriptionStatus;
	priceId: string | null;
	currentPeriodEnd: string;
	cancelAtPeriodEnd: boolean;
	trialEnd: string | null;
}

export interface CheckoutRequestBody {
	lookupKey: string;
}

export interface CheckoutResponseBody {
	url: string;
}

export interface PortalResponseBody {
	url: string;
}

export type StripeSubscriptionEvent =
	| Stripe.CustomerSubscriptionCreatedEvent
	| Stripe.CustomerSubscriptionUpdatedEvent
	| Stripe.CustomerSubscriptionDeletedEvent;
