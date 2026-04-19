---
title: '4.7 - Deleting Contacts'
module: 4
lesson: 7
moduleSlug: 'module-04-crud'
lessonSlug: '07-deleting-contacts'
description: 'Implement contact deletion with a confirmation modal to prevent accidental deletes.'
duration: 10
preview: false
---

## Overview

Deleting things is the most dangerous verb in a CRUD app. Create, Read, Update — all reversible. Forgot a field on an update? Edit it again. Created the wrong record? Delete it. But **Delete** is a one-way door. Once the row is gone, it's gone. No undo. No "oops, let me fix that." The user's data has left the building.

A well-built delete flow accepts that reality and builds guardrails. You don't wire a trash can button directly to a SQL `DELETE` and call it a day. You stop and ask, "Are you sure?" You make the destructive button visually distinct (red, on the right, isolated). You enforce that the user clicked it deliberately — not that they bumped it while scrolling, not that they misread the label. And on the server, you enforce that they own the row they're trying to delete, because even a user with the best intentions shouldn't be able to delete someone else's data through a cleverly crafted request.

In this lesson you'll build two things: a **server-side delete action** that's narrow, safe, and authenticated; and a **confirmation modal** that makes the user commit before the deletion fires. By the end, the contact list has a Delete button on every row that pops up a confirmation dialog and, on confirmation, removes the contact permanently.

## Prerequisites

- Lessons 4.1–4.6 complete — you have a `contacts` table with RLS policies, a contacts list at `/contacts`, a create flow, and an edit flow.
- You understand SvelteKit form actions from Module 3.
- You understand Svelte 5 runes (`$state`, `$props`, `$bindable`) from earlier lessons.

## What You'll Build

- A `deleteContact` named action in `src/routes/(app)/contacts/+page.server.ts` — authenticates the user, reads the contact ID from the form, and deletes the row with a defense-in-depth `user_id` filter.
- A `DeleteConfirmModal.svelte` component in `src/lib/components/ui/` — a centered dialog with a backdrop, a contact name preview, and Cancel/Delete buttons.
- An understanding of why this flow uses POST (not HTTP DELETE), progressive enhancement, and double row-ownership filtering.

In Lesson 4.7.1 (the next one) we'll wire up the modal open/close state on the parent page. This lesson is about the delete machinery itself.

---

## Why Delete Needs Confirmation

Not every action needs a confirmation step. "Add a contact" doesn't — it's constructive, reversible, and mostly harmless if you do it by accident. "Delete a contact" is different:

1. **It's irreversible.** No "Restore from trash" button. The row is gone from the database. If the user wanted to keep that contact, there's nothing you can do.
2. **Buttons get clicked by accident.** Trackpads misfire. Users click a row, hover over the actions column, and their finger hits the wrong icon. Mobile users tap a button they didn't mean to. A delete that fires on one click is a ticking bug.
3. **Trust is on the line.** Users who lose data because of a confusing UI stop trusting the software. Good confirmation flows signal "we take your data seriously" without slowing people down.

The industry-standard pattern — modal confirmation — strikes a balance. It's one extra click, not a long typed phrase. It gives the user time to reconsider without making the flow feel burdensome. It's predictable: every modern app does it this way, so users know what to expect.

For truly critical deletes (deleting an entire account, a production database, a GitHub repository), the stakes are higher and the friction should be higher too: "type the name of this resource to confirm." But for individual records in a CRUD app, a simple "Are you sure?" modal is the right dose of friction. Nothing more, nothing less.

---

## Step 1: The Server-Side Delete Action

The delete happens on the server. Let's add a **named action** called `deleteContact` to the contacts page's server file. If your `src/routes/(app)/contacts/+page.server.ts` already has a `load` function and maybe a `createContact` action from earlier lessons, we're adding to it — not replacing.

Open `src/routes/(app)/contacts/+page.server.ts` and add the `deleteContact` action to the exported `actions` object:

```typescript
// src/routes/(app)/contacts/+page.server.ts
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	// ... your existing createContact action here ...

	deleteContact: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Unauthorized');

		const formData = await request.formData();
		const id = formData.get('id');

		if (!id || typeof id !== 'string') {
			return fail(400, { error: 'Contact ID is required' });
		}

		const { error: deleteError } = await locals.supabase
			.from('contacts')
			.delete()
			.eq('id', id)
			.eq('user_id', user.id);

		if (deleteError) return fail(500, { error: 'Failed to delete contact' });

		return { success: true };
	}
};
```

