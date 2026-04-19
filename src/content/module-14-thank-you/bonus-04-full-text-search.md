# Bonus: Blazing-fast search with Postgres full-text search

Contactly currently has no search. If a user has 500 contacts, they scroll. That is unacceptable. In this lesson we add search that is so fast it feels instant — under 20 milliseconds on 100,000 rows — using Postgres features you already have installed but have not touched yet.

We will also explain exactly WHY the obvious first instinct — `WHERE name ILIKE '%foo%'` — is wrong, and why the proper solution is dramatically better.

## Why `ILIKE '%foo%'` is slow (and dangerous)

`ILIKE` is case-insensitive `LIKE`. It looks like this:

```sql
select * from contacts where first_name ilike '%ada%';
```

"Find rows whose first_name contains the letters a-d-a in any case."

This works. It returns the right rows. But watch what Postgres has to do:

1. There is no index that can help a pattern starting with `%`. An index on `first_name` is like a dictionary — it is ordered, so you can binary-search for strings starting with `ada`. But a string _containing_ `ada` anywhere could be anywhere in the dictionary, so the index is useless.
2. Postgres falls back to a **sequential scan**: it reads every row in the table, lowercases it, checks the pattern. That is O(n) for every search.

On 500 rows, fine. On 50,000 rows, each search takes hundreds of milliseconds — noticeable. On 5,000,000 rows, it takes seconds — broken. And because there are no index assumptions, the query planner cannot parallelize or short-circuit.

It is also dumb: searching for `adam` does not match "Adam Smith" if his name is stored as `"Adam  Smith"` (two spaces) because spaces are significant. `"adam"` does not match `"Ada"`. Plural/singular variants do not match. It cannot rank results by relevance.

We need something smarter. Postgres has shipped one for decades.

## What is full-text search?

**Full-text search** (FTS) is a specialized indexing technique for natural-language text. The idea:

1. **Tokenize.** Split the text into individual words.
2. **Normalize.** Lowercase, strip punctuation, reduce words to their stem (`running`, `ran`, `runs` all become `run`). This is called **lexing**.
3. **Index.** Store a mapping from each lexeme to the documents that contain it, using a data structure optimized for this (an **inverted index**).
4. **Query.** Lex the query the same way, look up each lexeme, intersect the result sets, rank by relevance.

Postgres has FTS built in. You do not install anything. The key types and functions:

- **`tsvector`** — a type that represents a "tokenized document": a sorted list of lexemes with positional info. Looks like `'ada':1 'lovelac':2` — note "lovelace" was stemmed to "lovelac".
- **`tsquery`** — a type that represents a search query as a boolean expression over lexemes: `'ada' & 'lovelace'` (both must appear).
- **`to_tsvector('english', text)`** — converts a string to a tsvector using English language rules (stop words, stemming). Other languages: `'french'`, `'spanish'`, `'simple'` (no stemming, for multilingual).
- **`plainto_tsquery('english', text)`** — converts a user's raw query string to a tsquery. Everything becomes an AND. No user-parseable operators, so it cannot fail on malformed input.
- **`@@`** operator — the match operator. `tsvector @@ tsquery` returns true if the document matches the query.
- **`ts_rank(tsvector, tsquery)`** — returns a floating-point relevance score (higher is better). Useful for ordering.

Example:

```sql
select to_tsvector('english', 'Ada Lovelace, Countess of Lovelace');
-- 'ada':1 'countess':3 'lovelac':2,5
```

Three lexemes: `ada`, `countess`, `lovelac`. Notice:

- "Lovelace" appears twice (positions 2 and 5) — stored as `'lovelac':2,5`.
- "of" was removed — it is a **stop word** (too common to be useful).
- Word stems are reduced: "Lovelace" → "lovelac", so "Lovelaces" or "Loveloving" would also match. (Stemming is heuristic, not perfect — that is okay.)

Now to accelerate this, we need an index.

## The GIN index

A **GIN index** (Generalized Inverted Index) is Postgres's index structure for types like tsvector, where each row is effectively a set of values. A GIN index on a tsvector column lets Postgres do `@@` queries in O(log n) regardless of where in the document the match occurs.

The comparison:

| Approach                    | Query time (100k rows)   | Index time            |
| --------------------------- | ------------------------ | --------------------- |
| `ILIKE '%foo%'`             | ~200ms (sequential scan) | n/a (no useful index) |
| `tsvector @@ tsquery` + GIN | ~2ms                     | O(log n)              |

