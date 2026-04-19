---
title: '4.5 - Reading Contacts'
module: 4
lesson: 5
moduleSlug: 'module-04-crud'
lessonSlug: '05-reading-contacts'
description: 'Build the contacts list page — loading, displaying, and searching all contacts for the logged-in user.'
duration: 12
preview: false
---

## Overview

This is the lesson where Contactly starts to feel like a real app. By the end, a logged-in user visits `/contacts`, sees a clean table of every contact they own, can filter the list in real time with a search box, and sees a friendly empty state on day one.

Along the way you'll meet ideas that show up on **every** list page you'll ever build: loading data on the server, relying on Row-Level Security (RLS) instead of manually filtering by user, choosing between client-side and server-side search, and using Svelte 5's `$derived` for instant filtering.

No mutation in this lesson — create, edit, and delete come in 4.6–4.8. Here we only read.

## Prerequisites

- Module 3 complete — your `(app)` layout redirects unauthenticated users to `/login` and `locals.getUser()` works in server code.
- Lesson 4.1 complete — the `contacts` table exists with an RLS policy that restricts reads to the row owner (`user_id = auth.uid()`).
- Lesson 4.2 complete — you seeded at least a few contacts for your own user so the page renders something real on first load.
- Lesson 4.3 complete — `database.types.ts` has been generated and `Tables<'contacts'>` resolves to the proper row type.

## What You'll Build

- A server load function at `src/routes/(app)/contacts/+page.server.ts` that fetches all contacts for the logged-in user, sorted alphabetically.
- A page at `src/routes/(app)/contacts/+page.svelte` with:
  - A header showing "Contacts" + the total count + a "New contact" button.
  - A search input wired to `$state('')` with `bind:value`.
  - A `<table>` of contacts with name, email, company, and per-row Edit + Delete buttons.
  - A dedicated empty-state card for first-time visitors.
  - A client-side **filtered** list built with `$derived` that reacts instantly as the user types.

---

## First Principles — What a "List Page" Really Is

Strip away the framework jargon and a list page is three things:

1. **Fetch.** Ask the database for rows the current user is allowed to see.
2. **Shape.** Make the result predictable — always an array, always sorted the same way, nulls handled.
3. **Render.** Put the rows on screen, plus the affordances (search, actions, empty state) that turn a raw list into a usable interface.

Every CRUD app you'll ever build — Gmail's inbox, Stripe's customer list, Linear's issue view — is this pattern scaled up. Each step has a "naive" version (unordered `select *`, rows dumped in a div) and a "professional" version (stable ordering, typed result, explicit errors, empty state, search). We're doing the professional version on the first pass because bad habits compound over dozens of future list pages.

---

## The Route Layout

The contacts page lives inside the `(app)` route group — the group with the authenticated layout (navbar, sidebar, session required). File tree:

```
src/routes/(app)/contacts/
├── +page.server.ts      ← NEW — loads contacts
└── +page.svelte         ← NEW — renders the list
```

Two files. A server file that returns data and a component that renders it. That's the whole feature when you stay inside SvelteKit's grain.

```bash
mkdir -p 'src/routes/(app)/contacts'
```

(The single quotes keep the shell from interpreting the parentheses.)

---

## The Server Load Function

Create `src/routes/(app)/contacts/+page.server.ts`:

```typescript
// src/routes/(app)/contacts/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { data: contacts, error: contactsError } = await locals.supabase
		.from('contacts')
		.select('*')
		.order('last_name', { ascending: true })
		.order('first_name', { ascending: true });

	if (contactsError) error(500, 'Failed to load contacts');

	return { contacts: contacts ?? [] };
};
```

### Line-by-line walkthrough

```typescript
import { error } from '@sveltejs/kit';
```

**`error`** throws an HTTP error from a load function. `error(500, 'Failed to load contacts')` **throws** — execution stops, SvelteKit renders the nearest `+error.svelte` with a 500 status. It's a `throw` in disguise, so never write `return error(...)`.

TypeScript-wise, `error()` returns `never`, so code after it is unreachable. After `if (!user) error(401, 'Unauthorized')`, `user` is narrowed to non-null for the rest of the function — runtime safety and compile-time narrowing in one line.

```typescript
import type { PageServerLoad } from './$types';
```

