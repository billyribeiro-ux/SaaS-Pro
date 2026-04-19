---
title: 'Remote Functions — the 2026 way'
module: 14
lesson: 7
moduleSlug: thank-you
lessonSlug: remote-functions
description: 'Type-safe client-server RPC with $app/server. Replace load functions, form actions, and API endpoints with one unified pattern.'
duration: 45
preview: false
---

# Bonus: Remote Functions — the 2026 way to talk to your server

You have finished Contactly. The app works. Users sign up, contacts get saved, Stripe charges cards, webhooks fire. Every piece of it is wired up using the three patterns SvelteKit has shipped since day one:

1. **Load functions** (`+page.server.ts`) for reading data on page navigation.
2. **Form actions** (`export const actions = ...`) for writing data from `<form>` submissions.
3. **`+server.ts` endpoints** for everything else — API routes called via `fetch`, webhooks, OAuth callbacks.

Three patterns. Three different ergonomics. Three different type-safety stories. And a surprising amount of duplication — the same validation logic showing up in a load function, a form action, and an endpoint because a feature happens to be reachable from all three.

In August 2025 the SvelteKit team shipped **Remote Functions** in 2.27 as an experimental feature. By April 2026 the API has stabilized, the DX has hardened, and most new SvelteKit apps being built today are using remote functions as their primary server-communication layer. The three old patterns still exist — they are not deprecated — but a huge class of "I want to read or write data" code now collapses into a single file.

This lesson teaches remote functions end-to-end. Not theoretically — we will refactor Contactly's contact list feature away from the three-pattern layout into a single `contacts.remote.ts` file, and you will see how every lesson you already learned (auth, Supabase, Zod validation, optimistic UI) maps onto the new world.

By the end of this lesson you will:

- Understand the problem remote functions solve and when _not_ to use them.
- Turn on the two experimental flags safely in `svelte.config.js`.
- Know the four flavors — `query`, `form`, `command`, `prerender` — and when each is the right tool.
- Refactor a full page of Contactly (load function + form action + API endpoint) into one remote file.
- Use single-flight mutations to refresh queries in the same HTTP round-trip as a write.
- Validate inputs with Zod v4, and understand what `'unchecked'` opt-out actually costs you.
- Handle deduplication, reactive-context anchoring, and the `.run()` escape hatch.
- Solve the n+1 fetch problem with `query.batch`.
- Use preflight validation for instant field-level feedback before the network.
- Protect sensitive fields (passwords, card numbers) from being reflected back to the browser.

Let's start with the problem.

## 1. The problem: three ways to talk to the server

Open Contactly in your editor. Find the contact list feature. Count the files involved in "list, create, delete, and search contacts":

```
src/routes/(app)/contacts/+page.server.ts   # load() + actions.create() + actions.delete()
src/routes/(app)/contacts/+page.svelte      # renders data, uses enhance() for forms
src/routes/api/contacts/search/+server.ts   # GET handler for typeahead search
```

Now open `+page.server.ts`. You have three things in that one file:

```ts
export const load = async ({ locals }) => {
	/* read contacts */
};
export const actions = {
	create: async ({ request, locals }) => {
		/* write contact */
	},
	delete: async ({ request, locals }) => {
		/* delete contact */
	}
};
```

Each of these is a slightly different function signature. `load` gets `{ locals, params, url }`. `actions` get `{ request, locals, params, url, cookies }`. The API endpoint in `search/+server.ts` gets a full `RequestEvent`. Each one parses its inputs differently — load reads `url.searchParams`, actions read `await request.formData()`, the endpoint reads `url.searchParams` again. Each one returns a different shape — load returns a plain object, actions return objects augmented with `fail()` or `redirect()`, and endpoints return a `Response` (usually via `json()`).

On the client, there are three different consumption patterns:

- Load data arrives via the `data` prop on your `+page.svelte`.
- Form action results arrive via the `form` prop (or via `enhance`).
- API endpoint results arrive via a manual `fetch('/api/contacts/search?q=...')` call.

Each one has a different type-safety story. Load data is typed via `PageData`. Form data is typed via `ActionData`. API endpoints are _not typed at all_ — you wrote a `+server.ts` that returns `json({ results })`, but the `fetch` call in your component has no idea what `results` contains. You have to either define a shared type and hope both sides stay in sync, or cast the response and pray.

Zoom out. The three patterns exist because they solve slightly different problems — and that is legitimate. But in practice, 80% of the code in a typical CRUD app is "read a list, write a new item, delete an item." That code does not need three different ergonomics. It needs one.

**Remote functions are that one.** They are type-safe, keyed, cache-aware, progressively-enhanceable RPC. You write a function on the server. You import it on the client. You call it. The framework handles the HTTP.

## 2. Opt-in setup

