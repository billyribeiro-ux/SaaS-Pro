import type { ModuleMeta, LessonMeta } from '$types/lesson.types';

export const CURRICULUM: readonly ModuleMeta[] = [
	{
		slug: 'module-00-introduction',
		title: 'Introduction',
		moduleNumber: 0,
		lessons: [
			{ slug: '00-introduction', title: 'Introduction', duration: 3, preview: true },
			{ slug: '01-what-were-building', title: "What We're Building", duration: 5, preview: true },
			{ slug: '02-course-discord', title: 'Course Discord Access', duration: 2, preview: false },
			{ slug: '03-resources', title: 'Resources', duration: 2, preview: false }
		]
	},
	{
		slug: 'module-01-project-setup',
		title: 'Module 1: Project Setup',
		moduleNumber: 1,
		lessons: [
			{
				slug: '01-sveltekit-project-setup',
				title: '1.1 - SvelteKit Project Setup',
				duration: 12,
				preview: false
			},
			{
				slug: '02-supabase-local-development',
				title: '1.2 - Supabase Local Development',
				duration: 15,
				preview: false
			},
			{
				slug: '03-protected-auth-schema',
				title: '1.3 - Protected Auth Schema',
				duration: 10,
				preview: false
			},
			{
				slug: '04-profiles-table-rls',
				title: '1.4 - Profiles Table & RLS',
				duration: 12,
				preview: false
			}
		]
	},
	{
		slug: 'module-02-supabase-integration',
		title: 'Module 2: Integrate SvelteKit & Supabase',
		moduleNumber: 2,
		lessons: [
			{
				slug: '01-server-side-environment',
				title: '2.1 - Server-Side Environment',
				duration: 8,
				preview: false
			},
			{
				slug: '02-install-sdks-generate-types',
				title: '2.2 - Install Supabase SDKs & Generate Types',
				duration: 10,
				preview: false
			},
			{
				slug: '03-server-side-supabase',
				title: '2.3 - Server-Side Supabase',
				duration: 14,
				preview: false
			},
			{
				slug: '04-client-side-supabase',
				title: '2.4 - Client Side Supabase',
				duration: 10,
				preview: false
			}
		]
	},
	{
		slug: 'module-03-user-auth',
		title: 'Module 3: User Auth',
		moduleNumber: 3,
		lessons: [
			{
				slug: '01-user-registration',
				title: '3.1 - User Registration',
				duration: 15,
				preview: false
			},
			{ slug: '02-user-login', title: '3.2 - User Login', duration: 12, preview: false },
			{
				slug: '03-protecting-auth-routes',
				title: '3.3 - Protecting Auth Routes',
				duration: 10,
				preview: false
			},
			{
				slug: '04-user-logout-navigation',
				title: '3.4 - User Logout & Navigation',
				duration: 8,
				preview: false
			},
			{ slug: '05-account-page', title: '3.5 - Account Page', duration: 10, preview: false },
			{ slug: '06-account-actions', title: '3.6 - Account Actions', duration: 12, preview: false }
		]
	},
	{
		slug: 'module-04-crud',
		title: 'Module 4: CRUD',
		moduleNumber: 4,
		lessons: [
			{
				slug: '01-contacts-table-rls',
				title: '4.1 - Contacts Table & RLS Policies',
				duration: 12,
				preview: false
			},
			{ slug: '02-seeding-supabase', title: '4.2 - Seeding Supabase', duration: 8, preview: false },
			{
				slug: '03-creating-contacts',
				title: '4.3 - Creating Contacts',
				duration: 15,
				preview: false
			},
			{
				slug: '04-supabase-admin-client',
				title: '4.4 - Supabase Admin Client',
				duration: 10,
				preview: false
			},
			{
				slug: '05-reading-contacts',
				title: '4.5 - Reading Contacts',
				duration: 12,
				preview: false
			},
			{
				slug: '06-updating-contacts',
				title: '4.6 - Updating Contacts',
				duration: 12,
				preview: false
			},
			{
				slug: '07-deleting-contacts',
				title: '4.7 - Deleting Contacts',
				duration: 10,
				preview: false
			},
			{
				slug: '07-1-close-modal-on-cancel',
				title: '4.7.1 - Close Modal on Cancel',
				duration: 5,
				preview: false
			},
			{ slug: '08-seeding-contacts', title: '4.8 - Seeding Contacts', duration: 8, preview: false }
		]
	},
	{
		slug: 'module-05-stripe-intro',
		title: 'Module 5: Stripe Introduction',
		moduleNumber: 5,
		lessons: [
			{
				slug: '01-stripe-dashboard-overview',
				title: '5.1 - Stripe Dashboard Overview',
				duration: 10,
				preview: true
			},
			{ slug: '02-stripe-api-docs', title: '5.2 - Stripe API & Docs', duration: 8, preview: true },
			{
				slug: '03-setup-stripe-cli',
				title: '5.3 - Setup Stripe CLI',
				duration: 10,
				preview: false
			},
			{
				slug: '03-1-stripe-cli-wsl-note',
				title: '5.3.1 - Stripe CLI WSL Note',
				duration: 3,
				preview: false
			},
			{
				slug: '04-products-prices-overview',
				title: '5.4 - Products & Prices Overview',
				duration: 10,
				preview: false
			},
			{
				slug: '05-creating-products-prices',
				title: '5.5 - Creating Products & Prices',
				duration: 15,
				preview: false
			},
			{ slug: '06-lookup-keys', title: '5.6 - Lookup Keys', duration: 12, preview: false },
			{ slug: '07-cleanup', title: '5.7 - Cleanup', duration: 5, preview: false }
		]
	},
	{
		slug: 'module-06-stripe-sveltekit',
		title: 'Module 6: Stripe & SvelteKit Integration',
		moduleNumber: 6,
		lessons: [
			{
				slug: '01-setup-stripe-node-client',
				title: '6.1 - Setup Stripe Node Client',
				duration: 10,
				preview: false
			},
			{
				slug: '02-stripe-webhooks-events',
				title: '6.2 - Stripe Webhooks & Events',
				duration: 15,
				preview: false
			},
			{
				slug: '03-create-webhook-endpoint',
				title: '6.3 - Create Webhook Endpoint',
				duration: 18,
				preview: false
			},
			{ slug: '03-1-webhook-script', title: '6.3.1 - Webhook Script', duration: 8, preview: false },
			{
				slug: '04-what-data-to-store',
				title: '6.4 - What Data to Store',
				duration: 12,
				preview: false
			}
		]
	},
	{
		slug: 'module-07-billing-services',
		title: 'Module 7: Billing Services',
		moduleNumber: 7,
		lessons: [
			{
				slug: '01-define-billing-tables',
				title: '7.1 - Define Billing Tables',
				duration: 15,
				preview: false
			},
			{
				slug: '02-products-service',
				title: '7.2 - Products Service',
				duration: 12,
				preview: false
			},
			{
				slug: '03-customers-service',
				title: '7.3 - Customers Service',
				duration: 12,
				preview: false
			},
			{
				slug: '04-subscriptions-service',
				title: '7.4 - Subscriptions Service',
				duration: 15,
				preview: false
			}
		]
	},
	{
		slug: 'module-08-pricing-page',
		title: 'Module 8: Products, Pricing, & Pricing Page',
		moduleNumber: 8,
		lessons: [
			{
				slug: '01-create-products-prices',
				title: '8.1 - Create Products & Prices',
				duration: 12,
				preview: false
			},
			{
				slug: '02-seeding-stripe-data',
				title: '8.2 - Seeding Stripe Data',
				duration: 10,
				preview: false
			},
			{
				slug: '03-pricing-page-config',
				title: '8.3 - Pricing Page Config',
				duration: 12,
				preview: false
			},
			{ slug: '04-pricing-page', title: '8.4 - Pricing Page', duration: 18, preview: false }
		]
	},
	{
		slug: 'module-09-checkout-billing',
		title: 'Module 9: Pricing, Checkout, & Billing',
		moduleNumber: 9,
		lessons: [
			{
				slug: '01-checkout-sessions',
				title: '9.1 - Checkout Sessions',
				duration: 18,
				preview: false
			},
			{
				slug: '02-free-trial-options',
				title: '9.2 - Free Trial Options',
				duration: 15,
				preview: false
			},
			{
				slug: '03-stripe-test-clocks',
				title: '9.3 - Stripe Test Clocks',
				duration: 10,
				preview: false
			},
			{
				slug: '04-preventing-multiple-trials',
				title: '9.4 - Preventing Multiple Trials',
				duration: 12,
				preview: false
			},
			{
				slug: '05-test-cards-failed-payments',
				title: '9.5 - Test Cards & Failed Payments',
				duration: 10,
				preview: false
			},
			{
				slug: '06-subscription-email-settings',
				title: '9.6 - Subscription & Email Settings',
				duration: 8,
				preview: false
			},
			{
				slug: '07-configure-customer-portal',
				title: '9.7 - Configure Customer Portal',
				duration: 12,
				preview: false
			},
			{
				slug: '08-deliver-customer-portal',
				title: '9.8 - Deliver Customer Portal',
				duration: 10,
				preview: false
			}
		]
	},
	{
		slug: 'module-10-access-control',
		title: 'Module 10: Tier-Based Access Control',
		moduleNumber: 10,
		lessons: [
			{
				slug: '01-validate-tier-helpers',
				title: '10.1 - Validate Tier Helpers',
				duration: 12,
				preview: false
			},
			{
				slug: '02-restricting-actions',
				title: '10.2 - Restricting Actions',
				duration: 15,
				preview: false
			},
			{
				slug: '03-limiting-ui-interactions',
				title: '10.3 - Limiting UI Interactions',
				duration: 12,
				preview: false
			},
			{
				slug: '04-prevent-multiple-plans',
				title: '10.4 - Prevent Multiple Plans',
				duration: 10,
				preview: false
			}
		]
	},
	{
		slug: 'module-11-testing',
		title: 'Module 11: Testing',
		moduleNumber: 11,
		lessons: [
			{
				slug: '01-setup-playwright',
				title: '11.1 - Setup Playwright',
				duration: 12,
				preview: false
			},
			{ slug: '02-auth-flow-tests', title: '11.2 - Auth Flow Tests', duration: 18, preview: false },
			{ slug: '03-crud-tests', title: '11.3 - CRUD Tests', duration: 15, preview: false }
		]
	},
	{
		slug: 'module-12-cicd',
		title: 'Module 12: CI/CD Pipeline & Production',
		moduleNumber: 12,
		lessons: [
			{
				slug: '01-cicd-pipeline-overview',
				title: '12.1 - CI/CD Pipeline Overview',
				duration: 10,
				preview: true
			},
			{
				slug: '02-supabase-to-production',
				title: '12.2 - Supabase to Production',
				duration: 15,
				preview: false
			},
			{
				slug: '03-creating-vercel-project',
				title: '12.3 - Creating Vercel Project',
				duration: 10,
				preview: false
			},
			{
				slug: '04-github-actions-workflow',
				title: '12.4 - GitHub Actions Workflow',
				duration: 20,
				preview: false
			},
			{
				slug: '05-stripe-supabase-in-production',
				title: '12.5 - Stripe & Supabase in Production',
				duration: 15,
				preview: false
			},
			{
				slug: '06-production-url-updates',
				title: '12.6 - Production URL Updates',
				duration: 8,
				preview: false
			}
		]
	},
	{
		slug: 'module-13-ux-extras',
		title: 'Module 13: UX Extras',
		moduleNumber: 13,
		lessons: [
			{
				slug: '01-toast-notifications',
				title: '13.1 - Toast Notifications',
				duration: 12,
				preview: false
			},
			{
				slug: '02-better-redirects',
				title: '13.2 - Better Redirects',
				duration: 8,
				preview: false
			},
			{ slug: '03-stripe-branding', title: '13.3 - Stripe Branding', duration: 8, preview: false }
		]
	},
	{
		slug: 'module-14-thank-you',
		title: 'Thank You',
		moduleNumber: 14,
		lessons: [
			{ slug: '00-thank-you', title: 'Thank You', duration: 3, preview: false },
			{
				slug: 'bonus-01-google-oauth',
				title: 'Bonus: Sign in with Google (OAuth)',
				duration: 20,
				preview: false
			},
			{
				slug: 'bonus-02-avatar-uploads-storage',
				title: 'Bonus: Contact Avatars with Supabase Storage',
				duration: 25,
				preview: false
			},
			{
				slug: 'bonus-03-csv-import-export',
				title: 'Bonus: CSV Import & Export',
				duration: 20,
				preview: false
			},
			{
				slug: 'bonus-04-full-text-search',
				title: 'Bonus: Full-Text Search with Postgres',
				duration: 20,
				preview: false
			},
			{
				slug: 'bonus-05-realtime-sync',
				title: 'Bonus: Real-Time Multi-Tab Sync',
				duration: 18,
				preview: false
			},
			{
				slug: 'bonus-06-dark-mode',
				title: 'Bonus: Dark Mode Done Right',
				duration: 22,
				preview: false
			},
			{
				slug: 'bonus-07-remote-functions',
				title: 'Bonus: Remote Functions — the 2026 Way',
				duration: 45,
				preview: false
			},
			{
				slug: 'bonus-08-shallow-routing-modals',
				title: 'Bonus: Shallow Routing for Modals',
				duration: 22,
				preview: false
			},
			{
				slug: 'bonus-09-attach-directives-async-boundaries',
				title: 'Bonus: {@attach} & <svelte:boundary>',
				duration: 22,
				preview: false
			},
			{
				slug: 'bonus-10-observability-tracing',
				title: 'Bonus: Observability & Tracing',
				duration: 18,
				preview: false
			}
		]
	}
] as const;

