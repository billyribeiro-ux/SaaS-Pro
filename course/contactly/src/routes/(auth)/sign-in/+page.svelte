<script lang="ts">
	/**
	 * Sign-in page — password + magic link on the same screen.
	 *
	 * Design choices:
	 *   - Two TRUE forms (one per mode), each backed by its own
	 *     Superforms instance. Switching mode toggles which `<form>`
	 *     is in the DOM. We use a small `$state` to remember the email
	 *     across the toggle so the user doesn't have to retype it.
	 *   - Mode lives in URL state? We deliberately keep it client-only.
	 *     This avoids back-button surprises ("I navigated away and now
	 *     it's a different mode") and keeps the route table simple.
	 *   - Tabs are <button role="tab"> driven, with full keyboard
	 *     support (left/right arrows, home/end). Standards-compliant
	 *     tablist pattern — important because this is the first
	 *     auth surface a screen reader user touches.
	 */
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import { signInWithMagicLinkSchema, signInWithPasswordSchema } from '$lib/schemas/auth';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Field from '$lib/components/ui/Field.svelte';

	let { data }: PageProps = $props();

	type Mode = 'password' | 'magic';
	let mode: Mode = $state('password');

	// Shared email — when the user types it in one mode and toggles, we
	// don't want them retyping. Two-way bound into both Superforms
	// `$form.email` via `$effect`s below. We read `data.*Form.data.email`
	// once at init (the value the load function shipped) and own the
	// state from there; the explicit `state_referenced_locally` ignore
	// captures that intent — Svelte's warning is structural, not a bug.
	// svelte-ignore state_referenced_locally
	let sharedEmail = $state(data.passwordForm.data.email || data.magicForm.data.email || '');

	// svelte-ignore state_referenced_locally
	const passwordSF = superForm(data.passwordForm, {
		id: 'password',
		validators: zod4Client(signInWithPasswordSchema),
		delayMs: 350,
		autoFocusOnError: 'detect'
	});
	const {
		form: passwordValues,
		errors: passwordErrors,
		message: passwordMessage,
		enhance: passwordEnhance,
		delayed: passwordDelayed,
		submitting: passwordSubmitting
	} = passwordSF;

	// svelte-ignore state_referenced_locally
	const magicSF = superForm(data.magicForm, {
		id: 'magic',
		validators: zod4Client(signInWithMagicLinkSchema),
		delayMs: 350,
		autoFocusOnError: 'detect'
	});
	const {
		form: magicValues,
		errors: magicErrors,
		message: magicMessage,
		enhance: magicEnhance,
		delayed: magicDelayed,
		submitting: magicSubmitting
	} = magicSF;

	// Keep the two forms' email in sync via the shared state. Each
	// effect is one-directional (state → form), with the change handler
	// on the input writing back to state. This avoids the classic
	// "two-way bind to two forms" effect-loop where each form notifies
	// the other and we ping-pong forever.
	$effect(() => {
		$passwordValues.email = sharedEmail;
	});
	$effect(() => {
		$magicValues.email = sharedEmail;
	});

	// Tabs: keyboard navigation per WAI-ARIA Authoring Practices.
	function onTabKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			event.preventDefault();
			mode = mode === 'password' ? 'magic' : 'password';
		} else if (event.key === 'Home') {
			event.preventDefault();
			mode = 'password';
		} else if (event.key === 'End') {
			event.preventDefault();
			mode = 'magic';
		}
	}
</script>

