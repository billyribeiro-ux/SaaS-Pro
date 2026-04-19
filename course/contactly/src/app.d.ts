// See https://svelte.dev/docs/kit/types#app.d.ts for what each interface does.
//
// `App.Locals` is the per-request server-side context that
// `hooks.server.ts` populates. Typing it here means every server
// `load`, every form action, and every `+server.ts` endpoint gets
// `event.locals.supabase` and `event.locals.safeGetSession` autocomplete
// — and forgetting to set one of them surfaces as a type error in the
// hook, not a runtime undefined.
//
// `App.PageData` exposes whatever the root `+layout.server.ts` and
// `+layout.ts` return, merged. Lesson 2.4 ships a universal `+layout.ts`
// that returns `{ supabase, session }`, and a `+layout.server.ts` that
// returns `{ session, user, cookies }`. They get merged into `data` on
// every page, so we type them here once and downstream pages inherit.
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient<Database>;
			safeGetSession: () => Promise<
				{ session: Session; user: User } | { session: null; user: null }
			>;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
