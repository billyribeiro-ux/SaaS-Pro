<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type ModalProps = {
		/** Whether the modal is open. Two-way bound. */
		open: boolean;
		/** Heading shown at the top of the modal — used as the dialog's accessible name. */
		title: string;
		/** Optional supporting copy below the title. */
		description?: string;
		/** Stable id used to wire `aria-labelledby` / `aria-describedby`. */
		id: string;
		/** Body content (typically the action buttons + any extra detail). */
		children: Snippet;
		/** data-testid for the dialog element. */
		testid?: string;
	};
</script>

<script lang="ts">
	/**
	 * Native `<dialog>`-based modal.
	 *
	 * Uses `dialog.showModal()` so the browser does the right thing for
	 * us:
	 *   - Focus trap inside the dialog while open.
	 *   - Esc key closes (we listen and reset the bound `open` so
	 *     callers stay in sync).
	 *   - The page content underneath becomes inert.
	 *   - Backdrop is the ::backdrop pseudo-element — styled below.
	 *
	 * We deliberately do NOT roll our own focus management or
	 * keyboard handling. Native is shorter, more correct, and
	 * announces to screen readers without aria gymnastics.
	 *
	 * Why two-way bind `open`?
	 *   The user can dismiss via Esc or the cancel button — both
	 *   should propagate back to the parent's state so the next render
	 *   doesn't re-open the dialog. The `close` event from
	 *   <dialog> fires after either path.
	 */
	let { open = $bindable(false), title, description, id, children, testid }: ModalProps = $props();

	let dialog: HTMLDialogElement | null = $state(null);

	// Remember whatever element opened the modal so we can put focus
	// back there on close. Without this, a screen-reader user (and
	// every keyboard user) lands at <body> after Esc — disorienting,
	// and the WAI-ARIA Authoring Practices for dialogs explicitly
	// call this out as a requirement.
	let returnFocusTo: HTMLElement | null = null;

	// $derived so any future "modal id changes at runtime" use case
	// stays correct — also silences `state_referenced_locally`.
	const titleId = $derived(`${id}-title`);
	const descId = $derived(description ? `${id}-desc` : undefined);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			// Capture the element that triggered open *before* the
			// browser steals focus to the dialog.
			const active = document.activeElement;
			returnFocusTo = active instanceof HTMLElement ? active : null;
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	function handleClose() {
		// Esc / form-method=dialog cancellation — keep the prop in sync.
		open = false;
		// `requestAnimationFrame` so focus restoration happens after
		// the dialog has fully unwound. Calling `.focus()` synchronously
		// during the close handler is a no-op in some browsers.
		if (returnFocusTo) {
			const target = returnFocusTo;
			returnFocusTo = null;
			requestAnimationFrame(() => target.focus());
		}
	}

	/**
	 * Click on the backdrop = close. The trick: clicks on the visible
	 * dialog content bubble up with `event.target` set to the inner
	 * element. Backdrop clicks have `event.target === dialog`. We
	 * dismiss only in the second case.
	 */
	function handleBackdropClick(event: MouseEvent) {
		if (event.target === dialog) {
			open = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	{id}
	aria-labelledby={titleId}
	aria-describedby={descId}
	data-testid={testid}
	onclose={handleClose}
	onclick={handleBackdropClick}
	class="m-auto max-w-md rounded-lg p-0 backdrop:bg-slate-900/40"
>
	<div class="space-y-4 p-6">
		<header>
			<h2 id={titleId} class="text-lg font-semibold text-slate-900">
				{title}
			</h2>
			{#if description}
				<p id={descId} class="mt-1 text-sm text-slate-600">
					{description}
				</p>
			{/if}
		</header>
		{@render children()}
	</div>
</dialog>