**`./$types`** is auto-generated per route. `PageServerLoad` knows what `locals` contains (from `app.d.ts`), what `params` this route accepts, and ties the return type of `load` to `PageData` in `+page.svelte`. Add a field to the returned object and `PageData` updates everywhere.

```typescript
export const load: PageServerLoad = async ({ locals }) => {
```

**`load`** is the magic name — SvelteKit runs it before rendering. Its return becomes the `data` prop in `+page.svelte`. **`async`** because we await twice. **`({ locals })`** destructures the only field we need.

```typescript
const user = await locals.getUser();
if (!user) error(401, 'Unauthorized');
```

**Defense in depth.** The `(app)` group's `+layout.server.ts` already redirects unauthenticated users, so in practice `user` is always set. Still worth it: (1) future-proofing — if someone restructures the group or refactors the guard, this page doesn't silently leak, it fails loud; (2) type narrowing — without it, `user` is `User | null` everywhere below. We use `error(401, ...)` rather than `redirect()` because reaching this point is a **bug**, not a user flow. Bugs belong in logs.

```typescript
const { data: contacts, error: contactsError } = await locals.supabase
	.from('contacts')
	.select('*')
	.order('last_name', { ascending: true })
	.order('first_name', { ascending: true });
```

**Destructure and rename.** Supabase returns `{ data, error }` from every query. Writing `{ data, error }` would shadow the imported `error` helper — the next `error(500, ...)` would call the Supabase error object as a function. Renaming dodges it.

**`.from('contacts')`** picks the table, autocompleted via our generated `Database` type (Lesson 4.3). **`.select('*')`** returns every column — critiqued in Principal Engineer notes, fine for a small table.

**Two `.order()` calls** produce a **stable** sort: ties on `last_name` break on `first_name`. Postgres emits `ORDER BY last_name ASC, first_name ASC`. Without the tiebreaker, two Smiths appear in a different order on every reload — the list "flickers" between refreshes. A stable sort renders identically every time. Cheap to add, big UX win. `{ ascending: true }` is the default, but being explicit reads better.

```typescript
if (contactsError) error(500, 'Failed to load contacts');
return { contacts: contacts ?? [] };
```

If the query fails — network blip, Postgres down, RLS rejection — bail with a 500. Don't leak the raw error; it'd expose internals. Generic message for the user, full error in server logs. **500, not 400:** 4xx = client's fault, 5xx = server's fault. A user asking for their own contacts hasn't done anything wrong.

**`contacts ?? []`** shapes the response. Supabase types `data` as `T[] | null`. Forcing `[]` gives a simpler template (`data.contacts.length` with no null checks) and type stability (`{ contacts: Tables<'contacts'>[] }`, never nullable). Two-character habit, whole class of bugs gone.

---

## Why RLS means no manual `.eq('user_id', user.id)`

Look at the server code and ask: how does it only return **my** contacts? I never filtered by `user_id`.

That's the whole point of Row-Level Security. In Lesson 4.1 we added:

```sql
create policy "users can read their own contacts"
  on contacts for select
  using (auth.uid() = user_id);
```

Postgres applies this policy to **every** query through the user-scoped client. So `locals.supabase.from('contacts').select('*')` becomes:

```sql
select * from contacts where auth.uid() = user_id;
```

You didn't write that `WHERE`. Postgres wrote it, based on the JWT cookie your client is carrying. RLS is the real access control; the client code is a thin wrapper.

### Should you add `.eq('user_id', user.id)` as defense in depth?

You could:

```typescript
.from('contacts')
.select('*')
.eq('user_id', user.id)   // belt-and-suspenders
.order(...)
```

**For it:** if someone disables the RLS policy by mistake (migrations go wrong, Friday hotfixes happen), the explicit filter is still there. Two locks are better than one.

**Against:** it's code that **looks** like it does something but actually doesn't — RLS already enforces it. Teammates read it later, wonder "wait, is RLS untrustworthy?", and cargo-cult the filter onto every query, adding noise.

**Contactly's convention:** we rely on RLS. We do not add the `.eq()`. Instead, we **test** the RLS policy directly — Module 4 includes tests that query with the wrong user and assert zero rows returned. A verified policy is worth more than a redundant filter that pretends to verify.

Reasonable people disagree. Many Supabase teams add the `.eq()`. The only bad choice is adding it **sometimes** — inconsistency is worse than either extreme. Pick one and make it the house style.

---

## The Page Component

Create `src/routes/(app)/contacts/+page.svelte`:

```svelte
<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state('');

	const filtered = $derived(
		search.trim() === ''
			? data.contacts
			: data.contacts.filter((c) =>
					`${c.first_name} ${c.last_name} ${c.email ?? ''} ${c.company ?? ''}`
						.toLowerCase()
						.includes(search.toLowerCase())
				)
	);
</script>

<div class="mx-auto max-w-5xl px-4 py-8">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Contacts</h1>
			<p class="text-sm text-gray-500">{data.contacts.length} total</p>
		</div>
		<a
			href="/contacts/new"
			class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
		>
			New contact
		</a>
	</div>

	{#if data.contacts.length === 0}
		<div class="rounded-xl border border-gray-200 bg-white p-12 text-center">
			<h2 class="mb-2 text-lg font-semibold text-gray-900">No contacts yet</h2>
			<p class="mb-4 text-gray-500">Get started by adding your first contact.</p>
			<a
				href="/contacts/new"
				class="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				Create your first contact
			</a>
		</div>
	{:else}
		<div class="mb-4">
			<input
				type="search"
				bind:value={search}
				placeholder="Search contacts..."
				class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
			/>
		</div>

		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
			<table class="w-full text-sm">
				<thead class="border-b border-gray-200 bg-gray-50">
					<tr>
						<th class="px-4 py-2 text-left font-medium text-gray-700">Name</th>
						<th class="px-4 py-2 text-left font-medium text-gray-700">Email</th>
						<th class="px-4 py-2 text-left font-medium text-gray-700">Company</th>
						<th class="px-4 py-2 text-right font-medium text-gray-700">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as contact (contact.id)}
						<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50">
							<td class="px-4 py-2 text-gray-900">
								{contact.first_name}
								{contact.last_name}
							</td>
							<td class="px-4 py-2 text-gray-600">{contact.email ?? '—'}</td>
							<td class="px-4 py-2 text-gray-600">{contact.company ?? '—'}</td>
							<td class="px-4 py-2 text-right">
								<a href="/contacts/{contact.id}/edit" class="mr-3 text-blue-600 hover:underline">
									Edit
								</a>
								<form method="POST" action="?/delete" class="inline">
									<input type="hidden" name="id" value={contact.id} />
									<button
										type="submit"
										class="text-red-600 hover:underline"
										onclick={(e) => {
											if (!confirm('Delete this contact?')) e.preventDefault();
										}}
									>
										Delete
									</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="px-4 py-8 text-center text-gray-500">
								No contacts match "{search}".
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
```

A lot of markup. Four bites: script, header, empty state, table.

### The script block

```typescript
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
```

**`PageData`** is SvelteKit's auto-generated type for whatever `load` returned — here, `{ contacts: Tables<'contacts'>[] }`. Edit the load function and `PageData` updates everywhere. **`$props()`** returns a reactive proxy; destructuring `data` means when a parent re-renders with new data, `data` here updates automatically.

```typescript
let search = $state('');
```

**`$state('')`** creates a reactive variable. When `search` changes, any template expression that reads it re-renders. We'll wire it to `<input bind:value={search} />` below.

```typescript
const filtered = $derived(
	search.trim() === ''
		? data.contacts
		: data.contacts.filter((c) =>
				`${c.first_name} ${c.last_name} ${c.email ?? ''} ${c.company ?? ''}`
					.toLowerCase()
					.includes(search.toLowerCase())
			)
);
```

`$derived(expression)` recomputes every time any `$state` it reads changes. This one reads `search` (and `data.contacts`, reactive via `$props()`), so it re-filters on every keystroke.

- **`search.trim() === ''`** — empty (or whitespace-only) box? Return the whole list untouched.
- **Template literal** — build `"Ada Lovelace ada@example.com Analytical Engine"` per contact, lowercase, substring-check against the lowercased search term.
- **`c.email ?? ''`** — nullable columns. `undefined` in a template literal prints as `"undefined"` — typing "und" would match every contact with no email. Coalescing fixes it.

One concatenated string instead of per-field checks because users don't know which column their term lives in. Typing "acme" should find it in name **or** email **or** company. O(n), cheap.

**`const` vs `let` for `$derived`?** Convention: `const` for deriveds (you never reassign — Svelte recomputes), `let` for states (you reassign via `search = 'new value'`).

### The header