Remote functions are still flagged `experimental` as of SvelteKit 2.57. That word deserves a principal-engineer definition, because "experimental" in SvelteKit-speak is not "do not ship this to production."

**What "experimental" means here:**

- The feature is production-usable. Teams are running it at scale.
- The API surface is **not frozen** — the SvelteKit team reserves the right to change argument shapes, method names, or error behaviors in a minor release.
- Changes will always come with a migration path and deprecation warnings. You will not wake up to a silently broken deploy.
- You must opt in explicitly in `svelte.config.js`. This is deliberate — it prevents the team from accidentally locking in API choices by having too many apps depend on current shapes.

Practically: if you are shipping a new app in 2026 and can tolerate one day of migration work per year, turn it on. If you are maintaining a 50-page SvelteKit app that cannot afford any instability, wait for the `experimental` flag to drop.

### `svelte.config.js`

```js
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		experimental: {
			remoteFunctions: true
		}
	},
	compilerOptions: {
		experimental: {
			async: true
		}
	}
};

export default config;
```

Line-by-line:

- **`kit.experimental.remoteFunctions: true`** — tells SvelteKit to look for `*.remote.ts` / `*.remote.js` files, generate HTTP endpoints for their exports, and generate the corresponding client-side `fetch` wrappers. Without this flag, a `.remote.ts` file is just a regular module and its server imports will leak to the client (you will get a build error when Supabase tries to use Node APIs in the browser).

- **`compilerOptions.experimental.async: true`** — tells the Svelte compiler to allow `await` in component templates and `<script>` tags. Remote functions return `Promise`s, so you need this to write `{#each await getContacts() as c}` directly in markup. Without this flag you are forced to use the `.loading` / `.error` / `.current` object form, which is more verbose.

You need **both** flags. Remote functions work without the async flag (you just use the verbose form), but the whole point of the DX improvement is templates that read like synchronous code with `await` sprinkled in. Turn them both on together.

### A warning about cache

When you flip these flags, Vite will rebuild and you may see type-generation glitches. Stop the dev server, delete `.svelte-kit`, and run `pnpm dev` fresh. If your editor's TypeScript server gets confused about the generated types, reload the TS server (in VS Code: Cmd+Shift+P → "TypeScript: Restart TS Server").

## 3. The four flavors

Remote functions come in four flavors. Each one is a simple wrapper imported from `$app/server`. Here is the mental model:

| Flavor      | What it does                                                              | Replaces                                                            |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `query`     | Read data. Cached by argument. Re-runs when you call `.refresh()`.        | `+page.server.ts` load functions, GET endpoints                     |
| `form`      | Write data, triggered by a `<form>` submission. Degrades without JS.      | Form actions                                                        |
| `command`   | Write data, triggered by JS (button click, keypress, timer). Requires JS. | `fetch('/api/...')` POST/DELETE calls                               |
| `prerender` | Read data at **build time**. Output is static.                            | Static `+page.server.ts` loads with `export const prerender = true` |

A few principles to internalize:

- **`query` vs `prerender`** — same API shape, different execution time. `query` runs per request; `prerender` runs once during `vite build` and the result becomes a static file served from your CDN. If your data only changes per deploy (your marketing pages, your blog index), use `prerender`.

- **`form` vs `command`** — both write data. Use `form` whenever the mutation is initiated from a `<form>` element, because SvelteKit will generate a real `action=/...` attribute that works even if JavaScript fails to load. Use `command` for things where a form makes no sense: liking a post, toggling a todo, triggering an optimistic reorder.

- **All four are just functions.** You export them from a `.remote.ts` file. You import them on the client. You call them. Under the hood, SvelteKit generates a POST endpoint at a predictable URL, the client sends JSON-over-HTTP with devalue serialization (which handles `Date`, `Map`, `Set`, etc.), the server runs your function, and the result comes back.

## 4. Refactoring Contactly's contact list

Let's do the real work. Here is Contactly's contact list feature **before** — three files, three patterns.

### Before: `src/routes/(app)/contacts/+page.server.ts`

```ts
import { error, fail, redirect } from '@sveltejs/kit';
import * as z from 'zod';
import type { Actions, PageServerLoad } from './$types';

const contactSchema = z.object({
	first_name: z.string().min(1, 'First name required'),
	last_name: z.string().min(1, 'Last name required'),
	email: z.email(),
	phone: z.string().optional(),
	company: z.string().optional()
});

export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) redirect(303, '/login');

	const { data, error: dbError } = await locals.supabase
		.from('contacts')
		.select('*')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false });

	if (dbError) error(500, dbError.message);
	return { contacts: data ?? [] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) return fail(401, { message: 'Unauthorized' });

		const formData = await request.formData();
		const raw = Object.fromEntries(formData);
		const parsed = contactSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { errors: parsed.error.flatten().fieldErrors, values: raw });
		}

		const { error: dbError } = await locals.supabase
			.from('contacts')
			.insert({ ...parsed.data, user_id: user.id });
		if (dbError) return fail(500, { message: dbError.message });

		return { success: true };
	},

	delete: async ({ request, locals }) => {
		const user = await locals.getUser();
		if (!user) return fail(401, { message: 'Unauthorized' });

		const formData = await request.formData();
		const id = formData.get('id');
		if (typeof id !== 'string') return fail(400, { message: 'Invalid id' });

		const { error: dbError } = await locals.supabase
			.from('contacts')
			.delete()
			.eq('id', id)
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: dbError.message });

		return { success: true };
	}
};
```

