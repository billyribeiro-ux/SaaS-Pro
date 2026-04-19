---
title: 'Bonus: Shallow Routing for Modals'
module: 14
lesson: 8
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-08-shallow-routing-modals'
description: 'pushState and replaceState give you URL-aware modals without unmounting your layout. Deep-linkable, back-button friendly, refresh-safe.'
duration: 30
preview: false
---

# Bonus: Shallow routing — modals without full navigation

You have built Contactly. Clicking a contact in the list takes the user to `/contacts/{id}` — a full page with their details, notes, activity log. That works, but there is a gentler UX pattern: show the contact details in a modal, slide it in from the right, let the user glance, then dismiss. Gmail does this. Linear does this. Notion does this.

There are two naive ways to build it, and both have problems.

**Naive option 1: modal is pure client state.** You `$state()` a boolean, show the modal when true, hide it when false. Simple. But:

- Refreshing the page loses the modal state (user reopens their browser, they are not on the contact they were looking at).
- The URL does not change, so there is no way to share a link to "the modal view of Alice's contact."
- Pressing the back button does not close the modal — it navigates away from the list entirely. Users complain: "I wanted to close the modal, not leave the page."
- Mobile swipe-back gestures do the same thing: they take you away from the list.

**Naive option 2: full route navigation.** You make `/contacts/{id}` a real route. Clicking a contact navigates. The modal is rendered by that route's layout. But:

- The list page unmounts. Any client-side state (scroll position, filter inputs, expanded sections) is lost.
- Navigating back re-mounts the list and re-runs its load function. The list re-fetches from the server even though nothing changed.
- On mobile especially, full-page transitions feel heavier than they need to.

**The right answer is shallow routing.** Add a history entry. Update the URL. Keep the current page mounted. Render the modal on top. Pop history to close. Your URL state and your UI state stay coherent, and the back button does exactly what the user expects.

This lesson walks you through adding a contact-detail modal to Contactly using `pushState` and `replaceState` from `$app/navigation`. By the end you will:

- Understand what shallow routing is and when to use it over full navigation.
- Use `pushState(url, state)` to add history entries that do not trigger navigation.
- Read shallow state via `page.state` from `$app/state`.
- Handle Cmd-click / middle-click correctly so deep links still work.
- Use `preloadData` to prefetch data before opening the modal.
- Type `App.PageState` for end-to-end type safety.
- Build a fully accessible modal with focus trap, Escape-to-close, and backdrop click.

## 1. What shallow routing is

SvelteKit routing has two layers:

**Deep routing** (the routing you already know): the browser URL changes, SvelteKit runs the `load` functions for the new route, the page component unmounts, a new one mounts. This is what `<a href>` and `goto()` do by default.

**Shallow routing**: the browser URL changes, a new history entry is added, but **the page does not navigate.** No load function runs. No component unmounts. You get a URL and a bit of state attached to it, and that is it. You are in charge of what to render based on that state.

The APIs live in `$app/navigation`:

- `pushState(url, state)` — add a history entry with a new URL and attached state.
- `replaceState(url, state)` — replace the current history entry (no new entry, just update).

The state lives on `page.state` from `$app/state`. It is reset on every real navigation.

The mental model: `pushState` is "I want the URL to reflect a UI state change, but I don't want to leave this page." That is exactly what a modal wants.

## 2. The two APIs

### `pushState(url, state)`

```ts
import { pushState } from '$app/navigation';

pushState('/contacts/abc-123', { selected: contact });
```

- **First argument: URL.** Relative to the current location. Use `''` to keep the URL unchanged and only update state (rare — you almost always want the URL to reflect the modal).
- **Second argument: state object.** Anything serializable. Stored on `page.state`.

Side effects:

- Adds one entry to the browser's history stack.
- Browser back button unwinds it.
- Cmd-click / middle-click on links is _not_ intercepted (we will handle this ourselves).
- No load functions run. No layout re-renders. Your component stays mounted.

### `replaceState(url, state)`

```ts
replaceState('/contacts/abc-123?tab=notes', { ...page.state, tab: 'notes' });
```

Same signature, but instead of adding a history entry, it replaces the current one. Use this when:

- The user is interacting _inside_ a modal (switching tabs, toggling a field) and each micro-change should not create a back-button stop.
- You want to update URL state without polluting history.

Rule of thumb: `pushState` for "entering a new state" (opened the modal, navigated to a sub-view), `replaceState` for "modifying current state" (tab switches, filter changes).

