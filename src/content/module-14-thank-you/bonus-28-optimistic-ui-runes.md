---
title: 'Bonus: Optimistic UI with Svelte 5 Runes'
module: 14
lesson: 28
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-28-optimistic-ui-runes'
description: 'Make every interaction feel instant. Use Svelte 5 runes ($state, $derived) and SvelteKit form enhancements to apply optimistic updates, reconcile with the server, and roll back gracefully on failure.'
duration: 25
preview: false
---

# Bonus: Optimistic UI with Svelte 5 runes

A button that feels slow loses trust. The fix isn't faster servers — it's lying to the user (truthfully). Render the change immediately, send the request in the background, reconcile when it lands. If the server disagrees, gracefully roll back.

This pattern was painful in older Svelte. With **runes** (`$state`, `$derived`, `$effect`) it's almost free.

By the end you will:

- Build an optimistic delete on the contacts list with rollback.
- Build an optimistic create with a temporary ID that's swapped for the real one.
- Wire `use:enhance` on a SvelteKit form so the optimistic update fires _before_ the network round-trip.
- Handle three classes of error: validation failure, network failure, conflict.
- Add a "Saving…" badge during in-flight requests without flicker.

## 1. The pattern

Three steps:

1. **Predict.** Apply the change locally. Mark the row as "pending."
2. **Send.** Fire the request.
3. **Reconcile.** On success, replace the optimistic row with the server's canonical version. On failure, roll back and show an error toast.

The hard part isn't the UI — it's keeping local and server state from diverging.

## 2. Setup: a contacts store with runes

`src/lib/state/contacts.svelte.ts`:

```ts
import type { Contact } from '$lib/types';

class ContactsStore {
	contacts = $state<Contact[]>([]);
	pendingIds = $state(new Set<string>());

	hydrate(initial: Contact[]) {
		this.contacts = initial;
	}

	get visible(): Contact[] {
		return this.contacts;
	}

	isPending(id: string): boolean {
		return this.pendingIds.has(id);
	}

	optimisticDelete(id: string): { rollback: () => void } {
		const before = [...this.contacts];
		this.contacts = this.contacts.filter((c) => c.id !== id);
		return { rollback: () => (this.contacts = before) };
	}

	optimisticCreate(draft: Omit<Contact, 'id'>): { tempId: string; rollback: () => void } {
		const tempId = `temp-${crypto.randomUUID()}`;
		const optimistic: Contact = { id: tempId, ...draft };
		this.contacts = [optimistic, ...this.contacts];
		this.pendingIds.add(tempId);
		return {
			tempId,
			rollback: () => {
				this.contacts = this.contacts.filter((c) => c.id !== tempId);
				this.pendingIds.delete(tempId);
			}
		};
	}

	confirmCreate(tempId: string, real: Contact) {
		this.contacts = this.contacts.map((c) => (c.id === tempId ? real : c));
		this.pendingIds.delete(tempId);
	}
}

export const contactsStore = new ContactsStore();
```

`$state` makes mutations reactive. Every component that reads `contactsStore.contacts` re-renders when we reassign it.

## 3. Hydrate from `+page.server.ts`

`/contacts/+page.svelte`:

```svelte
<script lang="ts">
	import { contactsStore } from '$lib/state/contacts.svelte';

	let { data } = $props();

	$effect(() => {
		contactsStore.hydrate(data.contacts);
	});
</script>

<ul>
	{#each contactsStore.visible as contact (contact.id)}
		<ContactRow {contact} pending={contactsStore.isPending(contact.id)} />
	{/each}
</ul>
```

`$effect` re-hydrates whenever `data.contacts` changes (e.g. after `invalidate`). Use a sentinel if you want to avoid stomping local-only optimistic state on re-hydration.

## 4. Optimistic delete with `use:enhance`

The form action stays unchanged on the server — same `?/delete` action you wrote in Module 4. The change is purely client-side.

`ContactRow.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { contactsStore } from '$lib/state/contacts.svelte';
	import { toast } from '$lib/state/toast.svelte';
	import type { Contact } from '$lib/types';

	let { contact, pending = false }: { contact: Contact; pending?: boolean } = $props();
</script>

<li class:pending>
	<span>{contact.name}</span>

	<form
		method="POST"
		action="?/delete"
		use:enhance={() => {
			const { rollback } = contactsStore.optimisticDelete(contact.id);

			return async ({ result, update }) => {
				if (result.type === 'failure' || result.type === 'error') {
					rollback();
					toast.error('Could not delete. Restored.');
					return;
				}
				await update({ reset: false, invalidateAll: false });
				toast.success('Deleted.');
			};
		}}
	>
		<input type="hidden" name="id" value={contact.id} />
		<button type="submit" disabled={pending}>Delete</button>
	</form>
</li>

<style>
	.pending {
		opacity: 0.5;
	}
</style>
```