### Before: `src/routes/api/contacts/search/+server.ts`

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return json({ results: [] });

	const { data, error: dbError } = await locals.supabase
		.from('contacts')
		.select('*')
		.eq('user_id', user.id)
		.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
		.limit(10);

	if (dbError) error(500, dbError.message);
	return json({ results: data ?? [] });
};
```

### Before: `src/routes/(app)/contacts/+page.svelte` (abbreviated)

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let query = $state('');
	let results = $state<Contact[]>([]);

	async function search() {
		if (query.length < 2) {
			results = [];
			return;
		}
		const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
		const json = await res.json();
		results = json.results;
	}
</script>

<input bind:value={query} oninput={search} />
<ul>
	{#each results as r}<li>{r.first_name}</li>{/each}
</ul>

<form method="POST" action="?/create" use:enhance>
	<input name="first_name" />
	<input name="last_name" />
	<input name="email" />
	<button>Create</button>
</form>

<ul>
	{#each data.contacts as c}
		<li>
			{c.first_name}
			{c.last_name}
			<form method="POST" action="?/delete" use:enhance>
				<input type="hidden" name="id" value={c.id} />
				<button>Delete</button>
			</form>
		</li>
	{/each}
</ul>
```

Walk through what is painful:

- **Three files.** If you want to understand "how contacts work", you open three files and hold the mental model of three different runtime lifecycles.
- **Auth is duplicated three times.** `await locals.getUser()` with an `if (!user)` guard appears in load, in each action, and in the API endpoint. Any change (e.g., you want to rate-limit) must be applied three times.
- **Validation is split.** The form action validates with Zod. The API endpoint does ad-hoc checks on `q.length`. The load function does no validation because it takes no input.
- **The search endpoint is untyped on the client.** `json.results` is `any`. If you rename `first_name` to `firstName` in the DB, TypeScript does not catch that the client is still reading `first_name`.
- **Single-flight mutations do not happen.** After `create` or `delete`, SvelteKit re-runs the load function on a subsequent navigation, but the action response itself does not carry the fresh contact list. You pay for two round-trips.

### After: `src/routes/(app)/contacts/contacts.remote.ts`

One file. All the server logic.

```ts
import * as z from 'zod';
import { error, redirect } from '@sveltejs/kit';
import { query, form, command, getRequestEvent } from '$app/server';

const contactSchema = z.object({
	first_name: z.string().min(1, 'First name required'),
	last_name: z.string().min(1, 'Last name required'),
	email: z.email(),
	phone: z.string().optional(),
	company: z.string().optional()
});

async function requireUser() {
	const { locals } = getRequestEvent();
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');
	return { user, supabase: locals.supabase };
}

export const getContacts = query(async () => {
	const { user, supabase } = await requireUser();
	const { data, error: dbError } = await supabase
		.from('contacts')
		.select('*')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false });
	if (dbError) error(500, dbError.message);
	return data;
});

export const searchContacts = query(z.string().min(2).max(50), async (q) => {
	const { user, supabase } = await requireUser();
	const { data, error: dbError } = await supabase
		.from('contacts')
		.select('*')
		.eq('user_id', user.id)
		.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
		.limit(10);
	if (dbError) error(500, dbError.message);
	return data;
});

export const createContact = form(contactSchema, async (data) => {
	const { user, supabase } = await requireUser();
	const { error: dbError } = await supabase.from('contacts').insert({ ...data, user_id: user.id });
	if (dbError) error(500, dbError.message);

	void getContacts().refresh();

	return { success: true };
});

export const deleteContact = command(z.uuid(), async (id) => {
	const { user, supabase } = await requireUser();
	const { error: dbError } = await supabase
		.from('contacts')
		.delete()
		.eq('id', id)
		.eq('user_id', user.id);
	if (dbError) error(500, dbError.message);

	void getContacts().refresh();
});
```

Line-by-line walkthrough — this is the heart of the lesson.

**Lines 1–3: imports.**