A hundred times faster, not incidentally but fundamentally, because of the algorithmic difference.

## Step 1: Migration — add the generated column and index

We will add a `search` column to `contacts` that Postgres keeps in sync automatically (a **generated column**). Any insert or update that changes the relevant text fields will automatically update `search`. No application code needed.

### `supabase/migrations/20260418_fts.sql`

```sql
-- ============================================================
-- Full-text search for contacts
-- ============================================================

-- 1. Generated column: tsvector built from the searchable fields.
alter table public.contacts
  add column if not exists search tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '')  || ' ' ||
      coalesce(email, '')      || ' ' ||
      coalesce(company, '')    || ' ' ||
      coalesce(notes, '')
    )
  ) stored;

-- 2. GIN index to accelerate @@ queries.
create index if not exists contacts_search_idx
  on public.contacts using gin (search);

-- 3. RLS is already defined on the table and does not need changes:
--    users still only see their own rows because the existing policies
--    filter by user_id. The new column does not leak anyone else's data.
```

Why this design:

- **`generated always as ... stored`** — Postgres computes the value at write time and stores it on disk. The alternative (`virtual`) is not implemented for this kind of expression; `stored` is the only option. Pros: zero maintenance code. Cons: writes are slightly slower (a few microseconds per insert) and the column takes disk space. Both are negligible for a contacts table.

- **`coalesce(x, '')`** — if a field is NULL, use an empty string. Without this, concatenating with NULL yields NULL, and `to_tsvector('english', NULL)` returns NULL — the column would be NULL for any contact missing any field, and would never match. `coalesce` is mandatory.

- **We include notes.** Consider whether you want notes searchable. For Contactly, yes — notes often contain tagging info ("met at conf X", "wants Q3 demo") and searching them is high-value. If notes contained medical or legal confidentiality, you might exclude. Decision is about product, not code.

- **Why a generated column vs. a trigger?** Generated columns are declarative and cannot get out of sync. Triggers require maintenance and can silently drift if the trigger is accidentally disabled. Prefer generated columns when the expression is simple.

Apply the migration. Verify:

```sql
-- Run in Supabase SQL editor
select first_name, search from public.contacts limit 3;
```

You should see the `search` column populated with `tsvector` values like `'ada':1 'lovelac':2`.

```sql
-- Confirm the index exists
select indexname from pg_indexes where tablename = 'contacts';
-- expect contacts_search_idx to appear
```

## Step 2: Build the search API

### `src/routes/api/contacts/search/+server.ts`

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase, getUser } }) => {
	const user = await getUser();
	if (!user) throw error(401, 'Unauthorized');

	const q = url.searchParams.get('q')?.trim() ?? '';

	// Empty query: return the most recent contacts (same as list page default).
	if (q.length === 0) {
		const { data, error: dbError } = await supabase
			.from('contacts')
			.select('id, first_name, last_name, email, company')
			.order('created_at', { ascending: false })
			.limit(50);
		if (dbError) throw error(500, dbError.message);
		return json({ results: data });
	}

	// Reject absurdly long queries; prevents wasted work.
	if (q.length > 200) throw error(400, 'Query too long');

	// Use an RPC for the rank+limit query because PostgREST does not expose
	// ts_rank directly.  Alternative: use rpc/textSearch. We go with the
	// .textSearch helper for clarity; it builds the @@ query under the hood.
	const { data, error: dbError } = await supabase
		.from('contacts')
		.select('id, first_name, last_name, email, company')
		.textSearch('search', q, { type: 'plain', config: 'english' })
		.limit(50);

	if (dbError) throw error(500, dbError.message);

	return json({ results: data });
};
```

Key pieces:

**`supabase.from('contacts').textSearch('search', q, { type: 'plain', config: 'english' })`** — this is the PostgREST helper. Under the hood it emits:

```sql
where search @@ plainto_tsquery('english', $1)
```

`type: 'plain'` → `plainto_tsquery`. Other options: `'phrase'` (`phraseto_tsquery`, treats input as an exact phrase), `'websearch'` (`websearch_to_tsquery`, supports Google-like `"quoted"` and `-negation`), `'tsquery'` (raw — **DANGER**, user input is parsed as tsquery syntax and can error on malformed input like `bob &`).

**`plainto_tsquery` is the safe choice** because it cannot fail on user input. It strips all operators and treats every word as AND. Users typing `bob & smith` do not get an error — they get a search for the three words `bob`, `&` (ignored as non-word), `smith`.

**We trim the input and reject empty/absurdly-long.** Trimming prevents a single leading space from looking like a search. Length capping prevents someone pasting a megabyte of text.

**`.limit(50)`** — without a limit, a common search like `"a"` could return the entire table. Always limit.

**Ranking** — PostgREST's `.textSearch` does not expose `ts_rank` directly. For that we would define a Postgres function and call it via `.rpc('search_contacts', { q })`. For most UX, sorting by rank is valuable but not critical. We will add ranking via an RPC if we need it. For now, default order (by whatever Postgres returns) is fine.

If you want ranked results, add this function migration:

```sql
create or replace function public.search_contacts(q text)
returns setof public.contacts
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.contacts
  where search @@ plainto_tsquery('english', q)
  order by ts_rank(search, plainto_tsquery('english', q)) desc,
           created_at desc
  limit 50
