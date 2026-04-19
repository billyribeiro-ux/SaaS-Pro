# Bonus: CSV import and export for contacts

A contact app without bulk import is a contact app nobody will migrate onto. Every existing user already has contacts in a spreadsheet, in their last CRM, or in their email. If we cannot get that data in — quickly, safely, and with a good error experience — they will not sign up.

In this lesson we will build two features:

1. **Export** — one-click download of all their contacts as a CSV.
2. **Import** — paste or upload a CSV, we validate every row, we report errors with exact line numbers, and we insert the valid rows in batches.

Along the way we will teach what CSV actually is (it is not just "commas"), why parsing it correctly is harder than it looks, and how to build a defensive import pipeline that never corrupts the database.

## What is CSV and why do we need a parser?

**CSV** stands for Comma-Separated Values. The format is simple in theory: each line is a row, fields separated by commas. In practice there are three complications that make hand-rolled splitting dangerous:

1. **Quoted fields.** If a field contains a comma — `"Doe, John"` — the field is wrapped in double quotes.
2. **Embedded quotes.** If a field contains a quote character, it is escaped by doubling: `"She said ""hi"""` represents the string `She said "hi"`.
3. **Embedded newlines.** Quoted fields can contain literal newlines: `"Line 1\nLine 2"` is one field that spans two physical lines.

A naive `line.split(',')` breaks on (1) and (2). A naive `content.split('\n')` breaks on (3). These are not edge cases — a single note or address with a comma in it will hit them. So we use a real parser: **papaparse**, the battle-tested JavaScript CSV library.

The official CSV specification is **RFC 4180**. It is refreshingly short. The two rules you need:

- Fields that contain `,`, `"`, or newlines must be enclosed in double quotes.
- Inside a quoted field, `"` is escaped as `""`.

RFC 4180 also specifies **CRLF** line endings (`\r\n`). We will emit those on export because Excel on Windows still occasionally cares. Parsers handle both `\n` and `\r\n` on import.

## Step 1: Install papaparse

```bash
pnpm add papaparse
pnpm add -D @types/papaparse
```

We only install this for the import side. For export, building CSV by hand is fine because we control the input perfectly.

## Step 2: Build the export route

### `src/routes/api/contacts/export/+server.ts`

```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CSV_HEADERS = ['first_name', 'last_name', 'email', 'company', 'phone', 'notes'] as const;
type CsvColumn = (typeof CSV_HEADERS)[number];
type ContactRow = Record<CsvColumn, unknown>;

/** Escape a single CSV field per RFC 4180. */
function csvField(value: unknown): string {
	if (value === null || value === undefined) return '';
	const str = String(value);
	// If the value contains a comma, quote, CR, or LF, wrap in quotes and
	// double up any internal quotes.
	if (/[",\r\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function toCsvRow(values: unknown[]): string {
	return values.map(csvField).join(',');
}

export const GET: RequestHandler = async ({ locals: { supabase, getUser } }) => {
	const user = await getUser();
	if (!user) throw redirect(303, '/login');

	// RLS already filters to the user's rows, but we add an explicit user_id
	// filter as defense-in-depth.
	const { data: contacts, error } = await supabase
		.from('contacts')
		.select(CSV_HEADERS.join(','))
		.eq('user_id', user.id)
		.order('created_at', { ascending: true });

	if (error) {
		return new Response(`Export failed: ${error.message}`, { status: 500 });
	}

	const lines: string[] = [];
	lines.push(toCsvRow(CSV_HEADERS));
	for (const c of (contacts ?? []) as ContactRow[]) {
		lines.push(toCsvRow(CSV_HEADERS.map((h) => c[h])));
	}
	// RFC 4180 uses CRLF between records.
	const body = lines.join('\r\n') + '\r\n';

	// UTF-8 BOM so Excel on Windows recognizes the encoding. Modern tools
	// do not need it, but it is harmless and fixes a real UX bug for users
	// with non-ASCII names.
	const bom = '\uFEFF';

	return new Response(bom + body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="contactly-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
			'Cache-Control': 'no-store'
		}
	});
};
```

Line by line:

- **`CSV_HEADERS`** — the fixed column order. Never rely on object key iteration order; hard-code the columns so adding a column later requires an explicit change here.
- **`csvField`** — only quotes fields that actually need quoting. This produces cleaner CSV (shorter, easier to read in an editor) while staying 100% RFC 4180 compliant. The regex `/[",\r\n]/` covers all four characters that force quoting.
- **`str.replace(/"/g, '""')`** — escapes embedded quotes by doubling.
- **`supabase.from('contacts').eq('user_id', user.id)`** — defense-in-depth. RLS already filters, but explicit filters protect you if a future dev accidentally breaks the RLS policy. Never rely on a single layer of authorization.
- **`\r\n`** — CRLF as RFC 4180 prescribes.
- **`'\uFEFF'` BOM** — a zero-width byte-order mark at the start tells Excel this file is UTF-8. Without it, Excel on Windows sometimes assumes Windows-1252 and mangles any non-ASCII names (é becomes Ã©). Modern tools like Google Sheets and Apple Numbers do not need the BOM but ignore it safely.
- **`Content-Disposition: attachment; filename="..."`** — `attachment` tells the browser to download the response as a file rather than display it. `filename` sets the default download name; including today's date makes it easy to find later.
- **`Cache-Control: no-store`** — the export always reflects current data, never serve a stale copy from the CDN.

### Add the export button

Somewhere on the settings page or contacts list:

```svelte
<a
	href="/api/contacts/export"
	class="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-gray-50"
>
	<svg
		class="h-4 w-4"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		aria-hidden="true"
	>
		<path d="M12 3v14m0 0l-4-4m4 4l4-4M4 21h16" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
	Export CSV
</a>
```

Clicking the link triggers a GET on `/api/contacts/export`, which serves the file with `Content-Disposition: attachment`, so the browser downloads rather than navigates.

### Note on streaming vs. buffering

We build the entire CSV in memory as a string, then return it. For a typical user with a few thousand contacts this is fine — even 10,000 rows is only a couple megabytes. At tens of thousands you would want to stream: return a `ReadableStream` that queries contacts in paginated batches and writes each row as it is ready. SvelteKit supports this via `new Response(stream, ...)`. We keep the buffered approach here because it is simpler and adequate for this course's scope.

## Step 3: Design the import experience

Good import UX has three properties:

1. **Preview first.** Do not write anything until the user confirms.
2. **Per-row errors.** "4 rows failed" is terrible. "Row 7: invalid email `not-an-email`; Row 12: missing first_name" is useful.
3. **Idempotent on reruns.** If someone hits import twice, the second run should not double rows. We handle this with email-based deduplication via Postgres upsert.

We will build a two-step flow: **upload/parse** step shows a preview and error table; **confirm** step actually writes.

## Step 4: The import page

### `src/routes/(app)/settings/import/+page.svelte`

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();

	// `form` will hold either { preview: [...], errors: [...] } after parse
	// or { inserted: N, skipped: N } after confirm.
</script>

<h1 class="text-2xl font-semibold">Import contacts</h1>
<p class="mt-2 text-sm text-gray-600">
	Upload a CSV with headers: first_name, last_name, email, company, phone, notes.
</p>

<!-- Step 1: Upload & parse (preview) -->
<form
	method="POST"
	action="?/parse"
	enctype="multipart/form-data"
	use:enhance
	class="mt-6 flex items-center gap-3"
>
	<input
		type="file"
		name="file"
		accept=".csv,text/csv"
		required
		class="block text-sm file:mr-3 file:rounded file:border-0 file:bg-black file:px-3 file:py-2 file:text-white"
	/>
	<button class="rounded border px-3 py-2 text-sm">Parse preview</button>
</form>

