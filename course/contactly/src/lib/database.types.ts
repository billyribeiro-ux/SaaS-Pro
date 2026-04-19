/**
 * Supabase database types — Contactly.
 *
 * This file is the single source of TypeScript truth for what's in our
 * Postgres schema. Every Supabase client call (`supabase.from('...')`,
 * `supabase.rpc('...')`) is type-checked against this shape, so a
 * column rename or table addition surfaces as a build error rather
 * than a runtime "undefined is not an object" in production.
 *
 * REGENERATION
 * ------------
 * Once your local Supabase stack is running (`pnpm run db:start`),
 * regenerate this file with:
 *
 *     pnpm run types:generate
 *
 * That command runs `supabase gen types typescript --local --schema
 * public > src/lib/database.types.ts` and overwrites everything below.
 *
 * What's checked in here right now is a HAND-WRITTEN baseline that
 * matches the migrations in `supabase/migrations/` exactly, so
 * `pnpm run check` is green for someone who has cloned the repo and
 * not yet booted Docker. The first time you regenerate, the diff
 * should be near-zero — if it isn't, treat that as a signal that
 * either this file or the migrations have drifted and reconcile
 * before continuing.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	// Enables `createClient(URL, KEY)` (no `<Database>` generic) to
	// pick the correct PostgREST contract automatically. Supabase
	// emits this; we mirror it so the generated and hand-written
	// shapes stay byte-for-byte comparable.
	__InternalSupabase: {
		PostgrestVersion: '14.5';
	};
	public: {
		Tables: {
			profiles: {
				Row: {
					avatar_url: string | null;
					created_at: string;
					email: string;
					full_name: string | null;
					id: string;
					is_platform_admin: boolean;
					updated_at: string;
				};
				Insert: {
					avatar_url?: string | null;
					created_at?: string;
					email: string;
					full_name?: string | null;
					id: string;
					is_platform_admin?: boolean;
					updated_at?: string;
				};
				Update: {
					avatar_url?: string | null;
					created_at?: string;
					email?: string;
					full_name?: string | null;
					id?: string;
					is_platform_admin?: boolean;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'profiles_id_fkey';
						columns: ['id'];
						isOneToOne: true;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					}
				];
			};
			organizations: {
				Row: {
					id: string;
					name: string;
					slug: string;
					is_personal: boolean;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					name: string;
					slug: string;
					is_personal?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					slug?: string;
					is_personal?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			organization_members: {
				Row: {
					organization_id: string;
					user_id: string;
					role: Database['public']['Enums']['organization_member_role'];
					created_at: string;
				};
				Insert: {
					organization_id: string;
					user_id: string;
					role?: Database['public']['Enums']['organization_member_role'];
					created_at?: string;
				};
				Update: {
					organization_id?: string;
					user_id?: string;
					role?: Database['public']['Enums']['organization_member_role'];
					created_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'organization_members_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'organization_members_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			contacts: {
				Row: {
					id: string;
					organization_id: string;
					created_by: string | null;
					full_name: string;
					email: string | null;
					phone: string | null;
					company: string | null;
					job_title: string | null;
					notes: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					organization_id: string;
					created_by?: string | null;
					full_name: string;
					email?: string | null;
					phone?: string | null;
					company?: string | null;
					job_title?: string | null;
					notes?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					organization_id?: string;
					created_by?: string | null;
					full_name?: string;
					email?: string | null;
					phone?: string | null;
					company?: string | null;
					job_title?: string | null;
					notes?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'contacts_organization_id_fkey';
						columns: ['organization_id'];
						isOneToOne: false;
						referencedRelation: 'organizations';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'contacts_created_by_fkey';
						columns: ['created_by'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			stripe_customers: {
				Row: {
					user_id: string;
					stripe_customer_id: string;
					email: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					user_id: string;
					stripe_customer_id: string;
					email?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					user_id?: string;
					stripe_customer_id?: string;
					email?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'stripe_customers_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: true;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					}
				];
			};
			stripe_events: {
				Row: {
					id: string;
					type: string;
					payload: Json;
					received_at: string;
					processed_at: string | null;
					livemode: boolean;
					api_version: string | null;
				};
				Insert: {
					id: string;
					type: string;
					payload: Json;
					received_at?: string;
					processed_at?: string | null;
					livemode: boolean;
					api_version?: string | null;
				};
				Update: {
					id?: string;
					type?: string;
					payload?: Json;
					received_at?: string;
					processed_at?: string | null;
					livemode?: boolean;
					api_version?: string | null;
				};
				Relationships: [];
			};
			stripe_products: {
				Row: {
					id: string;
					active: boolean;
					name: string;
					description: string | null;
					metadata: Json;
					tax_code: string | null;
					stripe_created_at: string | null;
					stripe_updated_at: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					active?: boolean;
					name: string;
					description?: string | null;
					metadata?: Json;
					tax_code?: string | null;
					stripe_created_at?: string | null;
					stripe_updated_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					active?: boolean;
					name?: string;
					description?: string | null;
					metadata?: Json;
					tax_code?: string | null;
					stripe_created_at?: string | null;
					stripe_updated_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			stripe_prices: {
				Row: {
					id: string;
					product_id: string;
					active: boolean;
					lookup_key: string | null;
					unit_amount: number | null;
					currency: string;
					type: Database['public']['Enums']['stripe_price_type'];
					recurring_interval: Database['public']['Enums']['stripe_billing_interval'] | null;
					recurring_interval_count: number | null;
					tax_behavior: string | null;
					metadata: Json;
					stripe_created_at: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					product_id: string;
					active?: boolean;
					lookup_key?: string | null;
					unit_amount?: number | null;
					currency: string;
					type: Database['public']['Enums']['stripe_price_type'];
					recurring_interval?: Database['public']['Enums']['stripe_billing_interval'] | null;
					recurring_interval_count?: number | null;
					tax_behavior?: string | null;
					metadata?: Json;
					stripe_created_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					product_id?: string;
					active?: boolean;
					lookup_key?: string | null;
					unit_amount?: number | null;
					currency?: string;
					type?: Database['public']['Enums']['stripe_price_type'];
					recurring_interval?: Database['public']['Enums']['stripe_billing_interval'] | null;
					recurring_interval_count?: number | null;
					tax_behavior?: string | null;
					metadata?: Json;
					stripe_created_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'stripe_prices_product_id_fkey';
						columns: ['product_id'];
						isOneToOne: false;
						referencedRelation: 'stripe_products';
						referencedColumns: ['id'];
					}
				];
			};
			stripe_subscriptions: {
				Row: {
					id: string;
					user_id: string;
					stripe_customer_id: string;
					status: Database['public']['Enums']['stripe_subscription_status'];
					price_id: string;
					cancel_at_period_end: boolean;
					current_period_start: string | null;
					current_period_end: string | null;
					trial_start: string | null;
					trial_end: string | null;
					canceled_at: string | null;
					cancel_at: string | null;
					tier_snapshot: string | null;
					stripe_created_at: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					user_id: string;
					stripe_customer_id: string;
					status: Database['public']['Enums']['stripe_subscription_status'];
					price_id: string;
					cancel_at_period_end?: boolean;
					current_period_start?: string | null;
					current_period_end?: string | null;
					trial_start?: string | null;
					trial_end?: string | null;
					canceled_at?: string | null;
					cancel_at?: string | null;
					tier_snapshot?: string | null;
					stripe_created_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					stripe_customer_id?: string;
					status?: Database['public']['Enums']['stripe_subscription_status'];
					price_id?: string;
					cancel_at_period_end?: boolean;
					current_period_start?: string | null;
					current_period_end?: string | null;
					trial_start?: string | null;
					trial_end?: string | null;
					canceled_at?: string | null;
					cancel_at?: string | null;
					tier_snapshot?: string | null;
					stripe_created_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'stripe_subscriptions_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'stripe_subscriptions_price_id_fkey';
						columns: ['price_id'];
						isOneToOne: false;
						referencedRelation: 'stripe_prices';
						referencedColumns: ['id'];
					}
				];
			};
			stripe_invoices: {
				Row: {
					id: string;
					user_id: string;
					stripe_customer_id: string;
					subscription_id: string | null;
					status: Database['public']['Enums']['stripe_invoice_status'];
					currency: string;
					amount_due: number;
					amount_paid: number;
					amount_remaining: number;
					subtotal: number;
					total: number;
					tax: number | null;
					number: string | null;
					hosted_invoice_url: string | null;
					invoice_pdf: string | null;
					period_start: string | null;
					period_end: string | null;
					created_at_stripe: string | null;
					paid_at: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					user_id: string;
					stripe_customer_id: string;
					subscription_id?: string | null;
					status: Database['public']['Enums']['stripe_invoice_status'];
					currency: string;
					amount_due?: number;
					amount_paid?: number;
					amount_remaining?: number;
					subtotal?: number;
					total?: number;
					tax?: number | null;
					number?: string | null;
					hosted_invoice_url?: string | null;
					invoice_pdf?: string | null;
					period_start?: string | null;
					period_end?: string | null;
					created_at_stripe?: string | null;
					paid_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					stripe_customer_id?: string;
					subscription_id?: string | null;
					status?: Database['public']['Enums']['stripe_invoice_status'];
					currency?: string;
					amount_due?: number;
					amount_paid?: number;
					amount_remaining?: number;
					subtotal?: number;
					total?: number;
					tax?: number | null;
					number?: string | null;
					hosted_invoice_url?: string | null;
					invoice_pdf?: string | null;
					period_start?: string | null;
					period_end?: string | null;
					created_at_stripe?: string | null;
					paid_at?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'stripe_invoices_user_id_fkey';
						columns: ['user_id'];
						isOneToOne: false;
						referencedRelation: 'profiles';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'stripe_invoices_subscription_id_fkey';
						columns: ['subscription_id'];
						isOneToOne: false;
						referencedRelation: 'stripe_subscriptions';
						referencedColumns: ['id'];
					}
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			// `handle_new_user` and `set_updated_at` are SECURITY DEFINER
			// trigger functions revoked from PUBLIC, so they don't appear
			// in the PostgREST API surface and `supabase gen types` will
			// not include them either. `is_organization_member` IS
			// callable through PostgREST in principle but we always invoke
			// it from inside SQL policies, never from the JS client, so
			// we omit it from the type here too.
			[_ in never]: never;
		};
		Enums: {
			organization_member_role: 'owner' | 'admin' | 'member';
			stripe_billing_interval: 'day' | 'week' | 'month' | 'year';
			stripe_price_type: 'one_time' | 'recurring';
			stripe_subscription_status:
				| 'incomplete'
				| 'incomplete_expired'
				| 'trialing'
				| 'active'
				| 'past_due'
				| 'canceled'
				| 'unpaid'
				| 'paused';
			stripe_invoice_status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};
