---
title: "4.7.1 - Close Modal on Cancel"
module: 4
lesson: 8
moduleSlug: "module-04-crud"
lessonSlug: "07-1-close-modal-on-cancel"
description: "Wire up the modal close behavior — Cancel button, Escape key, and clicking the backdrop."
duration: 5
preview: false
---

## Overview

In Lesson 4.7 you built the delete action and the `DeleteConfirmModal` component. What we **didn't** do yet: wire it up to the contacts page. Right now the modal component exists but nothing opens it, nothing closes it, and nothing passes in a contact to delete.

This short lesson closes that loop. You'll add a `$state` object on the parent page to track the modal's open state and which contact is being deleted, a Delete button on each contact row that opens the modal with the right contact, and a close handler that resets everything. Along the way we'll dig into **`$bindable`** — Svelte 5's two-way binding rune — and why we use it here instead of passing a plain `open` boolean plus an `onOpenChange` callback.

## Prerequisites

- Lesson 4.7 complete — the `deleteContact` action and `DeleteConfirmModal.svelte` exist.
- You understand `$state` and `$props` from earlier lessons.
- You've seen callback props (`onclose`) used in Module 3.

## What You'll Build

- A `$state`-tracked modal state object on the contacts list page.
- A per-row Delete button that calls `openDeleteModal(id, name)` to populate the state.
- A `closeDeleteModal()` function that resets the state to its initial empty shape.
- A fluent understanding of `$bindable` — when to use it, when not to.

---

## Step 1: The Parent State

Open `src/routes/(app)/contacts/+page.svelte` — the contacts list page that renders rows from `data.contacts`. Inside the `<script lang="ts">` block, add:

```svelte
<script lang="ts">
  import DeleteConfirmModal from '$lib/components/ui/DeleteConfirmModal.svelte'

  let deleteModal = $state({
    open: false,
    contactId: '',
    contactName: ''
  })

  function openDeleteModal(id: string, name: string) {
    deleteModal = { open: true, contactId: id, contactName: name }
  }

  function closeDeleteModal() {
    deleteModal = { open: false, contactId: '', contactName: '' }
  }

  let { data } = $props()
</script>
```

Let's walk through this.

### A single state object instead of three separate `$state`s

```typescript
let deleteModal = $state({
  open: false,
  contactId: '',
  contactName: ''
})
```

We could've written three separate pieces of state:

```typescript
// ❌ works but verbose
let deleteModalOpen = $state(false)
let deleteModalContactId = $state('')
let deleteModalContactName = $state('')
```

Using a single object has two benefits:

1. **They move together.** Every time we open or close the modal, all three values change in sync. A single object makes this atomic — one assignment updates all three. Separate `$state`s let you accidentally update `open` without updating `contactId`, which is a bug class you don't want.
2. **Reads are cleaner.** `deleteModal.open` and `deleteModal.contactName` read as "the modal's open state, the modal's contact name" — one concept, three fields. Three separate variables feel scattered.

**Why reassignment (`deleteModal = { ... }`) vs mutation (`deleteModal.open = true`)?** Both work with `$state`. `$state` uses a deeply reactive proxy, so mutating `deleteModal.open = true` would also trigger reactivity. We use reassignment here because it makes the "all three fields update together" pattern very explicit — you see one line, and you know every field gets a new value. It's stylistic, not functional.

### The two helper functions

```typescript
function openDeleteModal(id: string, name: string) {
  deleteModal = { open: true, contactId: id, contactName: name }
}

function closeDeleteModal() {
  deleteModal = { open: false, contactId: '', contactName: '' }
}
```