Let's walk through every line.

### Named actions — how SvelteKit dispatches them

When a form POSTs to `?/deleteContact`, SvelteKit looks in the `actions` object exported from `+page.server.ts` and calls the function under the key `deleteContact`. If the key doesn't exist, you get a 404 from SvelteKit.

The `default` action is the one that runs when the form has no `action` attribute (like `<form method="POST" use:enhance>`). Named actions are how you put multiple forms on the same page — one might POST to `?/createContact`, another to `?/deleteContact`, another to `?/archiveContact`. Each lands on its own function.

Our modal's delete form uses `action="?/deleteContact"` (you'll see this in Step 2), which maps to this function.

### Line-by-line walkthrough

```typescript
const user = await locals.getUser();
if (!user) error(401, 'Unauthorized');
```

**Always verify identity first.** `locals.getUser()` hits Supabase to validate the session cookie against the auth server, returning either the user or `null`. We **never** use `locals.getSession()` here (remember from Module 3: `getSession` trusts the cookie blindly, `getUser` verifies).

If there's no user, we throw a `401 Unauthorized` using `error()` from `@sveltejs/kit`. `error()` terminates execution — nothing after it runs. The client gets an error response and (via SvelteKit's error handling) redirects to the login page or shows an error banner.

You might wonder: "But the `(app)` layout guard already requires auth — why check again?" Three reasons:

1. **Defense-in-depth.** Belt AND suspenders. If someone ever removes the layout guard, this check still blocks unauthorized deletes.
2. **We need the user object anyway.** We use `user.id` in the query below. Fetching it here is free (remember, it's memoized per-request from Module 3).
3. **Form actions can be called from places that skip layouts.** SvelteKit's design generally ensures layout loads fire, but the defense-in-depth habit is worth keeping.

```typescript
const formData = await request.formData();
const id = formData.get('id');
```

`request.formData()` returns a `FormData` object containing every field in the submitted form. `formData.get('id')` returns the value of the hidden input named `id` from the modal's form (we'll see it in Step 2). The value type is `FormDataEntryValue | null` — either a string, a `File` object, or null if the field is missing.

```typescript
if (!id || typeof id !== 'string') {
	return fail(400, { error: 'Contact ID is required' });
}
```

Two checks in one:

- `!id` covers missing values and empty strings (`''` is falsy).
- `typeof id !== 'string'` covers the case where someone submitted a file where we expected text.

If either fails, we `fail(400, ...)` — return a 400 Bad Request with a clear error message. `fail()` lets the page re-render with the error, rather than throwing a 500 or doing something unexpected.

This little check is also a **TypeScript narrowing** — after it, TypeScript knows `id` is a `string`, not `FormDataEntryValue`, so the `.eq('id', id)` call below type-checks cleanly.

```typescript
const { error: deleteError } = await locals.supabase
	.from('contacts')
	.delete()
	.eq('id', id)
	.eq('user_id', user.id);
```

This is the delete itself. Two things to notice:

- **`locals.supabase`, not `supabaseAdmin`.** This is a user action on their own data — the user client is correct. RLS will enforce that they can only touch their own rows, even if we made a logic mistake.
- **The double `.eq()` filter — the defense-in-depth pattern.** `.eq('id', id)` targets the specific contact. `.eq('user_id', user.id)` ensures the contact belongs to the logged-in user. The second filter is technically redundant — RLS already does the same check — but we include it anyway.

**Why redundant filters?** If someone (maybe a future developer, maybe you in six months) disables RLS for debugging and forgets to turn it back on, this explicit `user_id` filter still keeps deletes scoped to the owner. It's another layer of defense that costs one extra line of code.

We also destructure `error` out of the response and rename it to `deleteError` via `{ error: deleteError }` — because `error` (from `@sveltejs/kit`) is already imported at the top of the file. Two names, no shadowing.

```typescript
if (deleteError) return fail(500, { error: 'Failed to delete contact' });
```

If Supabase returned an error (network glitch, database unavailable, RLS rejected the query because the user_id didn't match), we `fail(500, ...)`. We intentionally return a **generic** error message, not the raw `deleteError.message`. Why? Because database error messages can leak schema details useful to attackers ("relation 'users' does not exist", "column 'email' violates check constraint"). Generic messages keep the attack surface small. Log the real error on the server (we'll add logging in Module 11) while showing users a safe summary.

