import { createClient } from '@supabase/supabase-js';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { RequestEvent } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { Database } from '$types/database.types';

// Admin client — bypasses RLS. Server-only; never expose to the browser.
// Use for webhook handlers and service-role operations (e.g. syncing Stripe data).
// Dynamic env so CI builds (Vercel, etc.) do not require `$env/static/private` at compile time.
export const supabaseAdmin = createClient<Database>(
	publicEnv.PUBLIC_SUPABASE_URL!,
	privateEnv.SUPABASE_SERVICE_ROLE_KEY!,
	{
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	}
);

// Request-scoped SSR client — respects RLS via the caller's session cookie.
// Instantiate once per request in hooks.server.ts and attach to event.locals.
export function createRequestSupabaseClient(event: RequestEvent) {
	const cookies: CookieMethodsServer = {
		getAll: () => event.cookies.getAll(),
		setAll: (cookiesToSet) => {
			for (const { name, value, options } of cookiesToSet) {
				event.cookies.set(name, value, { ...options, path: '/' });
			}
		}
	};

	return createServerClient<Database>(
		publicEnv.PUBLIC_SUPABASE_URL!,
		publicEnv.PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies
		}
	);
}