{#if form?.preview}
	<h2 class="mt-8 text-lg font-semibold">Preview ({form.preview.length} valid rows)</h2>
	<div class="mt-2 overflow-x-auto rounded border">
		<table class="min-w-full text-sm">
			<thead class="bg-gray-50 text-left">
				<tr>
					<th class="px-3 py-2">#</th>
					<th class="px-3 py-2">First</th>
					<th class="px-3 py-2">Last</th>
					<th class="px-3 py-2">Email</th>
					<th class="px-3 py-2">Company</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each form.preview.slice(0, 20) as row, i}
					<tr>
						<td class="px-3 py-1 text-gray-500">{i + 1}</td>
						<td class="px-3 py-1">{row.first_name ?? ''}</td>
						<td class="px-3 py-1">{row.last_name ?? ''}</td>
						<td class="px-3 py-1">{row.email ?? ''}</td>
						<td class="px-3 py-1">{row.company ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if form.preview.length > 20}
		<p class="mt-2 text-xs text-gray-500">...and {form.preview.length - 20} more.</p>
	{/if}

	<form method="POST" action="?/confirm" use:enhance class="mt-4">
		<input type="hidden" name="payload" value={JSON.stringify(form.preview)} />
		<button class="rounded bg-black px-4 py-2 text-white">
			Import {form.preview.length} contacts
		</button>
	</form>
{/if}