- `import * as z from 'zod'` — the Zod v4 idiom. Do not use `import { z }` for Zod v4; the namespace-import pattern is what the v4 team recommends and what Standard Schema expects.
- `import { error, redirect } from '@sveltejs/kit'` — the same `error()` and `redirect()` helpers you used in load functions. They work identically inside remote functions.
- `import { query, form, command, getRequestEvent } from '$app/server'` — the four flavors plus the magic function. `getRequestEvent()` is how you access `locals`, `cookies`, `url`, etc. without passing them through function arguments. We will come back to this.

**Lines 5–11: the Zod schema.** This is unchanged from the old form action. Zod v4 uses `z.email()` as a top-level validator (in v3 it was `z.string().email()`). Nothing SvelteKit-specific here.

**Lines 13–18: `requireUser()` helper.** Authentication is factored into one function. Inside a remote function you _do not_ receive an event parameter — but you can get it at any time by calling `getRequestEvent()`. This is a huge ergonomic win: you write small helper functions that reach for the current request without threading an `event` argument through every layer of your code. The `locals.getUser()` call works exactly as it does in a load function, and throwing with `error(401, ...)` aborts the request with a 401 response and a JSON error body.

**Lines 20–29: `getContacts` query.** This replaces the `load` function. `query()` takes a single async function and returns a wrapped version that:

- On the client, is a `fetch` wrapper that POSTs to a generated endpoint.
- On the server, runs the function and serializes the result with devalue.
- Is keyed by its arguments (no arguments here, so it is keyed as just "this query").
- Supports `.refresh()`, `.set(...)`, `.withOverride(...)`, etc.

Notice there are no parameters and no explicit typing — the return type of the async callback is inferred all the way through to the client. When you call `getContacts()` in `+page.svelte`, TypeScript knows the shape is `Contact[]`.

**Lines 31–39: `searchContacts` query with an argument.** The first argument to `query()` is a Zod schema for the input. SvelteKit uses Standard Schema to call `.parse()` on it before your handler runs. If the input fails validation, your handler never executes and the client gets an error. The `.min(2).max(50)` constraint does two things: it stops empty searches from hitting the DB, and it caps the search string at a sane length to prevent abuse.

**Lines 41–50: `createContact` form.** Three things to note:

1. The first argument is the schema (same Zod object). The second argument is the handler. The handler receives the **parsed, typed data** — not `FormData`. SvelteKit builds the `data` object from your submitted form inputs and runs it through Zod. If validation fails, your handler never runs.
2. `void getContacts().refresh()` — this is the single-flight mutation. More on this in the next section.
3. `return { success: true }` — the return value becomes `createContact.result` on the client, available for showing a toast or a success message.

**Lines 52–61: `deleteContact` command.** A command is like a form, but it has no progressive-enhancement fallback. It is called from JavaScript. The schema here is `z.uuid()` — a single string that must be a valid UUID. Note that we call `.eq('user_id', user.id)` in the delete — this is the defense-in-depth RLS pattern you already know. Even if someone crafts a POST that bypasses the Zod check, they still cannot delete other users' contacts because Supabase Row-Level Security blocks it and the `.eq` guard is redundant insurance.

### After: `src/routes/(app)/contacts/+page.svelte`

```svelte
<script lang="ts">
	import { getContacts, searchContacts, createContact, deleteContact } from './contacts.remote';

	let query = $state('');
</script>

<svelte:boundary>
	{#snippet pending()}
		<p>Loading contacts...</p>
	{/snippet}

	{#snippet failed(err, reset)}
		<p>Could not load: {err.message}</p>
		<button onclick={reset}>Retry</button>
	{/snippet}

	<section>
		<h2>Search</h2>
		<input bind:value={query} placeholder="Type at least 2 characters..." />

		{#if query.length >= 2}
			<ul>
				{#each await searchContacts(query) as c (c.id)}
					<li>{c.first_name} {c.last_name}</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2>Add contact</h2>
		<form {...createContact}>
			<label>
				First name
				<input {...createContact.fields.first_name.as('text')} />
				{#each createContact.fields.first_name.issues() as i}
					<span class="error">{i.message}</span>
				{/each}
			</label>

			<label>
				Last name
				<input {...createContact.fields.last_name.as('text')} />
				{#each createContact.fields.last_name.issues() as i}
					<span class="error">{i.message}</span>
				{/each}
			</label>

			<label>
				Email
				<input {...createContact.fields.email.as('email')} />
				{#each createContact.fields.email.issues() as i}
					<span class="error">{i.message}</span>
				{/each}
			</label>

			<button>Add</button>
		</form>

		{#if createContact.result?.success}
			<p class="success">Contact added!</p>
		{/if}
	</section>

	<section>
		<h2>All contacts</h2>
		<ul>
			{#each await getContacts() as contact (contact.id)}
				<li>
					{contact.first_name}
					{contact.last_name} — {contact.email}
					<button onclick={() => deleteContact(contact.id)}>Delete</button>
				</li>
			{/each}
		</ul>
	</section>
</svelte:boundary>
```