## 3. Reading shallow state

```svelte
<script>
	import { page } from '$app/state';
</script>

{#if page.state.selected}
	<Modal contact={page.state.selected} />
{/if}
```

`page.state` is a reactive object that reflects the current history entry's state. When `pushState` is called, it updates. When the user navigates back, it updates. When they navigate forward again, it restores.

Two important facts:

- **On SSR and the first page load, `page.state` is always an empty object.** Shallow state does not survive a full page reload — it only exists within the SPA session. This is fine for modals (a refreshed page lands on the full `/contacts/{id}` route, rendering the detail page properly).
- **`page.state` is _not_ serializable in the general case.** Don't put `Map`, `Set`, `Date`, `Promise`, or class instances in it. Stick to plain JSON-compatible shapes.

## 4. Refactoring Contactly's contact list

Here is the setup. Currently, the contacts list has plain `<a>` links:

### Before: `src/routes/(app)/contacts/+page.svelte`

```svelte
<script lang="ts">
	let { data } = $props();
</script>

<ul>
	{#each data.contacts as contact (contact.id)}
		<li>
			<a href="/contacts/{contact.id}">
				{contact.first_name}
				{contact.last_name}
			</a>
		</li>
	{/each}
</ul>
```

Clicking any link triggers a full navigation to `/contacts/[id]/+page.svelte`. We want the _same_ URL to open the contact as a modal while keeping the list mounted.

### After: `src/routes/(app)/contacts/+page.svelte`

```svelte
<script lang="ts">
	import { pushState, preloadData, goto } from '$app/navigation';
	import { page } from '$app/state';
	import ContactDetailModal from './ContactDetailModal.svelte';
	import ContactDetailPage from './[id]/+page.svelte';
	import type { Contact } from '$lib/types/database.types';

	let { data } = $props();

	async function openContact(e: MouseEvent, contact: Contact) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
			return;
		}

		e.preventDefault();

		const href = `/contacts/${contact.id}`;
		const result = await preloadData(href);

		if (result.type === 'loaded' && result.status === 200) {
			pushState(href, { selected: result.data });
		} else {
			goto(href);
		}
	}
</script>

<h1>Contacts</h1>

<ul>
	{#each data.contacts as contact (contact.id)}
		<li>
			<a href="/contacts/{contact.id}" onclick={(e) => openContact(e, contact)}>
				{contact.first_name}
				{contact.last_name}
			</a>
		</li>
	{/each}
</ul>

{#if page.state.selected}
	<ContactDetailModal onclose={() => history.back()}>
		<ContactDetailPage data={page.state.selected} />
	</ContactDetailModal>
{/if}
```

Line-by-line:

**Lines 2–6: imports.**

- `pushState`, `preloadData`, `goto` from `$app/navigation` — the shallow-routing primitives plus the preloader plus the fallback nav.
- `page` from `$app/state` — the new reactive page object. Note: **always `$app/state`, never `$app/stores`** in SvelteKit 2.12+. The stores version still works but is legacy.
- `ContactDetailModal` and `ContactDetailPage` — the modal wrapper and the actual page component we will re-use.
- `Contact` type from your database types.

**Lines 10–23: `openContact` handler.** This is where the intelligence lives.

- `e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0` — the modifier-key check. On Mac, `Cmd+click` opens the link in a new tab. On Windows/Linux, it is `Ctrl+click`. Shift+click opens in a new window. Alt+click triggers a download in some browsers. Middle-click (`e.button === 1`) opens in a background tab, and we want that to work too. By returning early in all these cases, we let the browser handle the link natively. **This is the difference between a good and a broken shallow-routing implementation.** If you intercept every click, you break every user's expectation that "I can Cmd-click this to open in a new tab."
- `e.preventDefault()` — for plain left-clicks, we stop the browser's native navigation.
- `const href = ...` — the href we will push to.
- `await preloadData(href)` — this is the data-fetching magic. `preloadData` runs the `load` function for the target route without actually navigating. The returned object tells us whether the load succeeded (`type: 'loaded', status: 200`) or failed (`type: 'redirect'` / `type: 'error'` / non-200 status).
- `if (result.type === 'loaded' && result.status === 200)` — data loaded successfully. We call `pushState(href, { selected: result.data })` — adding a history entry with the preloaded data attached.
- `else { goto(href) }` — if load failed or redirected, we fall back to real navigation and let SvelteKit handle it normally. This might happen if the contact was deleted in another tab, if the user has permission issues, etc. Graceful degradation.