<svelte:head>
	<title>Sign in — Contactly</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">Welcome back</h1>
		<p class="mt-2 text-sm text-slate-600">
			Don't have an account?
			<a href={resolve('/sign-up')} class="text-brand-700 hover:text-brand-600 font-medium"
				>Create one</a
			>
		</p>
	</div>

	<!--
		Tablist controls which form is mounted below. role="tablist" /
		role="tab" / role="tabpanel" wires the screen-reader semantics
		so non-sighted users hear "Password tab, 1 of 2, selected".
	-->
	<!--
		`tabindex={-1}` on the tablist itself satisfies the WAI-ARIA
		"interactive role must accept focus" rule. The buttons inside
		are the real focus targets; the container only catches the
		`keydown` for arrow-key tab switching.
	-->
	<div
		role="tablist"
		aria-label="Sign-in method"
		class="grid grid-cols-2 rounded-md border border-slate-200 bg-slate-50 p-1 text-sm font-medium"
		tabindex={-1}
		onkeydown={onTabKeydown}
	>
		<button
			type="button"
			role="tab"
			id="tab-password"
			aria-selected={mode === 'password'}
			aria-controls="panel-password"
			tabindex={mode === 'password' ? 0 : -1}
			class="rounded px-3 py-2 transition-colors {mode === 'password'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			onclick={() => (mode = 'password')}
			data-testid="tab-password"
		>
			Password
		</button>
		<button
			type="button"
			role="tab"
			id="tab-magic"
			aria-selected={mode === 'magic'}
			aria-controls="panel-magic"
			tabindex={mode === 'magic' ? 0 : -1}
			class="rounded px-3 py-2 transition-colors {mode === 'magic'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			onclick={() => (mode = 'magic')}
			data-testid="tab-magic"
		>
			Magic link
		</button>
	</div>

	{#if mode === 'password'}
		<div id="panel-password" role="tabpanel" aria-labelledby="tab-password" class="space-y-4">
			{#if $passwordMessage}
				<div
					class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
					role="alert"
				>
					{$passwordMessage}
				</div>
			{/if}

			<form
				method="POST"
				action="?/password"
				use:passwordEnhance
				class="space-y-4"
				data-testid="sign-in-password-form"
			>
				<Field id="password-email" label="Email" required error={$passwordErrors.email}>
					{#snippet control({ id, describedBy })}
						<Input
							{id}
							name="email"
							type="email"
							autocomplete="email"
							required
							bind:value={sharedEmail}
							invalid={!!$passwordErrors.email}
							aria-describedby={describedBy}
						/>
					{/snippet}
				</Field>

				<Field id="password-password" label="Password" required error={$passwordErrors.password}>
					{#snippet control({ id, describedBy })}
						<Input
							{id}
							name="password"
							type="password"
							autocomplete="current-password"
							required
							bind:value={$passwordValues.password}
							invalid={!!$passwordErrors.password}
							aria-describedby={describedBy}
						/>
					{/snippet}
				</Field>

				<div class="flex items-center justify-end">
					<a
						href={resolve('/forgot-password')}
						class="text-brand-700 hover:text-brand-600 text-sm font-medium"
					>
						Forgot password?
					</a>
				</div>

				<Button
					type="submit"
					variant="primary"
					class="w-full"
					loading={$passwordDelayed}
					disabled={$passwordSubmitting}
				>
					{$passwordDelayed ? 'Signing in…' : 'Sign in'}
				</Button>
			</form>
		</div>
	{:else}
		<div id="panel-magic" role="tabpanel" aria-labelledby="tab-magic" class="space-y-4">
			{#if $magicMessage}
				<div
					class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
					role="alert"
				>
					{$magicMessage}
				</div>
			{/if}

			<p class="text-sm text-slate-600">
				We'll email you a one-time link. Click it to sign in — no password needed.
			</p>

			<form
				method="POST"
				action="?/magic"
				use:magicEnhance
				class="space-y-4"
				data-testid="sign-in-magic-form"
			>
				<Field id="magic-email" label="Email" required error={$magicErrors.email}>
					{#snippet control({ id, describedBy })}
						<Input
							{id}
							name="email"
							type="email"
							autocomplete="email"
							required
							bind:value={sharedEmail}
							invalid={!!$magicErrors.email}
							aria-describedby={describedBy}
						/>
					{/snippet}
				</Field>

				<Button
					type="submit"
					variant="primary"
					class="w-full"
					loading={$magicDelayed}
					disabled={$magicSubmitting}
				>
					{$magicDelayed ? 'Sending link…' : 'Email me a sign-in link'}
				</Button>
			</form>
		</div>
	{/if}
</div>
