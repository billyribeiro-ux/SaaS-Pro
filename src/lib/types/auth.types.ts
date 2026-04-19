import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type AppSupabaseClient = SupabaseClient<Database>;

export interface SafeSession {
	session: Session | null;
	user: User | null;
}

export type AuthUser = User;
export type AuthSession = Session;