Line-by-line:

**Lines 1–8: imports.** You import the four remote functions directly from the `.remote.ts` file. The build tool rewrites these into `fetch` wrappers — but the rewrite is invisible, and your IDE sees the real types.

**Line 9: search query state.** A plain `$state()` rune. The search input's value.

**Line 12: `<svelte:boundary>`.** This is the required container when you use `await` in markup with remote functions. The boundary provides a `pending` snippet (shown while the first `await` resolves) and a `failed` snippet (shown if any `await` throws). Without a boundary, `await` in markup would have nowhere to render while resolving and nowhere to render on error.

**Lines 13–15: the `pending` snippet.** Shown exactly once — while the initial page load resolves its async deps. Subsequent re-fetches (after a `.refresh()`) do not re-trigger the pending snippet; they use `$effect.pending()` semantics, which you can layer on top if you want per-query loading spinners.

**Lines 17–20: the `failed` snippet.** Receives the error and a `reset()` callback. `reset()` tears down and re-renders the boundary's children from scratch, which has the effect of re-running any `await` expressions. This is the "try again" button every error UI needs.

**Lines 25–32: search UI.** `bind:value={query}` keeps the state in sync with the input. The `{#if query.length >= 2}` guard matches the Zod `.min(2)` on the server — UI and server agree on the minimum. Inside the block, `await searchContacts(query)` is a real `await` in markup. When `query` changes, Svelte re-evaluates the expression; because `searchContacts` is cached by argument, calling `searchContacts('ab')` twice returns the same promise.

**Lines 35–57: the create form.** Three things are happening:

1. `<form {...createContact}>` — the remote function's spread generates `method="POST"` and a synthetic `action` URL that points at the generated endpoint. If JS is unavailable, the form submits via a normal page POST and SvelteKit renders the page with the form submission applied. If JS is available, SvelteKit attaches itself and submits via `fetch`, no full page reload.

2. `<input {...createContact.fields.first_name.as('text')} />` — this is the field API. Calling `.as('text')` returns an object with `{ type, name, value, aria-invalid, ... }` props. Spreading it gives you correct wiring automatically. You get the right `name` attribute (so FormData works on server), the right `type` attribute (`text`, `email`, `number`, `file`, `checkbox`, `radio`, `submit`, `hidden`), the `aria-invalid` attribute that flips to `true` when validation fails, and the reflected value (so the field repopulates if the form submission fails without JS).

3. `{#each createContact.fields.first_name.issues() as i}` — this renders per-field validation errors. When validation fails, `.issues()` returns `[{ message: 'First name required' }, ...]`. When there are no issues, it returns `[]`. You do not need to manage error state manually.

**Line 63: `createContact.result?.success`** — the success message. The `.result` property holds the return value of the form handler. It is _ephemeral_: it vanishes if the form is resubmitted, if the user navigates away, or if the page reloads. Perfect for a toast that dismisses on the next interaction.

**Lines 67–73: the list.** `{#each await getContacts() as contact (contact.id)}` — await in markup, keyed by `contact.id` (crucial for correct DOM diffing when items move or are deleted). The delete button calls `deleteContact(contact.id)` directly — a plain async function call. No form, no `fetch`, no event boilerplate. Just an RPC.

## 5. Single-flight mutations

This is the feature that makes remote functions worth adopting even if you already have a clean three-file layout.

**The problem:** a mutation changes state on the server. Some of your queries now show stale data. Traditional solutions:

- **After form actions:** SvelteKit automatically re-invalidates load functions on the client after a successful action. This works but requires a second round-trip to fetch the fresh data.
- **After API calls:** you are on your own. Either you refetch manually, or you use a client-side store and update it optimistically.

Both strategies cost either network latency or correctness (optimistic updates can desync from the server).

**Remote functions solve this with single-flight mutations.** In the same HTTP request that ran your mutation, the server can piggyback fresh query results. One round-trip for the write + the refresh.

Look at our `createContact` again:

```ts
export const createContact = form(contactSchema, async (data) => {
	const { user, supabase } = await requireUser();
	await supabase.from('contacts').insert({ ...data, user_id: user.id });
	void getContacts().refresh();
	return { success: true };
});
```

The magic is `void getContacts().refresh()`. Here is what happens:

1. The client POSTs the form data to the generated endpoint.
2. The handler inserts the contact.
3. `getContacts().refresh()` is called **on the server**. SvelteKit intercepts this — it knows "the client has `getContacts()` active in a reactive context; it wants fresh data." The server re-runs `getContacts()`, capturing the new list.
4. The response to the POST contains both the form's return value (`{ success: true }`) _and_ the refreshed query data.
5. The client receives the response. SvelteKit applies the new query data to the `getContacts()` cache on the client. Every component that awaits `getContacts()` instantly sees the new list.

