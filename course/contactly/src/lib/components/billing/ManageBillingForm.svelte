<script lang="ts" module>
	import type { ButtonVariant } from '$lib/components/ui/Button.svelte';

	export type ManageBillingFormProps = {
		label?: string;
		variant?: ButtonVariant;
		testid?: string;
		fullWidth?: boolean;
		/** Optional override for the post-portal return path. Defaults to /account. */
		returnPath?: string;
	};
</script>

<script lang="ts">
	/**
	 * "Manage billing" — the symmetric sibling of UpgradeCheckoutForm.
	 *
	 * POSTs to /api/billing/portal which 303s the browser to the
	 * Stripe-hosted Customer Portal. From there the user can change
	 * plan (with proration), update payment method, download
	 * invoices, or cancel. They come back to `return_path` (default
	 * /account) when done.
	 *
	 * SAME UX SHAPE AS UPGRADE
	 * ------------------------
	 * - Plain HTML form; works without JS.
	 * - With JS, an internal `submitting` flag turns the button into
	 *   the Button primitive's loading state during the (typically
	 *   500-1500 ms) Stripe round-trip. Never reset to false — the
	 *   page navigates away on success.
	 * - data-testid plumbed through for Playwright assertions.
	 */
	import Button from '$lib/components/ui/Button.svelte';

	let {
		label = 'Manage billing',
		variant = 'secondary',
		testid,
		fullWidth = false,
		returnPath
	}: ManageBillingFormProps = $props();

	let submitting = $state(false);

	function onSubmit() {
		submitting = true;
	}
</script>

<form
	method="POST"
	action="/api/billing/portal"
	class={fullWidth ? 'w-full' : undefined}
	data-testid={testid}
	onsubmit={onSubmit}
>
	{#if returnPath}
		<input type="hidden" name="return_path" value={returnPath} />
	{/if}
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
