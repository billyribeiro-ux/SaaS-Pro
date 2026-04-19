<script lang="ts" module>
	import type { LookupKey } from '$lib/billing/lookup-keys';
	import type { ButtonVariant } from '$lib/components/ui/Button.svelte';

	export type UpgradeCheckoutFormProps = {
		lookupKey: LookupKey;
		label?: string;
		variant?: ButtonVariant;
		fullWidth?: boolean;
		testid?: string;
		/** Optional override for where the form posts. Defaults to /api/billing/checkout. */
		action?: string;
	};
</script>

<script lang="ts">
	/**
	 * The reusable "open Stripe Checkout" form.
	 *
	 * One UI affordance, three callers (pricing card, account upgrade
	 * button, contacts cap banner — see Lesson 9.2). Centralizing it
	 * here means the wire-protocol and the loading UX are the same
	 * everywhere a user buys a subscription.
	 *
	 * SHAPE
	 * -----
	 *   <form method="POST" action="/api/billing/checkout">
	 *     <input type="hidden" name="lookup_key" value="contactly_pro_yearly">
	 *     <button type="submit">Start 14-day trial</button>
	 *   </form>
	 *
	 * No JS required — the form posts the old-fashioned way and the
	 * browser follows the 303 to Stripe-hosted Checkout. With JS we
	 * upgrade the experience: a `submitting` flag turns the button
	 * into the Button primitive's loading state so the user knows
	 * SOMETHING is happening across the round-trip to Stripe (which
	 * can be 800–2000 ms in the wild).
	 *
	 * The data-attributes (`data-lookup-key`, `data-testid`) make
	 * playwright assertions tight without coupling tests to the
	 * exact rendered label.
	 */
	import Button from '$lib/components/ui/Button.svelte';

	let {
		lookupKey,
		label = 'Start 14-day trial',
		variant = 'primary',
		fullWidth = true,
		testid,
		action = '/api/billing/checkout'
	}: UpgradeCheckoutFormProps = $props();

	// Track submission state so the button can spin during the
	// Stripe round-trip. Toggled true on submit and never back to
	// false within this component — the page navigates away on
	// success, so a leftover spinner is fine and avoids the trap of
	// flashing back to "idle" right before the redirect.
	let submitting = $state(false);

	function onSubmit() {
		submitting = true;
	}
</script>

<form
	method="POST"
	{action}
	class={fullWidth ? 'w-full' : undefined}
	data-testid={testid}
	data-lookup-key={lookupKey}
	onsubmit={onSubmit}
>
	<input type="hidden" name="lookup_key" value={lookupKey} />
	<Button
		type="submit"
		{variant}
		size="md"
		loading={submitting}
		disabled={submitting}
		class={fullWidth ? 'w-full' : undefined}
	>
		{label}
	</Button>
</form>
