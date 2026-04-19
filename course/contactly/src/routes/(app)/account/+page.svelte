<script lang="ts">
	/**
	 * Account page — read-only view of the user's profile.
	 *
	 * Lesson 3.6 layers the edit actions (update name, change email,
	 * change password, delete account) on top of this. We deliberately
	 * land the read path in its own lesson so the database round-trip
	 * (server load → RLS → typed query → render) is the only new
	 * concept on the screen.
	 */
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const memberSince = $derived(
		new Date(data.profile.created_at).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		})
	);
</script>

<svelte:head>
	<title>Account — Contactly</title>
</svelte:head>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight text-slate-900">Account</h1>
		<p class="mt-2 text-sm text-slate-600">Your profile information.</p>
	</header>

	<section
		class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
		aria-labelledby="profile-heading"
	>
		<h2 id="profile-heading" class="text-lg font-semibold text-slate-900">Profile</h2>

		<dl class="mt-6 divide-y divide-slate-200" data-testid="account-profile">
			<div class="grid grid-cols-1 gap-1 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Full name</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="profile-full-name">
					{#if data.profile.full_name}
						{data.profile.full_name}
					{:else}
						<span class="text-slate-400 italic">Not set</span>
					{/if}
				</dd>
			</div>

			<div class="grid grid-cols-1 gap-1 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Email</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="profile-email">
					{data.profile.email}
				</dd>
			</div>

			<div class="grid grid-cols-1 gap-1 py-4 sm:grid-cols-3 sm:gap-4">
				<dt class="text-sm font-medium text-slate-500">Member since</dt>
				<dd class="text-sm text-slate-900 sm:col-span-2" data-testid="profile-member-since">
					{memberSince}
				</dd>
			</div>
		</dl>

		<!--
			Edit actions land in Lesson 3.6 (account actions). Stub
			here so the page communicates that the read view is
			intentionally read-only for now, not "we forgot the
			buttons".
		-->
		<p class="mt-6 text-xs text-slate-500">
			Editing your profile, changing your password, and deleting your account land in
			<strong>Lesson 3.6</strong>.
		</p>
	</section>
</div>