{#if form?.errors && form.errors.length > 0}
	<h2 class="mt-8 text-lg font-semibold text-red-700">
		{form.errors.length} row(s) had errors and will be skipped
	</h2>
	<div class="mt-2 overflow-x-auto rounded border border-red-200">
		<table class="min-w-full text-sm">
			<thead class="bg-red-50 text-left">
				<tr>
					<th class="px-3 py-2">CSV line</th>
					<th class="px-3 py-2">Problem</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each form.errors as e}
					<tr>
						<td class="px-3 py-1 text-red-700">{e.line}</td>
						<td class="px-3 py-1 text-red-700">{e.message}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if form?.inserted !== undefined}
	<p class="mt-6 rounded bg-green-50 p-3 text-sm text-green-800">
		Imported {form.inserted} contact(s).
		{#if form.skipped}(Skipped {form.skipped} duplicates by email.){/if}
	</p>
{/if}
```

Three visual sections: upload, preview + errors, success message. The preview ships back to the server via a hidden field so we do not re-parse the file on confirm.

> **Tradeoff:** serializing the preview as JSON in a hidden form field means a large import (say 20,000 rows) will be a big hidden value. For this course scale (a few thousand rows) it is fine. If you are building this for real, store the parsed preview on the server in a short-lived cache keyed by an id, and send just the id on confirm.

## Step 5: The server actions

### `src/routes/(app)/settings/import/+page.server.ts`

```ts
import { fail, redirect } from '@sveltejs/kit';
import Papa from 'papaparse';
import * as z from 'zod';
import type { Actions } from './$types';

const RowSchema = z.object({
	first_name: z
		.string()
		.trim()
		.max(100)
		.optional()
		.transform((v) => v || null),
	last_name: z
		.string()
		.trim()
		.max(100)
		.optional()
		.transform((v) => v || null),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email()
		.optional()
		.transform((v) => v || null),
	company: z
		.string()
		.trim()
		.max(200)
		.optional()
		.transform((v) => v || null),
	phone: z
		.string()
		.trim()
		.max(50)
		.optional()
		.transform((v) => v || null),
	notes: z
		.string()
		.trim()
		.max(2000)
		.optional()
		.transform((v) => v || null)
});

type Row = z.infer<typeof RowSchema>;

const MAX_ROWS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;

export const actions: Actions = {
	parse: async ({ request, locals: { getUser } }) => {
		const user = await getUser();
		if (!user) throw redirect(303, '/login');

		const form = await request.formData();
		const file = form.get('file');

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Please choose a CSV file.' });
		}
		if (file.size > MAX_BYTES) {
			return fail(400, { error: `CSV too large. Max ${MAX_BYTES / 1024 / 1024}MB.` });
		}

		const text = await file.text();

		const parsed = Papa.parse<Record<string, string>>(text, {
			header: true,
			skipEmptyLines: 'greedy',
			transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_')
		});

		if (parsed.errors.length > 0) {
			return fail(400, {
				error: `CSV parse failed on line ${parsed.errors[0].row}: ${parsed.errors[0].message}`
			});
		}

		if (parsed.data.length > MAX_ROWS) {
			return fail(400, { error: `Too many rows. Max is ${MAX_ROWS}.` });
		}

		const preview: Row[] = [];
		const errors: { line: number; message: string }[] = [];

		parsed.data.forEach((raw, i) => {
			// CSV line = header (1) + this row's 0-index + 1
			const lineNumber = i + 2;
			const result = RowSchema.safeParse(raw);
			if (!result.success) {
				const msg = result.error.issues
					.map((iss) => `${iss.path.join('.') || '(row)'}: ${iss.message}`)
					.join('; ');
				errors.push({ line: lineNumber, message: msg });
				return;
			}
			// Require at least one of first_name/last_name/email to be present.
			if (!result.data.first_name && !result.data.last_name && !result.data.email) {
				errors.push({ line: lineNumber, message: 'Row must have at least a name or an email' });
				return;
			}
			preview.push(result.data);
		});

		return { preview, errors };
	},

	confirm: async ({ request, locals: { supabase, getUser } }) => {
		const user = await getUser();
		if (!user) throw redirect(303, '/login');

		const form = await request.formData();
		const payload = form.get('payload');
		if (typeof payload !== 'string') {
			return fail(400, { error: 'Missing payload.' });
		}

		let rows: Row[];
		try {
			const parsed = JSON.parse(payload);
			rows = z.array(RowSchema).parse(parsed);
		} catch {
			return fail(400, { error: 'Invalid payload.' });
		}

		// Attach user_id and chunk into batches of 100.
		const withUser = rows.map((r) => ({ ...r, user_id: user.id }));
		const BATCH = 100;
		let inserted = 0;
		let skipped = 0;

		for (let i = 0; i < withUser.length; i += BATCH) {
			const batch = withUser.slice(i, i + BATCH);

			// Rows without email cannot be deduped; insert plain.
			// Rows with email use upsert on (user_id, email).
			const withEmail = batch.filter((b) => b.email);
			const noEmail = batch.filter((b) => !b.email);

			if (withEmail.length > 0) {
				const { data, error } = await supabase
					.from('contacts')
					.upsert(withEmail, { onConflict: 'user_id,email', ignoreDuplicates: true })
					.select('id');
				if (error) return fail(500, { error: error.message });
				const n = data?.length ?? 0;
				inserted += n;
				skipped += withEmail.length - n;
			}

			if (noEmail.length > 0) {
				const { data, error } = await supabase.from('contacts').insert(noEmail).select('id');
				if (error) return fail(500, { error: error.message });
				inserted += data?.length ?? 0;
			}
		}

		return { inserted, skipped };
	}
};
```

### Walkthrough

**`transformHeader`** — we normalize the header row. `"First Name"`, `"first name"`, `"FIRST_NAME"` all become `first_name`. This means users can hand you any spreadsheet and you tolerate casing and whitespace. Unknown headers are silently ignored by Zod (because every field in the schema is `.optional()` and extra keys are stripped). That is usually the right choice for imports: do not fail a 10,000-row file because someone has a "Birthday" column we do not store.

**`skipEmptyLines: 'greedy'`** — ignores both totally empty lines and lines that are only commas (e.g. trailing empty row from Excel).

**`lineNumber = i + 2`** — papaparse gives us `i` as a 0-indexed data-row index. The user's CSV line numbers start at 1 for the header, so the first data row is CSV line 2. Report `i + 2` so error messages match what the user sees in their editor.

**`safeParse` per row, collect errors** — we never throw. Every bad row generates an entry in `errors`, every good row goes into `preview`. The user gets one shot to see everything that is wrong, fix it in their spreadsheet, and re-upload.

**"Row must have at least a name or an email"** — schemas alone cannot express "at least one of these fields is present." We check it manually. Without this, a CSV with a hundred totally empty rows would produce a hundred valid-looking contacts with all-null fields.

**`onConflict: 'user_id,email'`** — this is Postgres upsert syntax. You need a unique index on `(user_id, email)` for this to work. Add the index in a migration:

```sql
create unique index if not exists contacts_user_email_unique
  on public.contacts (user_id, email)
  where email is not null;