export function findModule(moduleSlug: string): ModuleMeta | null {
	return CURRICULUM.find((m) => m.slug === moduleSlug) ?? null;
}

export function findLesson(moduleSlug: string, lessonSlug: string): LessonMeta | null {
	const mod = findModule(moduleSlug);
	if (!mod) return null;
	return mod.lessons.find((l) => l.slug === lessonSlug) ?? null;
}

export function adjacentLessons(
	moduleSlug: string,
	lessonSlug: string
): {
	prev: { moduleSlug: string; lessonSlug: string; title: string } | null;
	next: { moduleSlug: string; lessonSlug: string; title: string } | null;
} {
	const flat: Array<{ moduleSlug: string; lesson: LessonMeta }> = [];
	for (const mod of CURRICULUM) {
		for (const lesson of mod.lessons) {
			flat.push({ moduleSlug: mod.slug, lesson });
		}
	}
	const index = flat.findIndex(
		(entry) => entry.moduleSlug === moduleSlug && entry.lesson.slug === lessonSlug
	);
	if (index === -1) return { prev: null, next: null };

	const prevEntry = index > 0 ? flat[index - 1] : null;
	const nextEntry = index < flat.length - 1 ? flat[index + 1] : null;
	return {
		prev: prevEntry
			? {
					moduleSlug: prevEntry.moduleSlug,
					lessonSlug: prevEntry.lesson.slug,
					title: prevEntry.lesson.title
				}
			: null,
		next: nextEntry
			? {
					moduleSlug: nextEntry.moduleSlug,
					lessonSlug: nextEntry.lesson.slug,
					title: nextEntry.lesson.title
				}
			: null
	};
}