**Lines 28–36: the list.**

- `<a href="/contacts/{contact.id}" onclick={...}>` — note the `href` is still set. This is critical:
  - SEO crawlers see a real link.
  - Right-click → "Copy link" still gives the correct URL.
  - Middle-click / Cmd-click open a real tab on the right URL.
  - If JavaScript fails to load, the link still works (full navigation).
  - Our JS handler intercepts the plain left-click case and upgrades it to shallow routing.

**Lines 38–42: the modal.**

- `{#if page.state.selected}` — the modal renders only when shallow state says "a contact is selected."
- `<ContactDetailModal onclose={() => history.back()}>` — closing the modal is just `history.back()`. The browser pops the history entry, `page.state.selected` becomes `undefined`, the `{#if}` block unmounts the modal. No imperative state management needed.
- `<ContactDetailPage data={page.state.selected} />` — we re-render the real contact page component with the preloaded data. This is the key insight: the _same_ component that renders at `/contacts/{id}` is now rendering inside a modal. No code duplication.

## 5. The full route still exists

Here is what nobody tells you: this whole pattern hinges on `/contacts/[id]/+page.svelte` being a **real route**. We did not replace it with a modal — we layered the modal on top.

### `src/routes/(app)/contacts/[id]/+page.server.ts`

```ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { data, error: dbError } = await locals.supabase
		.from('contacts')
		.select('*, notes(*), activities(*)')
		.eq('id', params.id)
		.eq('user_id', user.id)
		.single();

	if (dbError?.code === 'PGRST116') error(404, 'Contact not found');
	if (dbError) error(500, dbError.message);

	return { contact: data };
};
```

### `src/routes/(app)/contacts/[id]/+page.svelte`

```svelte
<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<article class="contact-detail">
	<header>
		<h1>{data.contact.first_name} {data.contact.last_name}</h1>
		<p>{data.contact.email}</p>
	</header>

	<section>
		<h2>Notes</h2>
		{#each data.contact.notes as note (note.id)}
			<p>{note.body}</p>
		{/each}
	</section>

	<section>
		<h2>Activity</h2>
		{#each data.contact.activities as activity (activity.id)}
			<p>{activity.type} — {activity.created_at}</p>
		{/each}
	</section>
</article>
```

When a user:

- **Clicks a contact in the list**: `preloadData` runs this load function → `pushState` → the list stays mounted, modal shows the above markup.
- **Refreshes the page while the modal is open**: the URL is `/contacts/{id}`, so SvelteKit does a full load and renders the above markup as the whole page. No modal — just the page. Graceful.
- **Deep-links from an external source**: same as refresh. Full page. Graceful.
- **Cmd-clicks the link**: browser opens `/contacts/{id}` in a new tab, which renders the full page.
- **Closes the modal via back button**: `page.state.selected` becomes `undefined`, modal unmounts, URL reverts to `/contacts`.

This is the whole point: one route, one component, two presentations, zero duplication. SEO crawls see the full page. JS users get a modal overlay. Everyone wins.

## 6. Typing `App.PageState`

Right now, TypeScript thinks `page.state.selected` is of type `App.PageState['selected']` which by default is... nothing. Let's fix that.

### `src/app.d.ts`

```ts
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.types';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			getUser: () => Promise<User | null>;
		}

		interface PageData {
			user: User | null;
		}

		interface PageState {
			selected?: {
				contact: Database['public']['Tables']['contacts']['Row'] & {
					notes: Database['public']['Tables']['notes']['Row'][];
					activities: Database['public']['Tables']['activities']['Row'][];
				};
			};
		}

		interface Error {
			message: string;
		}
	}
}

export {};
```

Walkthrough:

- We augment the global `App` namespace with a `PageState` interface. This exact interface becomes the type of `page.state` everywhere.
- The shape of `selected` matches what `preloadData` returns for the `/contacts/[id]` route — that is, the data returned by its `load` function.
- Every field is optional (`?`) because `page.state` is always `{}` before any `pushState` happens.

Now in components, `page.state.selected?.contact.first_name` type-checks correctly and autocompletes. If you change the shape of the load function's return, TypeScript catches every mismatch.

## 7. Building the modal component

The modal needs to be:

- Accessible (focus trap, Escape closes, backdrop click closes, `role="dialog"`, `aria-modal="true"`, `aria-labelledby`).
- Styled (Tailwind v4 with the semantic tokens you already set up).
- Keyboard-friendly.
- Properly layered above page content.