Small functions, big payoff: the **call sites** (the row button, the modal's `onclose`) now describe their intent clearly. `openDeleteModal(contact.id, 'Alice Johnson')` reads like English. Inlining `deleteModal = { open: true, contactId: contact.id, contactName: 'Alice Johnson' }` on every button works, but it's noisier and mixes logic into markup.

The `closeDeleteModal` function resets to the empty initial state, not just `open: false`. Why? Because the next time we open the modal, we want a clean slate. If we only flipped `open: false` and left `contactId` populated, a brief edge case could show the old contact's name when the modal reopens. Resetting everything is cheap insurance.

---

## Step 2: The Row Button

Inside the contact list rendering (the `{#each}` block that iterates `data.contacts`), add a Delete button to the actions area of each row:

```svelte
<!-- inside the {#each data.contacts as contact} block -->
<button
  type="button"
  onclick={() => openDeleteModal(contact.id, `${contact.first_name} ${contact.last_name}`)}
  class="text-red-600 hover:text-red-700 text-sm"
>
  Delete
</button>
```

- **`type="button"`** — prevents the button from accidentally submitting any ancestor form (see Lesson 4.7's common mistakes).
- **`onclick={() => openDeleteModal(...)}`** — a Svelte 5 event handler. Note the camelCase `onclick` — in Svelte 5, event handlers are plain props (`onclick`, `onkeydown`), not directive syntax (`on:click`). The arrow function captures the current `contact` for this specific row's button.
- **Template literal for the name** — we combine first and last name into the display string. No backend name field — we construct it on the fly for the modal.
- **Red text styling** — the delete action is visually distinct. Destructive actions should always look destructive.

---

## Step 3: Rendering the Modal

At the bottom of the markup (outside any `{#each}` blocks), render the modal once:

```svelte
<DeleteConfirmModal
  bind:open={deleteModal.open}
  contactId={deleteModal.contactId}
  contactName={deleteModal.contactName}
  onclose={closeDeleteModal}
/>
```

Just **one** modal, not one per row. That's important. If we rendered a modal inside the `{#each}` loop (one per contact), we'd have 20 modals in the DOM at once, most of them hidden. That wastes memory, complicates accessibility (multiple dialogs confuse screen readers), and makes the state management harder.

Instead, a single modal outside the list reads from `deleteModal.contactId` and `deleteModal.contactName`. When `openDeleteModal(id, name)` fires, it populates those fields, and the single modal updates to show the right contact.

Note the four props:

- **`bind:open={deleteModal.open}`** — two-way binding via `$bindable()`. Covered in depth below.
- **`contactId={deleteModal.contactId}`** — one-way prop. The modal reads it; it doesn't write back.
- **`contactName={deleteModal.contactName}`** — same.
- **`onclose={closeDeleteModal}`** — callback prop. The modal invokes this when the user cancels, presses Escape, or clicks the backdrop.

---

## Step 4: Understanding `$bindable`

Let's slow down and really understand what `$bindable()` is doing, because this is one of Svelte 5's most valuable runes.

### The problem `$bindable` solves

By default in Svelte 5, props flow **one way**: from parent to child. The child can read the prop, but it can't change the parent's state directly. This is great for predictability — the data flow is obvious, and mutations are localized.

But sometimes you want two-way flow. A modal needs to let the parent say "open yourself" (parent → child) AND let the modal say "I'm closing myself" (child → parent, indirectly). Without two-way binding, you'd need:

```svelte
<!-- manual two-way: callback pattern -->
<Modal
  open={isOpen}
  onOpenChange={(newOpen) => isOpen = newOpen}
/>
```

This works, but it's verbose. The `$bindable` pattern compresses it:

```svelte
<Modal bind:open={isOpen} />
```

Same effect, less boilerplate.

### How `$bindable` works

Inside the component, `$bindable()` is a **rune that creates a bindable prop**:

```typescript
// in DeleteConfirmModal.svelte
let { open = $bindable() }: { open: boolean } = $props()
```

The key change versus a regular prop: when the parent uses `bind:open={...}`, writing to `open` inside the child **also writes to the parent's state**. Without `$bindable()`, writing to `open` would be an error (you can't mutate regular props).

`$bindable(defaultValue)` lets you provide a default if the parent doesn't use `bind:`. In our modal, we call `$bindable()` with no default — so if a parent uses it without `bind:`, `open` is just a normal prop and writes don't propagate back (that's a warning in dev mode, a sign you likely meant to use `bind:`).

### When to use `$bindable` vs callback props

Rule of thumb: **`$bindable` for form-input-like components, callback props for everything else.**

**Use `$bindable`** when the component acts as an **input** to a value that already lives in the parent:

- `<TextInput bind:value={email} />` — the input edits the parent's `email` string.
- `<Modal bind:open={isOpen} />` — the modal toggles the parent's `isOpen` flag.
- `<Toggle bind:checked={enabled} />` — the toggle reflects and edits the parent's `enabled` flag.

**Use callback props** when the child **signals events** that the parent might handle differently each time:

- `<Form onsubmit={handleSubmit} />` — the parent decides what to do with the submitted data.
- `<Button onclick={doThing} />` — the parent owns the behavior.
- `<Modal onclose={closeDeleteModal} />` — ← we use this too, because "close" is an event, not a state we mutate.

In our `DeleteConfirmModal`, we use **both**:
- `bind:open` for the state that moves up and down.
- `onclose` for the event of "the user wanted to close" — the parent decides what that means (in our case, reset the state).

You could technically use only `$bindable`:

```svelte
<!-- alternative: $bindable only -->
<Modal bind:open={deleteModal.open} />
```

And in the modal, just set `open = false` when the user cancels. That would work. But then the parent can't do anything else on close — no logging, no analytics, no resetting other state. The `onclose` callback keeps the option open.

Real-world libraries (shadcn/ui for React, Melt UI for Svelte) usually expose both patterns together: a bindable open state AND lifecycle callbacks (`onOpenChange`, `onClose`, etc). We follow the same convention.

---

## Step 5: Accessibility — Why the Backdrop Has `role="button"` and `tabindex="0"`

Quick refresher from 4.7: the backdrop div in the modal looks like this:

```svelte
<div
  class="fixed inset-0 bg-black/50 z-40"
  role="button"
  tabindex="0"
  onclick={onclose}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
></div>
```

Three accessibility considerations now that we're thinking about real usage:

### Why `role="button"` on the backdrop?

Without a role, a `<div>` is semantically "a generic container" — screen readers ignore it even if it has handlers. Adding `role="button"` tells assistive tech "this element is clickable; announce it as a button." A sighted user hovering over the backdrop already sees the pointer cursor (via CSS) and knows clicking dismisses. Screen reader users need the role to know the same thing.

### Why `tabindex="0"`?

By default, only form controls (`<button>`, `<input>`, `<a>`, etc.) are keyboard-focusable. Divs are skipped by Tab. But we want the Escape key handler to fire — which requires the backdrop to potentially receive keyboard events.

`tabindex="0"` makes the div part of the tab order (focusable via Tab). Alternatively, attaching the keydown handler to `window` would work globally but has downsides (stale closures, harder to test, affects other UI). The backdrop-with-tabindex approach keeps the handler scoped to the modal's lifecycle — when the modal mounts, the backdrop exists; when it unmounts, the handler is gone.

**A more robust alternative**: Svelte libraries like `svelte-focus-trap` or primitives like shadcn-svelte's Dialog component handle focus management more completely (trap focus inside the modal, restore focus to the trigger button on close, etc). For production-grade modals, reach for those. For a learning lesson, our lightweight version is a great starting point.

### What about `aria-modal`?

In 4.7 we set `aria-modal="true"` on the dialog card. That tells screen readers "this dialog is modal — users shouldn't interact with anything outside it." Screen readers respect this by confining announcement and navigation to the dialog's subtree.

Combined with `role="dialog"` and `aria-labelledby`, you get a reasonably accessible modal for most users. It's not perfect — true accessibility requires focus trapping, `inert` on the background content, and more — but it's enough to not be actively hostile, and it's a good foundation to build on.

---

## Testing the Full Flow

With the dev server running:

1. **Log in** at `/login` with `test@example.com` / `password123`.
2. **Navigate to `/contacts`.** You see the seeded contact list (Lesson 4.2's test user's contacts).
3. **Click Delete on any row.** Modal appears with "Are you sure you want to delete [Name]?"
4. **Click Cancel.** Modal closes, contact list unchanged.
5. **Click Delete on the same row again.** Modal reopens.
6. **Press Escape.** Modal closes.
7. **Click Delete one more time.**
8. **Click outside the modal (on the backdrop).** Modal closes.
9. **Click Delete one more time, then click the red Delete button inside the modal.**
10. **Modal closes, the row disappears from the list.** Contact is gone from the database.

The round-trip should feel fast and native. The list re-renders automatically because `use:enhance` on the form reruns the `load` function after the action returns.

---

## Common Mistakes

### Mistake 1: Forgetting `bind:` and using plain `open={...}`

```svelte
<!-- ❌ one-way; modal can't close itself by setting open=false -->
<DeleteConfirmModal open={deleteModal.open} />
```

Without `bind:`, writing to `open` inside the modal doesn't affect the parent's `deleteModal.open`. The modal might visually close (its own local variable updates) but re-renders will snap it back based on the parent's stale value. Always use `bind:open={...}` when the modal is declared with `$bindable()`.

### Mistake 2: One modal per row

```svelte
<!-- ❌ 20 modals in the DOM, each hidden -->
{#each data.contacts as contact}
  <DeleteConfirmModal
    open={openForContact === contact.id}
    contactId={contact.id}
    contactName={`${contact.first_name} ${contact.last_name}`}
    onclose={() => openForContact = null}
  />
{/each}
```

Instead of tracking "which contact is the modal open for," render one modal and populate it on demand. Less DOM, less memory, fewer accessibility headaches.

### Mistake 3: Resetting only the `open` flag, leaving stale data

```typescript
// ❌ contactId/contactName still populated; could show stale data momentarily
function closeDeleteModal() {
  deleteModal = { ...deleteModal, open: false }
}
```

If the user closes the modal, then opens a new one quickly (perhaps via keyboard), there's a brief render cycle where the old `contactName` shows. Reset everything on close; the initial empty state is the safest default.

### Mistake 4: Skipping the keyboard Escape handler

If you delete the `onkeydown` on the backdrop, users who rely on keyboards (screen reader users, users with motor impairments, power users) can't dismiss the modal except by clicking. Hitting Escape is a universal convention; breaking it feels buggy.

### Mistake 5: Assuming `$bindable` auto-syncs without `bind:`

```svelte
<!-- ❌ parent doesn't use bind:; writes to open are local only -->
<DeleteConfirmModal open={deleteModal.open} onclose={closeDeleteModal} />
```

`$bindable()` in the child **allows** two-way binding; the parent still has to opt in by using `bind:`. Without `bind:`, it behaves like a normal prop plus a warning in dev mode (Svelte tells you the prop is bindable but not bound).

---

## Principal Engineer Notes

### Note 1: Focus trapping — what we're not doing (and when to add it)

True accessibility-compliant modals **trap focus**: once the modal opens, Tab and Shift+Tab cycle only through focusable elements *inside* the modal. The user can't accidentally Tab into the hidden page beneath. Our simple modal doesn't do this — focus can still escape to background elements.

For serious accessibility work, libraries like [`svelte-focus-trap`](https://github.com/henrygd/svelte-focus-trap) handle the full lifecycle: move focus into the modal on open, trap it there, restore it to the trigger element on close. Or use a complete component like shadcn-svelte's `<Dialog>`.

**When to add**: the moment you have users who rely on keyboard navigation. In a B2B product, this is "always." In a prototype, you can ship without it and add it before launch. But know the gap exists.

### Note 2: Portal-style rendering — why we don't teleport to `document.body`

Some modal libraries (React Portal, Vue Teleport) render the modal's DOM outside its parent's subtree — usually appending it to `document.body`. This avoids stacking-context bugs where a parent's CSS `transform`, `filter`, or `overflow: hidden` accidentally clips or misplaces the modal.

Our modal uses `position: fixed; inset: 0` which creates a new stacking context relative to the viewport. For most layouts, this works fine. Edge cases where it breaks:

- An ancestor has `transform` applied — `fixed` positions relative to the ancestor, not the viewport.
- An ancestor has `overflow: hidden` — the modal gets clipped to the ancestor's bounds.

If you hit either, reach for a portal-style solution. Svelte doesn't have a built-in `<Portal>` yet, but libraries like `svelte-portal` fill the gap. For Contactly's simple layouts, fixed positioning is fine.

### Note 3: Stacked modals and z-index discipline

Modals open other modals. A delete-confirmation modal might open a secondary "are you really really sure?" dialog for critical operations. Nested modals become z-index bingo: which one goes on top?

Three common approaches:

1. **Forbid stacking** — if a modal is open, disable the triggers inside it. Simpler, restrictive, works for most CRUD apps.
2. **Per-instance z-index** — each modal gets its z-index passed as a prop. The second modal's parent passes `z={50 + 10}` to beat the first.
3. **Portal with a modal stack** — a central `<ModalRoot>` component renders the topmost modal. Push/pop semantics.

For Contactly, (1) is enough. If you later hit a case where you need stacking, revisit the design — usually it's a sign that the UX should collapse into a single dialog with more information, not nest.

### Note 4: Why `$bindable` over a `$state` inside the child

A naive alternative to `$bindable`: make the modal own its own `open` state internally, and expose an imperative API via a ref:

```svelte
<!-- ❌ not Svelte's style -->
<Modal bind:this={modalRef} />
<button onclick={() => modalRef.open()}>Delete</button>
```

This mimics an older imperative pattern from React. In Svelte, we prefer reactive data: the parent owns the state, the modal reads and updates it via `bind:`. The benefits:

- State is declarative — you can read "is this modal open?" by reading the parent state at any time.
- No imperative `.open()` calls to track.
- Serializes trivially (e.g., for testing — assert that `deleteModal.open === true`).
- Plays well with SSR (no `ref`s to worry about on the server).

`$bindable` is the idiomatic Svelte way to say "this prop is a state owned by the parent, the child can update it." Use it.

### Note 5: The philosophical difference — "controlled" vs "uncontrolled"

React people know these terms: a **controlled** component has its value owned by the parent (`<input value={x} onChange={setX} />`). An **uncontrolled** component owns its own value (`<input defaultValue={x} />` and read via a ref).

Svelte 5 with `$bindable` makes components controlled by default, with minimal syntax. It's the right default for most cases — explicit state flow, easy to debug, plays well with form submissions and tests. Uncontrolled components have their place (simple inputs with no complex parent logic), but you'll reach for controlled patterns most of the time.

Our modal is fully controlled: the parent owns `deleteModal.open`, the modal reads it, the modal can update it through `bind:` — but the source of truth is always the parent's state.

---

## What's Next

The delete flow is fully functional: click the Delete button, see the modal, confirm or cancel, row disappears. In Lesson 4.8 we'll go back to `supabase/seed.sql` and add 20 realistic seeded contacts, so your testing dataset is rich enough to feel like a real app.

The `$bindable` + callback pattern you learned here will come back in every overlay component — form inputs, toggles, toasts, dropdowns. You now know the shape. Every feature from here on will reuse it.
