import { PUBLIC_APP_NAME, PUBLIC_APP_URL } from '$env/static/public';

export const SITE = {
	name: PUBLIC_APP_NAME || 'SaaS-Pro',
	url: PUBLIC_APP_URL || 'http://localhost:5173',
	description:
		'The production-grade course on shipping a real SaaS with SvelteKit, Supabase, and Stripe.',
	twitter: '@saaspro',
	defaultOgImage: '/og-default.png'
} as const;

export const SUPPORT_EMAIL = 'support@saas-pro.dev';