```typescript
return { success: true };
```

A successful return. SvelteKit passes this to the page's `form` prop, so the client can display "Contact deleted" or reset UI. We don't redirect — we're already on the contacts list page, and `use:enhance` will automatically re-run the `load` function and refresh the list.

### Why `user_id` MUST come from `locals.getUser()`, never from form input

There's a tempting but horrifying version of this action where `user_id` comes from form data:

```typescript
// ❌ CATASTROPHIC
const userId = formData.get('user_id');
await locals.supabase.from('contacts').delete().eq('id', id).eq('user_id', userId);
```

An attacker can submit **any** `user_id` they like. Combined with RLS being lenient (or a misconfiguration), they could delete other users' contacts. Even if RLS catches the violation, you've made it possible to probe — returning 200 vs 403 tells the attacker whose data they almost touched.

The rule is absolute: **`user_id` comes from the verified session, never from form input.** `locals.getUser()` is the trusted source. Form input is untrusted. Always.

---

## Step 2: The Confirmation Modal

Create `src/lib/components/ui/DeleteConfirmModal.svelte`:

```svelte
<!-- src/lib/components/ui/DeleteConfirmModal.svelte -->
<script lang="ts">
	interface Props {
		open: boolean;
		contactName: string;
		contactId: string;
		onclose: () => void;
	}

	let { open = $bindable(), contactName, contactId, onclose }: Props = $props();
</script>

{#if open}
	<div
		class="fixed inset-0 z-40 bg-black/50"
		role="button"
		tabindex="0"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	></div>

	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div
			class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-modal-title"
		>
			<h2 id="delete-modal-title" class="mb-2 text-lg font-semibold text-gray-900">
				Delete contact
			</h2>
			<p class="mb-6 text-gray-600">
				Are you sure you want to delete <strong>{contactName}</strong>? This cannot be undone.
			</p>

			<div class="flex justify-end gap-3">
				<button
					type="button"
					onclick={onclose}
					class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
				>
					Cancel
				</button>

				<form method="POST" action="?/deleteContact">
					<input type="hidden" name="id" value={contactId} />
					<button
						type="submit"
						class="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
					>
						Delete
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
```

Now let's dissect every piece.

### The props interface

```typescript
interface Props {
	open: boolean;
	contactName: string;
	contactId: string;
	onclose: () => void;
}

let { open = $bindable(), contactName, contactId, onclose }: Props = $props();
```

Four props:

- **`open`** — whether the modal is showing. We'll see `$bindable()` in detail in Lesson 4.7.1; for now, it means the parent can pass `bind:open={...}` and the modal can mutate it back.
- **`contactName`** — the display name to show in the confirmation text ("Are you sure you want to delete **Alice Johnson**?").
- **`contactId`** — the UUID we'll submit in the hidden form field.
- **`onclose`** — a callback the modal invokes when the user cancels or presses Escape.

The `interface Props` + `$props()` pattern is the idiomatic way to type Svelte 5 component props. It gives you IntelliSense, compile-time checks against wrong prop names, and keeps the type definition close to the destructuring.

### The conditional rendering

```svelte
{#if open}
	<!-- entire modal DOM only exists when open is true -->
{/if}
```

When `open` is `false`, nothing in the modal exists in the DOM. No hidden-but-present div, no `display: none`. This has two benefits:

1. **Accessibility.** Screen readers don't encounter an invisible-but-present dialog and get confused.
2. **Keyboard navigation.** Tab order doesn't skip through hidden elements.

When `open` flips to `true`, Svelte mounts the entire block. When it flips back to `false`, Svelte unmounts it. Clean and simple.

### The backdrop

```svelte
<div
	class="fixed inset-0 z-40 bg-black/50"
	role="button"
	tabindex="0"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
></div>
```

- **`fixed inset-0`** — Tailwind utilities that position the div `fixed` (relative to the viewport) with `top: 0; right: 0; bottom: 0; left: 0`. It covers the entire screen.
- **`bg-black/50`** — black background at 50% opacity. The `/50` modifier is Tailwind's alpha syntax.
- **`z-40`** — stacking context, slightly below the modal card.
- **`role="button"`** — tells assistive tech this element is interactive.
- **`tabindex="0"`** — makes the div focusable via keyboard (without tabindex, divs are skipped by Tab). This lets the Escape key handler receive keyboard events.
- **`onclick={onclose}`** — clicking the backdrop calls `onclose`, which the parent uses to set `open` to false.
- **`onkeydown={(e) => e.key === 'Escape' && onclose()}`** — pressing Escape while the backdrop has focus calls `onclose` too.