```

The `where email is not null` creates a **partial unique index** — it only enforces uniqueness on rows that have an email. Rows without an email are allowed to exist in unlimited quantity.

**`ignoreDuplicates: true`** — if a row collides, Supabase silently skips rather than overwriting. This matters for imports: a user re-uploading the same CSV should not destroy edits they made to existing contacts.

**`.select('id')`** after upsert — returns the rows actually written. Length tells us how many inserted vs. skipped.

**Batches of 100** — large inserts into Postgres work, but batching gives us (a) progress updates in logs, (b) smaller transactions so a single bad row does not roll back the whole import, (c) reasonable memory usage. 100 is a good middle ground.

## Step 6: Sample CSV for testing

Create a text file and paste:

```csv
first_name,last_name,email,company,phone,notes
Ada,Lovelace,ada@example.com,Analytical Engine Inc,"+1 555 0100","Poet of science"
Alan,Turing,alan@example.com,,"+44 20 7946 0100","Bletchley Park"
,,bad-email,Empty Corp,,"Row with bad email and no name"
Grace,Hopper,grace@example.com,US Navy,,"Invented the compiler"
"O'Brien, Jr.",Smith,"smith@example.com","ACME, Inc.",,"Name has quotes and commas"
Linus,Torvalds,linus@example.com,Linux Foundation,,,
Ada,Lovelace,ada@example.com,,,"Duplicate — should be skipped on confirm"
```

Seven data rows.

- Row 4 (`bad-email`) should fail validation for invalid email AND lack a first_name/last_name — error goes in the error table.
- Rows with quotes and commas (`"O'Brien, Jr."`, `"ACME, Inc."`) parse correctly because papaparse handles RFC 4180.
- Final row is a duplicate of Ada by email — on confirm, `inserted` is 5, `skipped` is 1.

## Step 7: Test end-to-end

1. Open `/settings/import` logged in.
2. Upload the sample CSV. Click "Parse preview".
3. Preview table shows 5 valid rows. Error table shows 1 error: "Line 4: email: Invalid email; (row): Row must have at least a name or an email".
4. Click "Import 5 contacts". Success message: "Imported 5 contact(s)."
5. Re-upload the same CSV and click import again. Now success says "Imported 0 contact(s). (Skipped 5 duplicates by email.)" — idempotent.
6. Click **Export CSV**. Download the file. Open in your editor. Confirm it round-trips: you could re-import your own export and get zero changes.

## What senior engineers think about here

**1. Validate at the edge, trust inside.** Every row flows through Zod before touching the database. After that, the rest of the code can assume shapes. This separation is worth its weight in gold when things go wrong.

**2. Never reveal the schema to the error message.** "column `created_at` violates not-null constraint" is a database leak. Our errors say "Row must have at least a name or an email" — user-facing, actionable.

**3. Deduplication is policy, not validation.** The `(user_id, email)` unique index is the policy decision that "a user's contacts are unique by email." If your product changes and you need multiple contacts with the same email (e.g. different departments at the same company), you drop the index, not the app code.

**4. Encoding matters.** UTF-8 is the right choice. Exports should include a BOM for Excel-on-Windows friendliness. Imports should not require a BOM — papaparse tolerates both.

**5. Imports are irreversible.** Always offer export before first use so users know they can get their data out. Always show a preview before writing so they can back out.

**6. Performance at scale.** 10,000 rows × 100 batch = 100 round trips. On a normal Supabase project this takes about 10 seconds. Users will wait 10 seconds; they will not wait 10 minutes. If you expect large imports, add a progress indicator (SSE or polling).

**7. Memory limits.** Reading the entire file into memory with `file.text()` is fine up to a few megabytes. For much larger files, stream-parse: `Papa.parse(file, { step: (row) => ... })`.

**8. Injection safety.** CSV is a minefield for "formula injection" — a field starting with `=`, `+`, `-`, `@` can execute as a formula in Excel. If you export user-provided content that may contain those characters, prefix with `'` to neutralize. For a B2B contact app where users only export their own data, this is low-risk. For consumer-facing public exports, always sanitize.

Two of the hardest parts of SaaS — getting data in, getting data out — now work beautifully. Onward to search.