The optimistic update fires inside the `use:enhance` callback, which runs **before** the network request. The user sees the row vanish instantly. If the server returns a failure (RLS denied, network died), `rollback()` puts it back.

We pass `invalidateAll: false` because we don't want SvelteKit to refetch and overwrite our store. The optimistic update _is_ the new state.

## 5. Optimistic create

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { contactsStore } from '$lib/state/contacts.svelte';
	import { toast } from '$lib/state/toast.svelte';

	let name = $state('');
	let email = $state('');
</script>

<form
	method="POST"
	action="?/create"
	use:enhance={({ formData }) => {
		const draft = {
			name: String(formData.get('name') ?? ''),
			email: String(formData.get('email') ?? ''),
			created_at: new Date().toISOString()
		};
		const { tempId, rollback } = contactsStore.optimisticCreate(draft);
		const oldName = name;
		const oldEmail = email;
		name = '';
		email = '';

		return async ({ result }) => {
			if (result.type !== 'success' || !result.data?.contact) {
				rollback();
				name = oldName;
				email = oldEmail;
				toast.error('Could not create. Try again.');
				return;
			}
			contactsStore.confirmCreate(tempId, result.data.contact);
			toast.success('Created.');
		};
	}}
>
	<input name="name" bind:value={name} required />
	<input name="email" bind:value={email} type="email" required />
	<button type="submit">Add</button>
</form>
```

The server returns the created contact (with a real DB-generated `id`). `confirmCreate` swaps the temp row for it. To the user, the row was always there.

The form action returns the contact in its success payload:

```ts
export const actions = {
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const { data: contact, error } = await locals.supabase
			.from('contacts')
			.insert({ name: String(data.get('name')), email: String(data.get('email')) })
			.select()
			.single();
		if (error) return fail(400, { error: error.message });
		return { contact };
	}
};
```

## 6. The three failure modes

**Validation failure** (400 from server, e.g. duplicate email): rollback + toast with the server's message. The form repopulates with the old values.

**Network failure** (`result.type === 'error'`): rollback + toast "You appear to be offline. Try again." Optionally retry once with a 2s delay.

**Conflict** (server state has changed since you predicted): rare for simple CRUD, common for collaborative editing. Reconcile by accepting server state and showing "Refreshed" toast.

## 7. The "Saving…" badge

For long-running operations (e.g. sending a transactional email), show a subtle indicator without flickering on fast requests:

```svelte
<script lang="ts">
	let isSubmitting = $state(false);
	let showSaving = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (isSubmitting) {
			timer = setTimeout(() => (showSaving = true), 200);
		} else {
			if (timer) clearTimeout(timer);
			showSaving = false;
		}
	});
</script>

{#if showSaving}<span class="saving">Saving…</span>{/if}
```

The 200ms threshold prevents flicker for sub-200ms requests.

## 8. Tests

Two tracks:

**Unit (vitest):**

- `optimisticDelete` removes the row, rollback restores it.
- `optimisticCreate` adds a temp row + tracks pending.
- `confirmCreate` swaps temp for real.

**E2E (Playwright):**

- Click delete → row vanishes instantly (assert before network response settles).
- Force a 500 from the server → row reappears, error toast shown.

## 9. Acceptance checklist

- [ ] `contactsStore` with `$state` and optimistic helpers.
- [ ] `optimisticDelete` returns a rollback function.
- [ ] `optimisticCreate` returns `{ tempId, rollback }`; `confirmCreate` swaps in the server-canonical row.
- [ ] `use:enhance` callbacks call optimistic helpers _before_ awaiting result.
- [ ] `invalidateAll: false` so the store isn't stomped.
- [ ] Three failure modes (validation, network, conflict) all rollback + toast.
- [ ] "Saving…" badge has a 200ms threshold to avoid flicker.

## What's next

Bonus 29 schedules background work via **Vercel Cron Jobs** — daily subscription reconciliation, weekly digest emails, monthly invoices reminders. All without leaving Vercel.