Clicking outside the modal to dismiss is a near-universal convention. Escape to close is equally universal. Both are wired here.

### The modal card

```svelte
<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
	<div
		class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
		role="dialog"
		aria-modal="true"
		aria-labelledby="delete-modal-title"
	>
		...
	</div>
</div>
```

An outer wrapper fills the viewport (`fixed inset-0`), uses flexbox to center its child horizontally and vertically (`flex items-center justify-center`), and keeps `z-50` so the card floats above the backdrop (`z-40`).

The inner card is the actual dialog. Three ARIA attributes make it accessible:

- **`role="dialog"`** — tells screen readers this is a dialog, not regular page content.
- **`aria-modal="true"`** — tells assistive tech that interactions should be focused here; the rest of the page is "modal" (blocked).
- **`aria-labelledby="delete-modal-title"`** — points to the `h2` with `id="delete-modal-title"`, which becomes the dialog's accessible name when announced.

### The content and buttons

```svelte
<h2 id="delete-modal-title" class="mb-2 text-lg font-semibold text-gray-900">Delete contact</h2>
<p class="mb-6 text-gray-600">
	Are you sure you want to delete <strong>{contactName}</strong>? This cannot be undone.
</p>
```

The title and body. `{contactName}` is interpolated so the user sees "Are you sure you want to delete **Alice Johnson**?" — explicit is better than "Are you sure?" alone, which doesn't tell them which contact they're about to remove.

```svelte
<div class="flex justify-end gap-3">
	<button
		type="button"
		onclick={onclose}
		class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
	>
		Cancel
	</button>

	<form method="POST" action="?/deleteContact">
		<input type="hidden" name="id" value={contactId} />
		<button
			type="submit"
			class="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
		>
			Delete
		</button>
	</form>
</div>
```

Two buttons, side by side, justified to the right of the modal:

- **Cancel** — `type="button"` (so it doesn't submit any surrounding form), gray background. Calls `onclose` to dismiss.
- **Delete** — wrapped in its **own** `<form>` element. Red background (destructive action visually distinct). `type="submit"` kicks off the form submission.

Two things are subtle here.

**Why wrap the Delete button in a form element?** Because the form is how we trigger the server-side action. The form has:

- `method="POST"` — we've seen this in every action so far; SvelteKit only handles non-GET requests as actions.
- `action="?/deleteContact"` — maps to the `deleteContact` function in our actions object.
- A hidden input `<input type="hidden" name="id" value={contactId} />` — this is how we pass the contact ID to the server. No JavaScript involved.

**Why Cancel on the left, Delete on the right?** Convention: destructive actions go on the right, in red. Users' muscle memory expects this, so placing them reversed (or using the same color for both) creates mistakes.

### Why form action (not `fetch DELETE`)?

A common instinct from other frameworks is to write:

```javascript
// ❌ not our approach
const response = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
```

We don't do that. Instead we use a plain form POST. Three reasons:

1. **Progressive enhancement.** A form POST works even if JavaScript fails to load. The user sees a slightly less smooth experience (full page reload instead of in-place update), but the delete still succeeds. A `fetch DELETE` breaks entirely without JS.
2. **CSRF protection.** SvelteKit's form actions are CSRF-protected by default — the framework verifies the Origin header and ensures the request came from your own page. Using `fetch` you'd need to re-implement this yourself.
3. **Simpler code.** No client-side state management for request lifecycle. No JSON serialization. Just HTML submitting itself.

### Why we don't use HTTP DELETE method

```svelte
<!-- ❌ browsers don't natively support this -->
<form method="DELETE">
```

HTML forms natively support only `GET` and `POST`. Browsers ignore `method="DELETE"` or `method="PUT"` and fall back to GET. SvelteKit lets you simulate these via JavaScript, but doing so defeats the point of having a no-JS fallback. **POST is the universal fallback**; everyone supports it; it works everywhere; don't overthink it.

REST purists might wince at POST for a delete, but we're not building a REST API here — we're using SvelteKit's form-action model, which has its own conventions. The "method" at the form level is just a transport; the named action (`deleteContact`) describes the semantic intent.

---

## Testing the Flow

For now, we can't fully test the modal until Lesson 4.7.1 wires up the open/close state. But we can partially test the delete action directly. Using a REST client (Insomnia, curl, or the built-in Postman-like tab in VS Code):

1. **Start the dev server**: `pnpm dev`.
2. **Log in** at `/login` with `test@example.com` / `password123` (from Lesson 4.2).
3. **Grab a contact ID**: open Supabase Studio (`http://localhost:54323`), view the `contacts` table, copy any contact's `id`.
4. **Submit a POST to `/contacts?/deleteContact`** with form field `id=<that-uuid>` and the session cookie attached.

Expected: the row vanishes from the table in Studio, and the response includes `{"success": true}`.

Alternately, you can quickly test via curl against your dev server by copying session cookies from DevTools. Don't worry too much about this yet — in the next lesson, the flow becomes a clean UI round-trip.

---

## Common Mistakes

### Mistake 1: Reading `user_id` from the form instead of `locals.getUser()`

```typescript
// ❌ SECURITY HOLE
const userId = formData.get('user_id');
```

Covered above — this lets attackers specify any user ID. Never do it. The verified session is the only trusted source for the current user's identity.

### Mistake 2: Omitting the second `.eq('user_id', ...)` filter

```typescript
// ❌ relies solely on RLS
.delete().eq('id', id)
```

RLS should catch this, but explicit filtering is cheap insurance against a missing or misconfigured policy. Always include both `.eq('id', id)` and `.eq('user_id', user.id)` for defense-in-depth.

### Mistake 3: Returning the raw Supabase error message

```typescript
// ❌ leaks schema details
return fail(500, { error: deleteError.message });
```

Users don't need database internals. Attackers might use them. Show a generic message; log the real one server-side (we'll build proper logging in Module 11).