### `src/routes/(app)/contacts/ContactDetailModal.svelte`

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		onclose,
		children
	}: {
		onclose: () => void;
		children: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		dialog?.showModal();
	});

	function handleClose() {
		dialog?.close();
		onclose();
	}

	function onBackdropClick(e: MouseEvent) {
		if (e.target === dialog) handleClose();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			handleClose();
		}
	}
</script>

<dialog
	bind:this={dialog}
	onclick={onBackdropClick}
	onkeydown={onKeydown}
	aria-labelledby="modal-title"
	class="modal"
>
	<div class="modal-content">
		<button class="close" onclick={handleClose} aria-label="Close"> &times; </button>

		{@render children()}
	</div>
</dialog>

<style>
	.modal {
		margin: auto;
		padding: 0;
		border: none;
		border-radius: 0.75rem;
		max-width: 48rem;
		width: 90vw;
		max-height: 90vh;
		background: var(--color-surface-raised);
		color: var(--color-text);
	}

	.modal::backdrop {
		background: rgb(0 0 0 / 0.5);
		backdrop-filter: blur(4px);
	}

	.modal-content {
		padding: 2rem;
		position: relative;
		overflow-y: auto;
		max-height: 90vh;
	}

	.close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: var(--color-text-muted);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
	}

	.close:hover {
		background: var(--color-surface);
	}
