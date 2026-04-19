<script lang="ts">
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Sparkles from '$components/icons/Sparkles.svelte';
	import ExternalLink from '$components/icons/ExternalLink.svelte';
	import { formatDate } from '$utils/format';
	import type { ActionData, PageData } from './$types';

	type Props = {
		data: PageData;
		form: ActionData;
	};

	let { data, form }: Props = $props();

	/*
	 * Section header snippet — reused across every Card so the whole page has a
	 * consistent title/description hierarchy. Implemented as a helper component
	 * in the same file (via a Svelte snippet below) would add ceremony; a small
	 * inline block is clearer.
	 */
</script>

<svelte:head>
	<title>Account — SaaS-Pro</title>
</svelte:head>

<section class="mx-auto max-w-3xl px-6 py-10">
	<header class="mb-8">
		<p class="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
			Account
		</p>
		<h1 class="font-display mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
		<p class="mt-2 text-slate-600 dark:text-slate-400">
			Manage your profile, subscription, and billing.
		</p>
	</header>

	<div class="space-y-4">
		<!-- PROFILE ───────────────────────────────────────────────────────── -->
		<Card>
			{#snippet header()}
				<div>
					<h2 class="text-base font-semibold tracking-tight">Profile</h2>
					<p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
						Your identity across the app.
					</p>
				</div>
			{/snippet}
			<dl class="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
				<div>
					<dt class="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
						Email
					</dt>
					<dd class="mt-1 font-medium text-slate-900 dark:text-white">{data.user?.email}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
						Full name
					</dt>
					<dd class="mt-1 font-medium text-slate-900 dark:text-white">
						{data.user?.user_metadata?.full_name ?? '—'}
					</dd>
				</div>
			</dl>
			{#snippet footer()}
				<form method="POST" action="?/signout">
					<Button type="submit" variant="ghost" size="sm">Sign out</Button>
				</form>
			{/snippet}
		</Card>

		<!-- SUBSCRIPTION ──────────────────────────────────────────────────── -->
		<Card>
			{#snippet header()}
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="text-base font-semibold tracking-tight">Subscription</h2>
						<p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
							Your current plan and next renewal.
						</p>
					</div>
					{#if data.tier}
						<Badge variant={data.tier === 'lifetime' ? 'lifetime' : 'pro'}>
							<Sparkles size="xs" />
							{data.tier}
						</Badge>
					{:else}
						<Badge variant="warning">Inactive</Badge>
					{/if}
				</div>
			{/snippet}

			{#if data.subscription}
				<dl class="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
							Status
						</dt>
						<dd class="mt-1 font-medium text-slate-900 dark:text-white capitalize">
							{data.subscription.status}
						</dd>
					</div>
					<div>
						<dt class="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
							{data.subscription.cancel_at_period_end ? 'Cancels' : 'Renews'}
						</dt>
						<dd class="mt-1 font-medium text-slate-900 dark:text-white">
							{formatDate(data.subscription.current_period_end)}
						</dd>
					</div>
				</dl>
			{:else}
				<p class="text-sm text-slate-600 dark:text-slate-400">
					You don't have an active subscription. Subscribe to unlock the full course.
				</p>
			{/if}

			{#if form?.error}
				<p class="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
					{form.error}
				</p>
			{/if}

			{#snippet footer()}
				<div class="flex flex-wrap gap-2">
					{#if data.hasStripeCustomer}
						<form method="POST" action="?/portal">
							<Button type="submit" variant="primary" size="sm">
								Open billing portal
								<ExternalLink size="sm" />
							</Button>
						</form>
					{:else}
						<Button href="/pricing" variant="primary" size="sm">See pricing</Button>
					{/if}
				</div>
			{/snippet}
		</Card>

		<!-- BILLING ───────────────────────────────────────────────────────── -->
		<Card>
			{#snippet header()}
				<div>
					<h2 class="text-base font-semibold tracking-tight">Billing</h2>
					<p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
						Payment methods and invoice history live in the Stripe portal.
					</p>
				</div>
			{/snippet}
			<p class="text-sm text-slate-600 dark:text-slate-400">
				{#if data.hasStripeCustomer}
					Update your card, switch plans, or download invoices via the billing portal.
				{:else}
					Once you subscribe, you'll be able to manage your payment method here.
				{/if}
			</p>
			{#snippet footer()}
				<div class="flex flex-wrap gap-2">
					{#if data.hasStripeCustomer}
						<form method="POST" action="?/portal">
							<Button type="submit" variant="outline" size="sm">
								Manage billing
								<ExternalLink size="sm" />
							</Button>
						</form>
					{:else}
						<Button href="/pricing" variant="outline" size="sm">See pricing</Button>
					{/if}
				</div>
			{/snippet}
		</Card>

		<!-- DELETE ACCOUNT ────────────────────────────────────────────────── -->
		<Card class="border-red-200/60 dark:border-red-900/40">
			{#snippet header()}
				<div>
					<h2 class="text-base font-semibold tracking-tight text-red-700 dark:text-red-400">
						Delete account
					</h2>
					<p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
						Permanently remove your account and all associated data.
					</p>
				</div>
			{/snippet}
			<p class="text-sm text-slate-600 dark:text-slate-400">
				Cancel any active subscription first via the billing portal. Contact support to proceed with deletion — this action is irreversible.
			</p>
			{#snippet footer()}
				<Button href="mailto:support@saas-pro.dev" variant="ghost" size="sm" class="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
					Contact support
				</Button>
			{/snippet}
		</Card>
	</div>
</section>
