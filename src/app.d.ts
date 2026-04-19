import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$types/database.types';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			// Server-verified user via supabase.auth.getUser(). Null when unauthenticated.
			// Use this — never the cached session — for authorization decisions.
			getUser(): Promise<User | null>;
			user: User | null;
			session: Session | null;
		}
		interface PageData {
			user: User | null;
			session: Session | null;
		}
		interface Error {
			message: string;
			code?: string;
		}
	}
}

export {};