### Mistake 4: Forgetting `type="button"` on the Cancel button

```svelte
<!-- ❌ might accidentally submit a parent form -->
<button onclick={onclose}>Cancel</button>
```

Without `type="button"`, the default type for a button inside a form is `submit`. If the modal ever ends up inside another form (or Svelte auto-wraps things unexpectedly), Cancel would submit. Always set `type="button"` on non-submit buttons.

### Mistake 5: Skipping the modal altogether

"Just add a `confirm()` popup" might feel quicker:

```svelte
<!-- ❌ tempting but bad UX -->
<button onclick={() => confirm('Delete?') && doDelete()}>Delete</button>
```

Native `confirm()` dialogs are jarring, inconsistent across browsers, can't be styled, and often blocked by enterprise browser policies. Building your own modal takes twenty more lines and looks and feels like part of your app. Do it properly once; reuse the component across delete flows.

### Mistake 6: Not handling `id` being missing

```typescript
// ❌ silently proceeds with id=null
const id = formData.get('id');
await supabase.from('contacts').delete().eq('id', id).eq('user_id', user.id);
```

If `id` is null, `.eq('id', null)` matches **nothing** — Supabase returns a successful empty delete. The user sees "success" but nothing happened. Worse, in edge cases, null handling in SQL can have surprising behavior (comparisons involving NULL are usually NULL, not false). Always validate inputs before using them.

---

## Principal Engineer Notes

### Note 1: Idempotent vs destructive operations

REST philosophers classify HTTP verbs into "safe" (GET — no effect), "idempotent" (PUT, DELETE — safe to retry), and "unsafe" (POST — might have side effects). In practice, DELETE is the most dangerous verb not because of its HTTP semantics, but because of its **business semantics**: once the data is gone, it's gone.

Treat every delete as a privileged operation. Require explicit user confirmation. Audit-log it if the domain calls for it (healthcare, finance, B2B SaaS with retention requirements). Never expose bulk-delete endpoints without deliberate thought.

### Note 2: Soft deletes vs hard deletes

Two approaches to deleting data:

**Hard delete** — actually remove the row. What we're doing here. Simple, final, frees space.

**Soft delete** — add a `deleted_at` timestamp column. "Deleting" sets `deleted_at = now()`. Every query in the app has to filter with `where deleted_at is null`.

Soft deletes have real value:

- **Undo support.** Users can restore "deleted" items from a trash bin.
- **Audit trails.** You know what used to exist without scanning backups.
- **Compliance.** Certain regulations (SOX, HIPAA) require keeping records even after "deletion."

The cost:

- **Every query needs the filter.** Forget one `.eq('deleted_at', null)` and deleted items leak back into the UI.
- **Data accumulates.** Your tables grow without bound unless you have a "permanent delete" pass.
- **Privacy implications.** If a user requests "delete my data" under GDPR, soft-deleted rows are still **there**, which may not satisfy the request. You'd need a secondary hard-delete job.

For Contactly — a personal contact manager — we use hard deletes. Users deleting a contact expect the contact to vanish. Enterprise CRMs might take the soft-delete route; the domain decides.

**Pattern-level advice**: if you're building a B2B SaaS, default to soft deletes. If you're building a consumer app, default to hard deletes unless you have a specific reason (undo feature, audit trail). The mid-ground — some tables soft, some hard — is common but requires discipline to keep the query patterns consistent.

### Note 3: Rate-limiting destructive endpoints

A user with malicious intent (or a compromised account with an API token) could call the delete endpoint in a loop and wipe their entire contact list. For a contact manager, this is "user's own data, user's problem." For a collaborative system or a system with shared resources, it's a DoS vector.

Real-world mitigation:

- Rate-limit destructive endpoints (e.g., 30 deletes per minute per user).
- Require recent authentication (`re-authenticate to delete this account`).
- Batch-delete warnings ("you're about to delete 1,000 contacts — type YES to confirm").
- Offer a grace period (deleted items go to a trash that auto-empties in 30 days).

Contactly doesn't need these today, but know the patterns exist for when you build something with higher stakes.

### Note 4: Confirming via typed contact name

For truly destructive actions, even a modal might not be enough friction. GitHub uses typed-name confirmation for repository deletion: "Type `owner/repo` to confirm deletion." That's intentional — repos represent real work that took days or weeks to produce; losing one is a much bigger deal than losing one contact.

You can build the same pattern with a modal variant:

```svelte
<input type="text" placeholder="Type the contact's name to confirm" bind:value={typedName} />
<button disabled={typedName !== contactName}>Delete</button>
```

The button enables only when the typed string matches. Users can't muscle-memory through the delete — they have to actively commit.

**When to use this**: only for genuinely catastrophic actions (deleting an entire account, wiping a workspace, removing a production resource). For individual records in a CRUD app, it's overkill and annoying. Match friction to stakes.

### Note 5: The network failure case

What happens if the delete request fails mid-flight? Say, the user's WiFi drops at the exact moment they click Delete. Three scenarios:

1. **Request never reached the server.** The contact is still there. The user sees an error; they try again. Safe.
2. **Request reached the server, was processed, response lost.** The contact is deleted, but the user sees an error and might try again. The retry finds the contact gone — not a problem; delete is idempotent in that sense (`delete where id = X and user_id = Y` with no matching rows is fine).
3. **Worst case**: the user sees an error, navigates away, doesn't realize the delete succeeded.

All three scenarios end in the correct database state. The UX could be better (showing "we're not sure if the delete succeeded — check your contact list"), but the data integrity holds. That's a gift of the `fail()`-returns pattern combined with `use:enhance` — the server's truth overwrites any optimistic UI after the re-load.

### Note 6: Why we don't show a spinner during delete

You might consider showing a loading spinner while the delete is in flight. For a one-second operation on a fast network, a spinner is overkill and flickers unpleasantly. Users tap Delete, see the modal close, see the contact disappear from the list — that's the feedback loop, and it's already clear.

For slow operations (anything over ~500ms) or ambiguous state ("is this working or is it stuck?"), a spinner earns its keep. For quick, familiar actions on small data, avoid the extra chrome. The goal is clarity, not activity-performance theater.

---

## What's Next

In Lesson 4.7.1 we'll wire up the **parent side** of this modal — the `$state` that tracks which contact is being deleted, the `bind:open` two-way binding, and the keyboard shortcut handling. We'll also review `$bindable()` in depth, because it's one of Svelte 5's most powerful but easily misunderstood runes.

After that, Lesson 4.8 returns to `supabase/seed.sql` to seed 20 realistic contacts, and Lesson 4.9 closes the module with polish. You're nearly at a working MVP of Contactly's core feature.