Title and count on the left, "New contact" button on the right — standard Tailwind flexbox. Note `{data.contacts.length}` — we show the **total**, not the filtered count. Users want "how many contacts do I have?", not "how many match my current search." If you wanted both, `{filtered.length} of {data.contacts.length}` reads nicely.

The button is an `<a>`, not a `<button>`, because clicking it **navigates** (`/contacts/new`, built in Lesson 4.6). Anchors navigate; buttons perform in-page actions. This matters for screen readers, keyboard users, and right-click-open-in-new-tab support.

### The empty state

The empty state isn't polish — it's core UX. Day one, every user's contacts list is empty. A blank page tells them nothing. A friendly "No contacts yet. Create your first one" with a giant button tells them exactly what to do.

**Every list view in your app needs a designed empty state.** It **will** be empty on day one for every user you onboard. Design day one as carefully as day 1000.

The empty-state branch comes **before** the search input. Zero contacts means nothing to search — showing a search box on an empty list is confusing. One `{#if}` cleanly separates "onboarding" from "managing a full list."

### The table

A few things worth calling out.

**`{#each filtered as contact (contact.id)}`** — the `(contact.id)` is a **keyed each block**. Svelte uses the key to track which DOM node corresponds to which row across re-renders. Without a key, a filter change could reuse the wrong `<tr>` — the row that said "Ada Lovelace" briefly flashes "Grace Hopper" mid-update. With the key, Svelte rebinds the right nodes. **Always key each blocks over identified data.**

We loop `filtered`, not `data.contacts` — that's the whole point of the derived value.

