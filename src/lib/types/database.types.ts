// Hand-authored to match supabase/migrations/*.sql and the schema shape
// expected by @supabase/supabase-js >= 2.100 (Relationships + __InternalSupabase).
// Regenerate against a running Supabase instance with `pnpm db:types` once the
// stack is up; the generated version will replace this file.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubscriptionStatus =
	| 'trialing'
	| 'active'
	| 'canceled'
	| 'incomplete'
	| 'incomplete_expired'
	| 'past_due'
	| 'unpaid'
	| 'paused';

export type PriceType = 'one_time' | 'recurring';
export type PriceInterval = 'day' | 'week' | 'month' | 'year';

export type Database = {
	__InternalSupabase: {
		PostgrestVersion: '12';
	};
	public: {
		Tables: {
			profiles: {
				Row: {
					id: string;
					email: string;
					full_name: string | null;
					avatar_url: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					email: string;
					full_name?: string | null;
					avatar_url?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					email?: string;
					full_name?: string | null;
					avatar_url?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			products: {
				Row: {
					id: string;
					name: string;
					description: string | null;
					active: boolean;
					metadata: Json | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					name: string;
					description?: string | null;
					active?: boolean;
					metadata?: Json | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					description?: string | null;
					active?: boolean;
					metadata?: Json | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			prices: {
				Row: {
					id: string;
					product_id: string | null;
					active: boolean;
					currency: string;
					type: PriceType;
					unit_amount: number | null;
					interval: PriceInterval | null;
					interval_count: number | null;
					lookup_key: string | null;
					metadata: Json | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					product_id?: string | null;
					active?: boolean;
					currency: string;
					type: PriceType;
					unit_amount?: number | null;
					interval?: PriceInterval | null;
					interval_count?: number | null;
					lookup_key?: string | null;
					metadata?: Json | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					product_id?: string | null;
					active?: boolean;
					currency?: string;
					type?: PriceType;
					unit_amount?: number | null;
					interval?: PriceInterval | null;
					interval_count?: number | null;
					lookup_key?: string | null;
					metadata?: Json | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'prices_product_id_fkey';
						columns: ['product_id'];
						isOneToOne: false;
						referencedRelation: 'products';
						referencedColumns: ['id'];
					}
				];
			};
			customers: {
				Row: {
					id: string;
					stripe_customer_id: string;
					created_at: string;
				};
				Insert: {
					id: string;
					stripe_customer_id: string;
					created_at?: string;
				};
				Update: {
					id?: string;
					stripe_customer_id?: string;
					created_at?: string;
				};
				Relationships: [];
			};
			subscriptions: {
				Row: {
					id: string;
					user_id: string;
					status: SubscriptionStatus;
					price_id: string | null;
					quantity: number | null;
					cancel_at_period_end: boolean;
					cancel_at: string | null;
					canceled_at: string | null;
					current_period_start: string;
					current_period_end: string;
					created_at: string;
					ended_at: string | null;
					trial_start: string | null;
					trial_end: string | null;
					metadata: Json | null;
				};
				Insert: {
					id: string;
					user_id: string;
					status: SubscriptionStatus;
					price_id?: string | null;
					quantity?: number | null;
					cancel_at_period_end?: boolean;
					cancel_at?: string | null;
					canceled_at?: string | null;
					current_period_start: string;
					current_period_end: string;
					created_at?: string;
					ended_at?: string | null;
					trial_start?: string | null;
					trial_end?: string | null;
					metadata?: Json | null;
				};
				Update: {
					id?: string;
					user_id?: string;
					status?: SubscriptionStatus;
					price_id?: string | null;
					quantity?: number | null;
					cancel_at_period_end?: boolean;
					cancel_at?: string | null;
					canceled_at?: string | null;
					current_period_start?: string;
					current_period_end?: string;
					created_at?: string;
					ended_at?: string | null;
					trial_start?: string | null;
					trial_end?: string | null;
					metadata?: Json | null;
				};
				Relationships: [
					{
						foreignKeyName: 'subscriptions_price_id_fkey';
						columns: ['price_id'];
						isOneToOne: false;
						referencedRelation: 'prices';
						referencedColumns: ['id'];
					}
				];
			};
			lesson_progress: {
				Row: {
					id: string;
					user_id: string;
					module_slug: string;
					lesson_slug: string;
					completed: boolean;
					completed_at: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					module_slug: string;
					lesson_slug: string;
					completed?: boolean;
					completed_at?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					module_slug?: string;
					lesson_slug?: string;
					completed?: boolean;
					completed_at?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
		};
		Views: { [_ in never]: never };
		Functions: { [_ in never]: never };
		Enums: { [_ in never]: never };
		CompositeTypes: { [_ in never]: never };
	};
};

export type Tables<T extends keyof Database['public']['Tables']> =
	Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
	Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
	Database['public']['Tables'][T]['Update'];
