<script lang="ts" module>
	import type { Snippet } from 'svelte';

	/**
	 * `Field` wires up the accessibility plumbing for a labelled form
	 * control: a `<label for=...>` paired with the control by `id`, plus
	 * an error/hint paragraph linked via `aria-describedby` so screen
	 * readers announce the message when focus enters the input.
	 *
	 * The control itself is rendered via the `control` snippet, which
	 * receives back two attributes the input must spread:
	 *
	 *   - `id` (string) — same id the label points to
	 *   - `aria-describedby` (string | undefined) — set when there's an
	 *     error or hint to announce
	 *
	 * Usage:
	 *
	 *   <Field id="email" label="Email" error={$errors.email}>
	 *     {#snippet control({ id, describedBy })}
	 *       <Input
	 *         {id}
	 *         name="email"
	 *         type="email"
	 *         bind:value={$form.email}
	 *         invalid={!!$errors.email}
	 *         aria-describedby={describedBy}
	 *       />
	 *     {/snippet}
	 *   </Field>
	 *
	 * The control snippet pattern keeps Field neutral about which input
	 * primitive (Input, Select, Textarea, …) is used while still owning
	 * the id wiring.
	 */
	/**
	 * Superforms emits errors as either:
	 *
	 *   - `string[]` for primitive fields
	 *   - `{ _errors?: string[]; [key: string]: ... }` for nested
	 *     objects/arrays (Zod 4's "tree" error format)
	 *
	 * Field accepts the broadest shape and reduces it to a single
	 * displayable message internally — keeping callers from having to
	 * cast at every site.
	 */
	export type FieldErrorInput =
		| string
		| string[]
		| { _errors?: string[]; [key: string]: unknown }
		| undefined;

	export type FieldProps = {
		id: string;
		label: string;
		error?: FieldErrorInput;
		hint?: string;
		required?: boolean;
		class?: string;
		control: Snippet<[{ id: string; describedBy: string | undefined }]>;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import Label from './Label.svelte';

	let {
		id,
		label,
		error,
		hint,
		required = false,
		class: className,
		control
	}: FieldProps = $props();

	const errorId = $derived(error ? `${id}-error` : undefined);
	const hintId = $derived(hint ? `${id}-hint` : undefined);

	// `aria-describedby` accepts a space-separated list of ids. Error
	// first so it's announced before the hint when both are present.
	const describedBy = $derived([errorId, hintId].filter(Boolean).join(' ') || undefined);

	const errorMessage = $derived.by((): string | undefined => {
		if (!error) return undefined;
		if (typeof error === 'string') return error;
		if (Array.isArray(error)) return error[0];
		// Superforms tree-format: { _errors: string[] }. The first entry
		// is the most relevant ("Email is required" before "Enter a valid
		// email address" if both fire).
		if (typeof error === 'object' && Array.isArray(error._errors) && error._errors.length > 0) {
			return error._errors[0];
		}
		return undefined;
	});
</script>

<div class={cn('space-y-1', className)}>
	<Label for={id} {required}>{label}</Label>
	{@render control({ id, describedBy })}
	{#if errorMessage}
		<p id={errorId} class="text-sm text-red-600" role="alert">{errorMessage}</p>
	{:else if hint}
		<p id={hintId} class="text-xs text-slate-500">{hint}</p>
	{/if}
</div>