One round-trip. No manual refetch. No optimistic update that could diverge. `void` is there because we do not need to await the refresh — SvelteKit awaits it internally before sending the response.

### `set()` for server-provided results

Sometimes your mutation already has the data the query would fetch. Why re-run the query when the result is right here?

```ts
export const updateContact = form(updateSchema, async (data) => {
	const { user, supabase } = await requireUser();
	const { data: updated, error: dbError } = await supabase
		.from('contacts')
		.update(data)
		.eq('id', data.id)
		.eq('user_id', user.id)
		.select()
		.single();
	if (dbError) error(500, dbError.message);

	getContact(data.id).set(updated);

	return { success: true };
});
```

`getContact(data.id).set(updated)` — the server tells the client "for the `getContact` query keyed by this id, set the value to `updated` directly." No second database hit. Use `.set()` whenever the mutation returns the data the query would have fetched (common with `.update(...).select().single()` in Supabase).

### Client-requested refreshes with `requested()`

The server cannot always know which query arguments the client has active. If a client has `getContacts({ filter: 'starred' })` and `getContacts({ filter: 'archived' })` both rendered, the server does not have that information.

For these cases, the client tells the server: "when you mutate, refresh _my_ instances of this query."

```ts
// Client side
<button onclick={async () => {
  await deleteContact(id).updates(getContacts);
}}>Delete</button>
```

```ts
// Server side
import { requested, command } from '$app/server';

export const deleteContact = command(z.uuid(), async (id) => {
	const { user, supabase } = await requireUser();
	await supabase.from('contacts').delete().eq('id', id).eq('user_id', user.id);

	for (const arg of requested(getContacts, 5)) {
		void getContacts(arg).refresh();
	}
});
```

- `.updates(getContacts)` on the client adds `getContacts` to the list of queries the server should consider refreshing.
- `requested(getContacts, 5)` on the server returns the parsed arguments for the active `getContacts` instances — up to 5. Each one is looped and refreshed.
- The 5 is a safety cap. If the client requests more than 5 refreshes, they are rejected. This stops a malicious client from forcing the server to re-run 10,000 queries in one request.

Shorthand when you just want to refresh without custom logic: `await requested(getContacts, 5).refreshAll()`.

## 6. Validation with Zod v4

