import { env } from '$env/dynamic/public';

// Dynamic public env: allows `vite build` on CI (e.g. Vercel) without baking in static
// exports for every key — values are read when modules run. Set the same `PUBLIC_*`
// vars in your host’s dashboard for production.
export const SITE = {
	get name() {
		return env.PUBLIC_APP_NAME || 'SaaS-Pro';
	},
	get url() {
		return env.PUBLIC_APP_URL || 'http://localhost:5173';
	},
	description:
		'The production-grade course on shipping a real SaaS with SvelteKit, Supabase, and Stripe.',
	twitter: '@saaspro',
	defaultOgImage: '/og-default.png'
};

export const SUPPORT_EMAIL = 'support@saas-pro.dev';