**`{:else}` inside `{#each}`** runs when the array is empty. It handles "user typed a search term that matches nothing." This is **different** from the page-level empty state: `data.contacts.length === 0` means "this user has no contacts" (show onboarding). `filtered.length === 0` with contacts > 0 means "no matches for your search" (show a hint, don't hide the search box). Two similar-looking empties, two different UX flows.

**The delete form:**

```svelte
<form method="POST" action="?/delete" class="inline">
  <input type="hidden" name="id" value={contact.id} />
  <button type="submit" onclick={...}>Delete</button>
</form>
```

- **`method="POST"`** — required for form actions.
- **`action="?/delete"`** — the `?/name` syntax says "submit to the `delete` named action in this page's `+page.server.ts`." We haven't written it yet — **coming in Lesson 4.7**. For now the form submits to a 404.
- **`<input type="hidden" name="id" value={contact.id} />`** — carry the row id with the submission. Classic HTML.
- **`class="inline"`** — `<form>` is block by default, which would break the row layout.
- **`onclick={(e) => { if (!confirm(...)) e.preventDefault() }}`** — shows the native confirm dialog and cancels submission on Cancel. Ugly but effective. We'll replace it with a nicer modal in Module 8.

---

## Client-Side Search vs Server-Side Search

Our search runs **entirely in the browser**. The server ships all contacts on page load; the filter runs on the in-memory array as the user types. No round-trip per keystroke, no debouncing — instant.

For 100–1,000 contacts, this is the right call. The math:

| Contacts | Payload | Filter time | Verdict            |
| -------- | ------- | ----------- | ------------------ |
| 100      | ~15 KB  | <1 ms       | Great              |
| 1,000    | ~150 KB | ~5 ms       | Fine               |
| 10,000   | ~1.5 MB | ~50 ms      | Janky initial load |
| 100,000  | ~15 MB  | Frozen tab  | Broken             |

Crossover around **5,000–10,000 rows**. Below, client-side wins (no spinners, no debouncing, no endpoint). Above, switch to server-side `ilike` queries with debouncing plus pagination. Don't over-engineer day one — ship the simple version, revisit in Module 10.

---

## Common mistakes

**Forgetting `contacts ?? []`.** If `data.contacts` is ever `null`, `data.contacts.length` throws and the page crashes. The `?? []` in the load function kills an entire class of bugs.

**Destructuring `{ data, error }` without renaming.** You'll shadow the imported `error` from `@sveltejs/kit` — the next `error(500, ...)` calls the Supabase error object as a function. Always rename: `{ data: contacts, error: contactsError }`.

**Single `.order()` on a non-unique column.** Two Smiths can swap places between reloads. Always tiebreak with a second `.order()` (or fall back to `id`).

**Rendering `c.email` directly when it can be null.** Svelte prints `null` as nothing but `undefined` as the literal string `"undefined"`. In filter template literals, a missing `?? ''` means searches can match "undefined" unexpectedly. Always coalesce nullable fields.

**Looping over `data.contacts` instead of `filtered`.** One-letter typo, symptom is "my search box does nothing." If the table isn't reacting, check which array `{#each}` is iterating.

**Missing `(contact.id)` key in `{#each}`.** Rows visually reused across filter changes — "Ada" briefly flashes "Grace." Always key.

**Using `$:` or `export let`.** Runes-only Svelte 5. `$:` is Svelte 4 reactivity, `export let` is Svelte 4 props. Use `$derived` and `$props()`.

**Calling `error()` with `return`.** `error(500, '...')` throws — it never returns. `return error(...)` works but misleads readers into thinking a value is returned. Just call it bare.

**Trusting client search at 50,000 rows.** A 50 MB JSON payload freezes the tab for seconds on initial load. Profile real payloads early and switch server-side before users complain.

---

## Principal Engineer notes

**`select('*')` vs explicit columns.** We used `select('*')` for simplicity. In production codebases with wider tables (50+ columns, JSON blobs), always select only what you render: `select('id, first_name, last_name, email, company')`. Smaller payload, smaller JSON parse, less memory, and — people forget — **stability across migrations**. If a teammate adds a `private_notes` column, `select('*')` silently ships it to every user's browser. Explicit lists force you to notice.

**The N+1 problem.** A contact is flat today. Tomorrow it has tags (join table), notes, a `deal_value`. The naive approach — loop contacts and query per row — is **N+1**: one query for the list, one per row. 1,000 contacts = 1,001 round-trips. PostgREST's fix: `select('*, tags(*)')` returns contacts with tags in one query via `LATERAL JOIN`. Rule: **loop-and-query → rewrite as a nested select.**

**Pagination strategies.**

1. **Offset** — `.range(0, 49)`, `.range(50, 99)`. Simple but slow on large tables (Postgres scans and discards) and buggy when rows are inserted mid-pagination. Fine up to ~10k rows.
2. **Keyset (cursor)** — "give me 50 rows **after** `(last_name='Smith', id=xyz)`." Index lookup, constant time regardless of page depth. Tradeoff: next/previous only. How Gmail, Twitter, and Stripe paginate.
3. **Virtual / infinite scroll** — UI pattern on top of either.

Contactly uses keyset in Module 10.

**Client vs server filter — deeper tradeoffs.** Client-side wins when the dataset fits in memory, instant feedback matters, or you want offline resilience. Server-side wins when the dataset is large, search targets columns not shipped to the client (encrypted notes), you need full-text search with stemming (`tsvector`), or mobile data budgets matter. A hybrid loads the first 200 rows client-side, filters locally, and triggers a server search after 3 seconds of idle typing or when local results return 0.

**Why indexes on sorted columns matter.** `.order('last_name')` forces Postgres to pick: (1) read every row and sort in memory (O(n log n)) or (2) walk a B-tree index (O(log n)). At 100k rows, unindexed = seconds per query. Fix:

```sql
create index contacts_sort_idx
  on contacts (user_id, last_name, first_name);
```

`user_id` is first because it's the equality filter (RLS — `WHERE user_id = auth.uid()`), and B-trees serve equality on leading columns. Then `last_name, first_name` match the sort order, so Postgres streams rows directly out of the index. Added in Module 10; worth **knowing** from day one.

**Load on the server, not `onMount`.** Don't move the fetch into `onMount` with `fetch()`: empty render → flicker, no SEO, lost `PageData` typing, extra round-trip. `+page.server.ts` is the right home for data a page needs.

**Count from `.length`, not a count query.** You might add `.select('*', { count: 'exact' })`. Unnecessary — we already have every row in memory. Only add a count query when you're **not** fetching all rows (paginated "showing 50 of 12,403").

**Sorting by computed columns.** When someone asks "sort by full name?", the cleanest answer is usually a `full_name` generated column on the table, indexed, sorted on. Sorting on expressions without an index is a performance cliff.

---

## What's next

You can read contacts. In **Lesson 4.6 — Creating Contacts** you'll build the `/contacts/new` page: a form that creates a new row via a SvelteKit form action, validates with Zod v4, and redirects to the list on success. **Lesson 4.7** wires up the delete button you just rendered. **Lesson 4.8** handles editing. By the end of Module 4, CRUD is complete and Contactly is a usable app.