Remote functions use [Standard Schema](https://standardschema.dev/) for validation. Standard Schema is a cross-library contract: Zod, Valibot, Arktype, and friends all implement it. SvelteKit does not know or care which library you use — it just calls `.parse()` and trusts the result.

### Zod v4 patterns

```ts
import * as z from 'zod';

const userSchema = z.object({
	email: z.email(),
	age: z.number().int().min(18),
	role: z.enum(['admin', 'user']),
	id: z.uuid(),
	tags: z.array(z.string()).max(5),
	avatar: z.url().optional(),
	password: z.string().min(8).max(128)
});
```

- `z.email()` — top-level validator in v4. Replaces `z.string().email()` from v3.
- `z.uuid()` — same story. Top-level.
- `z.url()` — ditto.
- `z.enum([...])` — single source of truth for enums.

These are the validators you will use 90% of the time in a SaaS app.

### The `'unchecked'` escape hatch

You can skip validation entirely by passing the literal string `'unchecked'`:

```ts
export const getThing = query('unchecked', async (arg: { id: string }) => {
	// arg is typed as { id: string } but NOT runtime-validated
});
```

Why you might want this:

- Internal tooling where the client is trusted and validation overhead matters.
- Complex arguments where you have already validated upstream.

Why it is dangerous:

- **Remote functions are public HTTP endpoints.** Anyone on the internet can POST anything to your generated endpoint. If you do not validate, you are trusting attackers to send well-formed data.
- A typo in one place means undefined behavior. A missing required field gets passed to Supabase, which errors in a way that might leak schema info.
- Your TypeScript types lie about runtime reality.

Default to always validating. Use `'unchecked'` only for internal-only endpoints guarded by IP allowlists or server-only access patterns — and even then, validate anyway.

### Handling validation failures gracefully

By default, if a client sends data that fails validation, they get a generic 400 response. This is deliberate: validation errors can leak schema hints to attackers probing your API.

You can customize the response body with `handleValidationError` in `src/hooks.server.ts`:

```ts
import type { HandleValidationError } from '@sveltejs/kit';

export const handleValidationError: HandleValidationError = ({ event, issues }) => {
	console.warn('validation failed', {
		url: event.url.pathname,
		issues: issues.map((i) => i.message)
	});

	return {
		message: 'Invalid request'
	};
};
```

The return value must match `App.Error` (which defaults to `{ message: string }`). The `issues` are available for server-side logging but **never** returned to the client by default — this is correct. Do not stuff them in the response.

## 7. Deduplication, caching, and reactive context

Remote queries have a subtle property: **they deduplicate by argument.**

```svelte
<script>
	const a = getContact('abc');
	const b = getContact('abc');
	console.log(a === b); // true — same cached instance
</script>
```

On the server, this means one request spawns one database call per unique argument even if you `await getContact('abc')` in five different components. On the client, it means five components displaying contact 'abc' share the same cache entry — if a mutation updates 'abc', all five re-render.

### The reactive-context rule

Here is the principal-engineer gotcha. A query's cached instance is kept alive only while something is _reactively observing it_. In practice:

**OK:**

- Calling `getContact('abc')` in `<script>` (reactive context = the component)
- Calling `await getContact('abc')` in markup (reactive)
- Calling it inside `$derived` (reactive)
- Calling it inside `$effect` (reactive)

**NOT OK:**

- Calling `getContact('abc')` inside an `onclick` handler and awaiting its data
- Calling it in module-top-level code (no reactive context, no cleanup)
- Calling it in a universal `load` function

If you try to `await getContact('abc')` inside an event handler, you get a runtime error: "can't call a query outside reactive context without `.run()`."

### The `.run()` escape hatch

When you genuinely want one-shot access to a query's result without caching:

```svelte
<script>
	import { getContact } from './data.remote';
</script>

<button
	onclick={async () => {
		const contact = await getContact('abc').run();
		console.log(contact);
	}}
>
	Log contact
</button>
```

`.run()` bypasses the cache and returns a plain `Promise<T>`. Use this when:

- You need the data once in a handler and do not want cache bookkeeping.
- You are in a non-reactive context (event handler, setTimeout).
- You want to force a fresh server call without affecting other subscribers.

**Do not** use `.run()` in markup or `$derived` — you will lose caching and every render will hit the server.

## 8. `query.batch` for the n+1 problem

You have seen the n+1 problem before. You render a list of contacts and for each one, you call `getTagsForContact(contact.id)`. Now you have 50 database calls instead of 1.

`query.batch` solves this. Your server handler receives an array of arguments — all the calls that happened in the same event loop tick — and returns a lookup function that maps each argument to its result.

```ts
import * as z from 'zod';
import { query, getRequestEvent } from '$app/server';

export const getTagsForContact = query.batch(z.uuid(), async (contactIds) => {
	const { locals } = getRequestEvent();
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { data, error: dbError } = await locals.supabase
		.from('contact_tags')
		.select('contact_id, tag')
		.in('contact_id', contactIds)
		.eq('user_id', user.id);
	if (dbError) error(500, dbError.message);

	const lookup = new Map<string, string[]>();
	for (const row of data ?? []) {
		if (!lookup.has(row.contact_id)) lookup.set(row.contact_id, []);
		lookup.get(row.contact_id)!.push(row.tag);
	}

	return (contactId) => lookup.get(contactId) ?? [];
});
```

Walkthrough:

- `query.batch(schema, handler)` — same signature as `query`, but the handler receives `contactIds: string[]` instead of `contactId: string`.
- Do one fat query with `.in('contact_id', contactIds)` — one DB round-trip for all 50 contacts.
- Build a `Map<contactId, tags[]>` for O(1) lookups.
- Return a function `(contactId) => string[]`. SvelteKit calls this per-argument to resolve each individual call on the client.

Usage looks identical to a regular query:

```svelte
{#each await getContacts() as contact (contact.id)}
	<li>
		{contact.first_name}
		<span class="tags">
			{#each await getTagsForContact(contact.id) as tag}
				<span>{tag}</span>
			{/each}
		</span>
	</li>
{/each}
```

On the first render, 50 calls to `getTagsForContact(id)` coalesce into one batched request. One network round-trip, one DB query, 50 results.

## 9. Preflight client-side validation

By default, form validation happens on the server after the user submits. That is fine, but there is a better UX: validate locally, instantly, as the user types.

```svelte
<script module lang="ts">
	import * as z from 'zod';
	export const preflightSchema = z.object({
		first_name: z.string().min(1, 'First name required'),
		last_name: z.string().min(1, 'Last name required'),
		email: z.email()
	});
</script>

<script lang="ts">
	import { createContact } from './contacts.remote';
</script>

<form {...createContact.preflight(preflightSchema)} oninput={() => createContact.validate()}>
	<input {...createContact.fields.first_name.as('text')} />
	{#each createContact.fields.first_name.issues() as i}
		<span class="error">{i.message}</span>
	{/each}
	<!-- ... -->
</form>
```

Walkthrough:

- `<script module>` block — the preflight schema has to live somewhere client-accessible, and you cannot export it from a `.remote.ts` file (those files only allow the query/form/command/prerender exports). A `<script module>` in the same component, or a shared `.ts` file, works.
- `createContact.preflight(schema)` — returns a new enhanced form object that validates before calling the server. If the preflight fails, the request never goes out.
- `oninput={() => createContact.validate()}` — runs validation on every keystroke. Combined with preflight, this means users see errors the moment they are possible, not after a server round-trip.

**Critical:** your server-side schema should _also_ validate. Preflight is a UX optimization, not a security measure. An attacker can bypass the client and POST directly to the endpoint, so the server schema is the source of truth for correctness.

## 10. Handling sensitive data

When a non-JS form submission fails validation, SvelteKit populates the form's `value()` so the user does not lose their input. This is correct UX for names and emails. It is catastrophic for passwords and credit card numbers.

The convention is a leading underscore:

```svelte
<form {...register}>
	<label>
		Email
		<input {...register.fields.email.as('email')} />
	</label>

	<label>
		Password
		<input {...register.fields._password.as('password')} />
	</label>

	<button>Sign up</button>
</form>
```

Corresponding server schema:

```ts
export const register = form(
	z.object({
		email: z.email(),
		_password: z.string().min(8)
	}),
	async ({ email, _password }) => {
		// hash and store
	}
);
```

The `_` prefix tells SvelteKit "do not echo this field back to the client on failure." If registration fails because the email is taken, the email input repopulates with what they typed. The password input does _not_ — they re-enter it. This is correct: passwords should never cross the network more than necessary, and should certainly never be inlined into HTML on a failed form reload.

Use the underscore prefix for:

- Passwords
- Credit card numbers and CVVs
- Social security numbers, tax IDs
- 2FA codes
- Any secret the user typed that should not be cached in browser history

## 11. Principal Engineer Notes

**Migrate incrementally.** Don't rewrite every page on day one. Turn on the flags, create one new feature with remote functions, watch it in prod for a week. Then migrate the highest-value page (usually the main dashboard or list view). Load functions and form actions are not deprecated — there is no upgrade deadline.

**Keep form actions when you need fine-grained SSR control.** Form actions let you set response headers, render custom error pages, and control redirect semantics in ways that remote forms do not. If you need to set `Set-Cookie` headers during a form submission, use a form action.

**Commands are perfect for event-driven UX.** Like/unlike. Toggle complete. Reorder a list. Mark a notification as read. Anything where a button click should mutate without a full form, use `command`.

**Remote files cannot live in `src/lib/server/`.** They are client-callable HTTP endpoints, which makes them the opposite of server-only modules. Put them next to the page that uses them (colocation), or in `src/lib/` without the `/server` suffix for shared ones.

**`getRequestEvent` is not a ceremony.** It replaces the event-threading pattern entirely. Write small helpers like `requireUser()`, `requireAdmin()`, `getSupabase()` that call `getRequestEvent()` internally. Your remote functions stay short and composable.

**Progressive enhancement is still real.** `form` remote functions degrade to full-page POSTs without JS. This matters for Lighthouse scores, accessibility, and users on flaky connections. `command` remote functions do not degrade — use them only for things that would not make sense as a form anyway.

**Typing across the wire is free.** The return type of your server handler becomes the type of the client-side promise. Rename `first_name` to `firstName` in the DB, and your component's `{c.first_name}` access is a compile error. This is the whole point of remote functions.

**Do not abuse `void ...refresh()`.** Every refresh is a re-run of the query on the server. If your `getContacts()` does a 300ms join across 4 tables, refreshing it after every mutation costs 300ms of extra server time per write. Use `.set()` when you have the data already, and `requested()` when only specific query instances need refreshing.

**The `handleValidationError` hook is generic by design.** Do not stuff Zod issues into the response. A probing attacker looking for a SQL-injection surface will iterate through inputs and read the validation errors to reverse-engineer your schema. Generic "Invalid request" is correct.

**Verification steps after turning on remote functions:**

1. Stop dev server, delete `.svelte-kit`, run `pnpm dev`.
2. Open `/contacts`. In the Network tab, look for a POST to a URL ending in the name of your `.remote.ts` file. This is the generated endpoint.
3. Disable JS in DevTools. Submit the create form. The page should POST and reload correctly — that is your progressive enhancement working.
4. Re-enable JS. Submit a contact with a missing email. You should see the error inline without a round-trip (if preflight is enabled) or after one round-trip (if only server validation).
5. Delete a contact. Open the Network tab. You should see one POST to the delete endpoint, not two.

## What's next

Remote functions replaced three patterns with one. The next bonus keeps the momentum on DX: **shallow routing** — URL-aware modals without full page navigations. You'll use it to add a contact-detail modal to Contactly that is deep-linkable, keyboard-accessible, and dismissable with the back button.

Continue to `bonus-08: Shallow routing — modals without full navigation`.
