import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { RequestEvent } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { Database } from '$types/database.types';

// Admin client — bypasses RLS. Server-only; never expose to the browser.
// Lazily initialised so SvelteKit's post-build `analyse` pass (which imports
// every server module) does not crash when env vars are not yet injected.
let _admin: SupabaseClient<Database> | null = null;
function getAdmin(): SupabaseClient<Database> {
	if (_admin) return _admin;
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const key = privateEnv.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error(
			'Missing Supabase env vars: PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
		);
	}
	_admin = createClient<Database>(url, key, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	return _admin;
}

export const supabaseAdmin: SupabaseClient<Database> = new Proxy(
	{} as SupabaseClient<Database>,
	{
		get(_target, prop, receiver) {
			const client = getAdmin();
			const value = Reflect.get(client as object, prop, receiver);
			return typeof value === 'function' ? value.bind(client) : value;
		}
	}
);

// Request-scoped SSR client — respects RLS via the caller's session cookie.
// Instantiate once per request in hooks.server.ts and attach to event.locals.
export function createRequestSupabaseClient(event: RequestEvent) {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anon = publicEnv.PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !anon) {
		throw new Error(
			'Missing Supabase env vars: PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are required.'
		);
	}
	const cookies: CookieMethodsServer = {
		getAll: () => event.cookies.getAll(),
		setAll: (cookiesToSet) => {
			for (const { name, value, options } of cookiesToSet) {
				event.cookies.set(name, value, { ...options, path: '/' });
			}
		}
	};
	return createServerClient<Database>(url, anon, { cookies });
}