</style>
```

Line-by-line:

**Lines 1–11: props.** `onclose` callback and a `children` snippet. We use `{@render children()}` rather than `<slot />` — that is the Svelte 5 way, and the legacy slot syntax is deprecated.

**Line 13: dialog ref.** A `$state()` container for the HTMLDialogElement reference. We need imperative access to call `.showModal()` and `.close()`.

**Lines 15–17: open on mount.** The `$effect` runs after the DOM is ready. `dialog.showModal()` is the native HTML `<dialog>` API — it shows the dialog in the top layer (above all other page content, no z-index fighting), traps focus automatically, dims the background via `::backdrop`, and handles Escape closing at the browser level. Using the native element means you get accessibility for free.

**Lines 19–22: explicit close.** `dialog.close()` plus a callback to the parent. The parent's `onclose` callback is `() => history.back()`, which pops the history entry and unsets `page.state.selected`, which causes the `{#if page.state.selected}` to evaluate false, which unmounts this modal component. Clean unidirectional flow.

**Lines 24–26: backdrop click.** Clicking the backdrop of a native `<dialog>` fires a click event whose `target` is the dialog element itself (not its children). `e.target === dialog` checks for exactly that case.

**Lines 28–33: Escape handler.** Browsers handle Escape natively on `<dialog>` via a `cancel` event, but listening on `keydown` gives us explicit control (and lets us call our own `onclose` callback reliably).

**Lines 36–46: markup.** `<dialog>` with the refs and handlers. `aria-labelledby="modal-title"` — you should put `id="modal-title"` on the heading inside the child content, otherwise this label reference dangles. In the real app you would either enforce this by convention or pass the label text as a prop.

**Lines 49–86: styles.** Semantic tokens from the dark-mode lesson flow through. `::backdrop` is a pseudo-element specific to `<dialog>` that styles the dimmed overlay. No portal, no z-index gymnastics, no scroll lock: the native dialog element gives us everything.

## 8. Caveats and gotchas

**Shallow state is SPA-only.** On SSR, on first paint, and on a browser refresh, `page.state` is empty. This is by design. Any UI that depends on `page.state` must degrade gracefully to "no modal." That is why our setup falls back to a full route — if a user deep-links to `/contacts/{id}`, they get the full page, not a mysterious empty list with no modal.

**Complex objects are not serializable.** `page.state` goes through browser history internal serialization (it is effectively `history.state`, a `structuredClone`-compatible object). You cannot put:

- `Date` → use ISO strings.
- `Map` / `Set` → use arrays or plain objects.
- Class instances → use plain object representations.
- Functions → obviously not.
- Promises → never.

If you need complex data in your modal, keep only the minimum in `page.state` (e.g., `{ contactId: 'abc' }`) and refetch via `preloadData` or a remote function. The example above puts the whole preloaded data object in state, which works for plain-JSON payloads. If your load function returns `Date` objects or `Map`s, either serialize them, or switch to a "store the id, fetch the rest" pattern.

**Back/forward pops do not trigger `load` functions.** Since there is no real navigation, your load functions are not re-run when the user hits back. This is desirable for the list-to-modal case (the list data is still fresh), but can surprise you if you expected data freshness guarantees. If you need it, combine shallow routing with a remote query's `.refresh()` on the `popstate` event.

**Cmd-click modifiers we skip:**

- `metaKey` → Cmd on Mac, opens new tab.
- `ctrlKey` → Ctrl on Windows/Linux, opens new tab. Also used by terminals etc.
- `shiftKey` → opens new window.
- `altKey` → downloads (in some browsers).
- `button !== 0` → middle-click (button === 1) opens in background tab; we want native handling.

If you skip any of these, users on that platform will have a broken experience.

**Focus management on close.** Native `<dialog>` does a decent job of returning focus to the triggering element when closed. If you have a custom trigger pattern (not a focused link), set `tabindex="-1"` on the dialog itself and manage focus explicitly.

## 9. Using `preloadData` even without shallow routing

`preloadData` is useful on its own. You can use it to implement:

- **Hover prefetching**: preload on `mouseenter`, hydrate the page instantly on click.
- **Intent-based prefetching**: preload when the user starts to drag their cursor toward a link, using mouse velocity heuristics.
- **"Peek" previews**: show a lightweight preview card on hover, populated by the preloaded data.

The `data-sveltekit-preload-data` attribute is the declarative version: add it to an `<a>` or a parent element and SvelteKit preloads on hover or tap-start. `preloadData` in JS gives you programmatic control.

## 10. Principal Engineer Notes

**Deep-linking is the acid test.** If I email you `https://contactly.app/contacts/abc`, you open the link in a fresh tab, and you see... the modal? No — you see the full page. The modal only exists as an overlay when you navigate _from within_ the list. This is correct behavior. The URL encodes the destination; how that destination is presented (full page vs. modal-overlay) is a progressive enhancement on top of the real route.

**Keep your list mounted.** The whole point of this pattern is keeping the list's state (scroll position, filter inputs, selected items) alive across modal interactions. If you find yourself using `pushState` and then unmounting the list, you have not saved anything compared to full navigation.

**Nested modals are a smell.** If your modal opens another modal, you have probably confused "modal overlay" with "route navigation." Consider full navigation for deeper drill-downs, or flatten the UI.

**SEO is not compromised.** Crawlers see `<a href="/contacts/abc">` and follow it. They render the full page. Your modal-overlay is invisible to them but visible to users — which is what you want.

**Accessibility checklist for modals:**

- [ ] Native `<dialog>` element (free focus trap, free backdrop, free Escape handling).
- [ ] `aria-labelledby` pointing to a visible heading.
- [ ] Focus returns to the trigger when modal closes.
- [ ] Backdrop click closes.
- [ ] Escape key closes.
- [ ] First tab lands inside the modal, not on page content behind it.
- [ ] Close button is the first focusable element OR has an accessible label.

**Use `replaceState` for modal-internal state.** If your modal has tabs (Notes, Activity, Files), clicking each tab should `replaceState` so the URL reflects the current tab (`?tab=notes`) but pressing back doesn't cycle through tabs — it closes the modal.

**Verification steps:**

1. Click a contact. URL changes to `/contacts/{id}`. List stays visible behind the modal. Modal shows contact details.
2. Press back. Modal closes. URL reverts to `/contacts`. List is in exactly the same state (scroll, inputs preserved).
3. Cmd-click a contact. A new tab opens at `/contacts/{id}` showing the full page.
4. Copy the URL while the modal is open. Open in a new tab. See the full page, not the modal.
5. Refresh while the modal is open. Page reloads into the full `/contacts/{id}` page. No error.
6. Open the modal, press Escape. Modal closes.
7. Open the modal, click the backdrop. Modal closes.
8. Open the modal, press Tab repeatedly. Focus cycles within the modal, never escapes to the underlying list.
9. Run Lighthouse. SEO score should be identical to full-navigation setup.
10. Disable JS. Click a contact. Full navigation happens (the `href` still works). You get the full `/contacts/{id}` page.

## What's next

Shallow routing added URL-aware modals. Next bonus continues on the DX-polish theme with two smaller but powerful features: `{@attach}` directives (the modern replacement for Svelte's `use:` actions) and `<svelte:boundary>` (graceful error handling for async UI). Both are essential pieces of the 2026 Svelte toolbox.

Continue to `bonus-09: {@attach} directives & <svelte:boundary>`.