$$;
```

**`security invoker`** — the function runs with the caller's permissions. That means RLS still filters, so users only ever see their own rows. **This is important.** If you used `security definer`, the function would run as the table owner (a superuser-adjacent role) and bypass RLS — a catastrophic security hole. Always prefer `security invoker` for anything user-facing.

Then call it:

```ts
const { data, error: dbError } = await supabase.rpc('search_contacts', { q }).limit(50);
```

## Step 3: The search UI with debouncing

Every time the user types a character, the browser could fire a search. That is wasteful — the user is still typing and will type more. The standard fix is **debouncing**: wait until the user has stopped typing for, say, 300ms, then fire the request.

### `src/routes/(app)/contacts/+page.svelte`

```svelte
<script lang="ts">
	import { onMount } from 'svelte';

	let { data } = $props();

	let query = $state('');
	let results = $state(data.contacts);
	let isSearching = $state(false);
	let lastError = $state<string | null>(null);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let currentController: AbortController | null = null;

	$effect(() => {
		const q = query;

		// Cancel any pending debounce
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => doSearch(q), 300);

		// Cleanup on unmount
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	async function doSearch(q: string) {
		// Cancel any in-flight request; its answer is no longer relevant
		if (currentController) currentController.abort();
		currentController = new AbortController();

		isSearching = true;
		lastError = null;
		try {
			const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(q)}`, {
				signal: currentController.signal
			});
			if (!res.ok) throw new Error(`Search failed (${res.status})`);
			const body = await res.json();
			results = body.results;
		} catch (err: any) {
			if (err.name === 'AbortError') return; // expected
			lastError = err.message;
		} finally {
			isSearching = false;
		}
	}
</script>

<div class="mb-4 flex items-center gap-3">
	<input
		bind:value={query}
		type="search"
		placeholder="Search contacts..."
		class="flex-1 rounded border px-3 py-2"
	/>
	{#if isSearching}
		<span class="text-xs text-gray-500">Searching...</span>
	{/if}
</div>

{#if lastError}
	<p class="mb-2 text-sm text-red-600">{lastError}</p>
{/if}

{#if results.length === 0}
	<p class="text-sm text-gray-500">
		{query ? `No results for "${query}"` : 'No contacts yet.'}
	</p>
{:else}
	<ul class="divide-y divide-gray-100">
		{#each results as c (c.id)}
			<li class="flex items-center gap-3 py-3">
				<a href="/contacts/{c.id}" class="font-medium hover:underline">
					{c.first_name ?? ''}
					{c.last_name ?? ''}
				</a>
				<span class="ml-auto text-sm text-gray-500">{c.email ?? ''}</span>
				{#if c.company}
					<span class="text-xs text-gray-400">{c.company}</span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
```

The magic is in the `$effect`:

- `$effect(() => { ... })` reruns whenever any `$state` it reads changes. It reads `query`, so every keystroke triggers a rerun.
- Inside, we clear the previous timer and start a new one. If the user is still typing, the timer keeps getting reset. Only once they pause for 300ms does the timer actually fire.
- The `return () => { ... }` cleanup runs on re-execution and on unmount, clearing the timer so we do not search against a page the user has navigated away from.

And the `AbortController`:

- Each fetch is made with a signal. Starting a new search aborts the previous one.
- Without this, a slow search for "a" could arrive _after_ a fast search for "ada" completed, clobbering the UI with stale results. This is a classic **race condition**.
- `err.name === 'AbortError'` — aborted requests throw this specific error; we silently swallow it.

**Why 300ms?** It is the industry rule-of-thumb for balancing responsiveness against wasted requests. Too short (100ms) and you fire a request per keystroke. Too long (1000ms) and the UI feels sluggish. 300ms is just short enough to feel alive and just long enough to drop a few requests per typed word.

## Step 4: Test it

1. Apply the migration.
2. `pnpm dev` and go to `/contacts`.
3. Have at least 10 contacts. Type in the search box.
4. Confirm it finds contacts by:
   - First name: `ada` → finds Ada Lovelace.
   - Last name: `lovelace` → finds her.
   - Stem: `lov` does NOT find her (English stemmer turns "lovelace" to "lovelac", not "lov"). But `lovelac` does. Try both to see stemming in action.
   - Email: `ada@` → finds her.
   - Company: `analytical` → finds her.
   - Notes: `poet` → finds her.
5. Confirm it does NOT return other users' contacts. Create a second user in Supabase, give them a contact with name "Ada Turing", log back in as user 1, search `turing` — you should see YOUR Alan Turing but NOT the other user's Ada Turing. RLS is doing its job.

Look at the Supabase logs:

1. **Dashboard → Logs → Postgres logs**.
2. Type a search. Check the query latency. You should see single-digit ms times for small tables.

## Next-level topics (pointers only)

You now have production-grade search. A few techniques you can graduate to:

### Trigram search (`pg_trgm`) for fuzzy matching

FTS requires the user to type something close to a real word. It will not match typos: `gracec` → no match for "Grace Hopper". For typo-tolerance, Postgres has the `pg_trgm` extension:

```sql
create extension if not exists pg_trgm;
create index contacts_first_name_trgm on contacts using gin (first_name gin_trgm_ops);
```

Then you can do `where first_name % 'gracec'` (similarity operator) or order by similarity score. Trigram is complementary to FTS — FTS is better for finding "any document that mentions X" and trigram is better for autocomplete and fuzzy name search. Many real-world apps combine them.

### `unaccent` for accent-insensitive search

`to_tsvector('french', 'café')` gives you `'café'`. Users searching `cafe` will not find it. Postgres ships an `unaccent` extension:

```sql
create extension if not exists unaccent;
create text search configuration unaccent_english (copy = english);
alter text search configuration unaccent_english
  alter mapping for hword, hword_part, word with unaccent, english_stem;
```

Then use `to_tsvector('unaccent_english', ...)`. This is a must-have for any app with European users.

### Synonyms and custom dictionaries

If users search for "CEO" you might want matches for "Chief Executive Officer" too. Postgres supports synonym dictionaries (`CREATE TEXT SEARCH DICTIONARY ... WITH Synonym`). Non-trivial to set up but incredibly powerful.

### Multilingual content

If you have contacts in mixed languages, English stemming mangles non-English words. Options: use `'simple'` (no stemming), detect language per row and store multiple tsvectors, or use one of the multilingual indexes like `pg_bigm`.

### When to reach for a dedicated search engine

Postgres FTS is excellent up to ~10M rows or so. Beyond that, or if you need: typo-tolerance by default, rich faceting, autocomplete out of the box, or language detection — consider **Meilisearch** or **Typesense** (simple, self-hostable) or **Elasticsearch**/**OpenSearch** (industrial strength). Supabase + Postgres FTS gets you very far; do not prematurely adopt complexity.

## What senior engineers think about here

**1. Indexes are not free.** Every write has to update the index. For a contacts table that is mostly read, the tradeoff is a no-brainer. For a log table that is mostly write, maybe not. Think about the read/write ratio before adding indexes.

**2. Generated column vs. trigger.** Prefer generated columns. Triggers can be disabled, dropped, or refactored out of sync. Generated columns cannot.

**3. Never expose `tsquery` to users.** Use `plainto_tsquery` or `websearch_to_tsquery`. Never parse user input as tsquery — it is a grammar, and malformed input errors out.

**4. Always `security invoker`.** RPC functions that run user-facing queries should run with the caller's permissions so RLS remains in force.

**5. Limit every search.** `limit 50`. Paginate if the user needs more. An unlimited search is a DoS vector.

**6. Debounce + abort.** Both on the frontend. Debounce saves requests; abort prevents race conditions. Always do both.

**7. Rank later.** Start without ranking, just return matches. Add `ts_rank` when users complain results are in a weird order, not before.

You now have search that is fast, safe, and scales. Next we tackle real-time — making the UI update across tabs and users without a refresh.
