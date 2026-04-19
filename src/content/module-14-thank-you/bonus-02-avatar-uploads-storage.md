---
title: 'Bonus: Contact Avatars with Supabase Storage'
module: 14
lesson: 2
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-02-avatar-uploads-storage'
description: 'Add per-contact profile photos using Supabase Storage, signed URLs, and the right RLS policies.'
duration: 25
preview: false
---

## What we're building

Right now every contact in your app shows the same gray circle with their initials. By the end of this lesson, each contact will have their own profile photo — uploaded by you, stored in Supabase, locked down so nobody else can see it, and rendered through a temporary signed URL that expires in an hour.

We're going to do this the **safe** way. Not "drop the file on a public bucket and pray". We're going to:

- Put avatars in a **private bucket** so the raw URL alone can't be guessed or shared forever.
- Write **storage policies** so even authenticated users can only touch files inside their own folder.
- Validate the file on the server with a **magic-byte check**, not just the file extension (because the extension can lie).
- Store a **stable key** in the database and ask Supabase for a fresh **signed URL** every time we render the page.
- Clean up the **old avatar** when a new one is uploaded so we don't pile up garbage in the bucket.

That's the kind of upload flow you'd be proud to defend in a security review.

## Before you start

You should have finished Module 4 (Contacts CRUD). That means your `contacts` table exists, RLS is on, and you can create, edit, and delete contacts in the UI.

If you can run `pnpm dev`, log in, click into a contact, and see the edit form — you're ready.

## Step 1 — Add `avatar_url` to the contacts table

Open a terminal at the root of the repo and create a new migration:

```bash
supabase migration new add_contact_avatar
```

Supabase will create a new file in `supabase/migrations/` with a timestamp in the name. Open it. It'll be empty.

Paste this:

```sql
-- supabase/migrations/<timestamp>_add_contact_avatar.sql

alter table public.contacts
	add column if not exists avatar_url text
		check (avatar_url is null or char_length(avatar_url) <= 500);
```

Save the file.

What this is doing:

- `alter table` — modifies an existing table without dropping it.
- `add column if not exists` — safe to run twice. If the column already exists, this is a no-op instead of an error. That `if not exists` is what makes the migration **idempotent**, which is non-negotiable in real production migrations.
- `text` — we're storing a string, not bytes. The actual image lives in Supabase Storage. The database only knows the **key** (the path) so we can ask Storage for a signed URL later.
- `check (... or char_length <= 500)` — a defensive constraint. If something goes wrong upstream and we try to write a 50KB string, Postgres rejects it instead of silently bloating the row. 500 characters is a generous ceiling for the longest realistic key we'd ever store.

Apply the migration:

```bash
pnpm db:push
```

Now regenerate the TypeScript types so the rest of the app knows about the new column:

```bash
pnpm db:types
```

Open `src/lib/types/database.types.ts` and search for `contacts`. You should now see `avatar_url: string | null` in the `Row`, `Insert`, and `Update` types. If you don't, the regen didn't run — check the terminal for errors.

## Step 2 — Create the storage bucket

Storage in Supabase works in **buckets**. A bucket is a top-level container — think of it as a drive. Inside a bucket you have **objects**, which are individual files keyed by a path string.

There are two kinds of buckets:

- **Public** — anyone with the URL can `GET` the object. No auth, no RLS. Good for marketing assets, your logo, screenshots in your docs. Bad for user content.
- **Private** — the bucket has no public URL at all. Clients must either go through the authenticated SDK (and pass RLS) or fetch a temporary **signed URL** that expires.

Avatars are **personal data**. They go in a private bucket.

We're going to create the bucket as a SQL migration (not from the dashboard) so it's tracked in git, deployed automatically by CI, and your local Supabase instance gets it for free on `db:reset`.

Create another migration:

```bash
supabase migration new create_avatar_bucket
```

Open the new file and paste:

```sql
-- supabase/migrations/<timestamp>_create_avatar_bucket.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'contact-avatars',
	'contact-avatars',
	false,
	2097152, -- 2 MiB
	array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
	set public = excluded.public,
		file_size_limit = excluded.file_size_limit,
		allowed_mime_types = excluded.allowed_mime_types;
```

Save it.

Line by line:

- `insert into storage.buckets` — the Supabase Storage system is just Postgres tables with extra glue. We're inserting a new bucket row.
- `'contact-avatars'` — the bucket name. Used everywhere as the identifier.
- `public, false` — clients can't read this bucket without auth.
- `file_size_limit, 2097152` — that's 2 × 1024 × 1024, exactly 2 MiB. Storage will reject any upload bigger than this **at the edge**, before it ever hits our server. Defense in depth: even if our app forgot to check, the platform stops it.
- `allowed_mime_types` — Storage will reject any upload whose declared MIME isn't one of these three. We're allowing JPEG, PNG, and WebP. No GIF (animated avatars are obnoxious), no SVG (SVGs can run JavaScript — never accept user-uploaded SVGs unless you understand the XSS risk).
- `on conflict (id) do update` — makes the migration idempotent. Re-running it updates the existing bucket instead of crashing.

Apply it:

```bash
pnpm db:push
```

## Step 3 — Lock down the bucket with RLS

The bucket exists. But right now there are no policies on it, which means **nothing works** — Supabase Storage uses RLS the same way Postgres tables do. No policy = nobody is allowed in, including you.

We need four policies, one for each verb (read, insert, update, delete), and they all need to enforce one rule:

> A user can only touch files inside a folder named after their own user ID.

The naming convention we're going to follow is:

```
contact-avatars/<user_id>/<contact_id>/<random>.<ext>
```

So `auth.uid()` must equal the **first segment** of the path. Storage exposes the path in `storage.objects.name`, and there's a helper `storage.foldername(name)` that returns the path as an array of segments.

Create another migration:

```bash
supabase migration new contact_avatar_policies
```

Paste:

```sql
-- supabase/migrations/<timestamp>_contact_avatar_policies.sql

-- Allow authenticated users to read their own avatars.
drop policy if exists "Read own contact avatars" on storage.objects;
create policy "Read own contact avatars"
	on storage.objects for select
	to authenticated
	using (
		bucket_id = 'contact-avatars'
		and (storage.foldername(name))[1] = (select auth.uid()::text)
	);

-- Allow authenticated users to upload into their own folder.
drop policy if exists "Upload own contact avatars" on storage.objects;
create policy "Upload own contact avatars"
	on storage.objects for insert
	to authenticated
	with check (
		bucket_id = 'contact-avatars'
		and (storage.foldername(name))[1] = (select auth.uid()::text)
	);

-- Allow authenticated users to overwrite files in their own folder.
drop policy if exists "Update own contact avatars" on storage.objects;
create policy "Update own contact avatars"
	on storage.objects for update
	to authenticated
	using (
		bucket_id = 'contact-avatars'
		and (storage.foldername(name))[1] = (select auth.uid()::text)
	);

-- Allow authenticated users to delete files in their own folder.
drop policy if exists "Delete own contact avatars" on storage.objects;
create policy "Delete own contact avatars"
	on storage.objects for delete
	to authenticated
	using (
		bucket_id = 'contact-avatars'
		and (storage.foldername(name))[1] = (select auth.uid()::text)
	);
```

Save and apply:

```bash
pnpm db:push
```

What's happening here:

- **`drop policy if exists` then `create policy`** — same idempotent pattern we used for the `contacts` table. Re-running the migration is safe.
- **`to authenticated`** — these policies only apply to logged-in users. Anonymous requests are denied automatically because there is no other policy that grants them access.
- **`bucket_id = 'contact-avatars'`** — these policies only apply to our bucket. Other buckets (if you add some later) are unaffected.
- **`(storage.foldername(name))[1] = (select auth.uid()::text)`** — this is the heart of the security model. `storage.foldername('alice-id/contact-7/abc.png')` returns `{'alice-id', 'contact-7', 'abc.png'}`. We compare the first element to the current user's ID. Wrap `auth.uid()` in `(select ...)` — Postgres treats it as a stable subquery and caches it, which makes this policy noticeably faster on bulk operations.
- **No `delete` policy on the bucket itself** — only on objects. Nobody, not even you, can delete the bucket from the client SDK. Good.

That's it for the database. Buckets, policies, columns, types — all done. Let's move to the application code.

## Step 4 — Build the upload server logic

We're going to put the upload behind a **form action** on the contact edit page, so the upload happens with a normal POST and we get progressive enhancement for free (the form works even if JavaScript is disabled).

Create a small helper file first. We'll keep avatar logic in one place so we don't smear it across page actions.

Create `src/lib/server/avatars.ts`:

```ts
// src/lib/server/avatars.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database.types';

const BUCKET = 'contact-avatars';
const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

// Magic-byte signatures. We never trust the file extension or even the
// browser-supplied MIME — we look at the first bytes of the file itself.
const MAGIC: Array<{ mime: string; bytes: Uint8Array; offset: number }> = [
	{ mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]), offset: 0 },
	{ mime: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), offset: 0 },
	{ mime: 'image/webp', bytes: new Uint8Array([0x57, 0x45, 0x42, 0x50]), offset: 8 } // "WEBP" inside RIFF container
];

export class AvatarUploadError extends Error {
	constructor(
		public readonly code: 'too_large' | 'wrong_type' | 'corrupt' | 'storage_failed',
		message: string
	) {
		super(message);
		this.name = 'AvatarUploadError';
	}
}

function startsWith(haystack: Uint8Array, needle: Uint8Array, offset = 0): boolean {
	if (haystack.length < offset + needle.length) return false;
	for (let i = 0; i < needle.length; i++) {
		if (haystack[offset + i] !== needle[i]) return false;
	}
	return true;
}

function detectMime(bytes: Uint8Array): string | null {
	for (const sig of MAGIC) {
		if (startsWith(bytes, sig.bytes, sig.offset)) return sig.mime;
	}
	return null;
}

function extensionFor(mime: string): string {
	switch (mime) {
		case 'image/jpeg':
			return 'jpg';
		case 'image/png':
			return 'png';
		case 'image/webp':
			return 'webp';
		default:
			throw new Error(`unsupported mime: ${mime}`);
	}
}

export type UploadResult = { key: string };

export async function uploadContactAvatar(args: {
	supabase: SupabaseClient<Database>;
	userId: string;
	contactId: string;
	file: File;
}): Promise<UploadResult> {
	const { supabase, userId, contactId, file } = args;

	if (file.size === 0) {
		throw new AvatarUploadError('corrupt', 'The selected file is empty.');
	}
	if (file.size > MAX_BYTES) {
		throw new AvatarUploadError('too_large', 'Avatars must be 2 MB or smaller.');
	}
	if (!ALLOWED_MIME.has(file.type)) {
		throw new AvatarUploadError('wrong_type', 'Avatars must be JPEG, PNG, or WebP.');
	}

	const buffer = new Uint8Array(await file.arrayBuffer());
	const detected = detectMime(buffer);
	if (!detected || !ALLOWED_MIME.has(detected)) {
		throw new AvatarUploadError('wrong_type', 'That file is not a real JPEG, PNG, or WebP.');
	}

	const random = crypto.randomUUID().replace(/-/g, '');
	const key = `${userId}/${contactId}/${random}.${extensionFor(detected)}`;

	const { error: uploadError } = await supabase.storage.from(BUCKET).upload(key, buffer, {
		contentType: detected,
		cacheControl: '3600',
		upsert: false
	});

	if (uploadError) {
		console.error('[avatars] upload failed:', uploadError);
		throw new AvatarUploadError('storage_failed', 'Could not store the avatar. Please try again.');
	}

	return { key };
}

export async function removeContactAvatar(args: {
	supabase: SupabaseClient<Database>;
	key: string | null;
}): Promise<void> {
	const { supabase, key } = args;
	if (!key) return;

	const { error: removeError } = await supabase.storage.from('contact-avatars').remove([key]);
	if (removeError) {
		// We log and swallow. The DB row is the source of truth; an orphaned
		// file is fixable later by a cleanup job. Failing the request would be worse.
		console.warn('[avatars] orphan after delete failure:', { key, removeError });
	}
}

export async function signAvatarUrl(args: {
	supabase: SupabaseClient<Database>;
	key: string | null;
}): Promise<string | null> {
	const { supabase, key } = args;
	if (!key) return null;

	const { data, error: signError } = await supabase.storage
		.from(BUCKET)
		.createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

	if (signError || !data?.signedUrl) {
		console.warn('[avatars] sign failed:', { key, signError });
		return null;
	}
	return data.signedUrl;
}
```

Save the file.

There's a lot here. Let's walk through it slowly, because every detail is the kind of thing an L7 review would catch:

- **`MAX_BYTES`, `ALLOWED_MIME`** — the same limits we encoded in the bucket migration. Defense in depth: if the platform check is bypassed (it won't be, but if), our app rejects it. If our app is bypassed (it won't be, but if), the bucket rejects it.
- **Magic-byte detection** — `file.type` is set by the browser based on the file extension. A malicious user can rename `evil.exe` to `evil.png` and the browser will happily report `image/png`. Real validation looks at the first few bytes of the file. JPEG always starts with `FF D8 FF`. PNG with `89 50 4E 47`. WebP has `WEBP` at offset 8 inside a RIFF container. We check those explicitly.
- **`crypto.randomUUID()`** — built into Node and modern runtimes. Gives us a globally-unique, unguessable filename. We strip the dashes for shorter keys. We do **not** name files after the original filename — that would leak names like `my-passport.png` into our storage and be enumerable.
- **`upsert: false`** — never overwrite an existing key. With random UUIDs we should never collide, but if we did, we'd want the upload to fail loudly rather than silently replace someone else's file.
- **`AvatarUploadError`** — typed error with a `code`. The route handler can switch on `code` to render specific user-facing messages. Throwing typed errors instead of returning `{ ok: false, message }` keeps the happy-path code clean.
- **`removeContactAvatar`** logs and swallows — because the DB row is the source of truth. If we fail to delete the storage object after updating the row, we'd rather end up with one orphaned file (cleanable later) than a database that says "this contact has no avatar" while the page still renders the old one for an hour.
- **`signAvatarUrl`** returns `null` on failure — the UI just falls back to the initials placeholder. A broken avatar should never break the page.

## Step 5 — Choose your form pattern

Here's where we hit a fork. There are two reasonable ways to wire up the upload form in SvelteKit:

- **Pattern A: Raw `enhance` + Zod.** Plain `<form>`, `use:enhance`, parse `FormData` by hand on the server, validate with Zod. Tiny, no extra deps, easy to debug. This is what the rest of Contactly uses today.
- **Pattern B: SvelteKit Superforms.** A library that gives you typed forms, schema-driven validation, automatic error rendering, and a nicer DX for complex forms with many fields and dynamic state.

Both are correct. Both ship to production at every scale. Pick the one that fits your taste. I'm going to write **both** out so you can compare and choose.

> If you want to follow Pattern B, install Superforms first:
>
> ```bash
> pnpm add -D sveltekit-superforms zod
> ```
>
> If you've already got Zod from earlier modules, you only need the first package.

### Pattern A — Raw `enhance` + Zod

Open `src/routes/(app)/contacts/[id]/edit/+page.server.ts` and add a new action called `uploadAvatar` next to your existing `default` action (or wherever your update action lives):

```ts
// src/routes/(app)/contacts/[id]/edit/+page.server.ts
import { error, fail } from '@sveltejs/kit';
import * as z from 'zod';
import { AvatarUploadError, removeContactAvatar, uploadContactAvatar } from '$lib/server/avatars';
import type { Actions } from './$types';

const uploadAvatarSchema = z.object({
	file: z
		.instanceof(File, { message: 'Please choose a file.' })
		.refine((f) => f.size > 0, 'The selected file is empty.')
});

export const actions: Actions = {
	uploadAvatar: async ({ request, locals, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Unauthorized');

		const formData = await request.formData();
		const parsed = uploadAvatarSchema.safeParse({
			file: formData.get('file')
		});

		if (!parsed.success) {
			return fail(400, { avatarError: parsed.error.issues[0]?.message ?? 'Invalid file.' });
		}

		const { data: existing, error: lookupError } = await locals.supabase
			.from('contacts')
			.select('avatar_url')
			.eq('id', params.id)
			.eq('user_id', user.id)
			.single();

		if (lookupError) {
			return fail(404, { avatarError: 'Contact not found.' });
		}

		try {
			const { key } = await uploadContactAvatar({
				supabase: locals.supabase,
				userId: user.id,
				contactId: params.id,
				file: parsed.data.file
			});

			const { error: updateError } = await locals.supabase
				.from('contacts')
				.update({ avatar_url: key })
				.eq('id', params.id)
				.eq('user_id', user.id);

			if (updateError) {
				// Roll back the storage object so we don't leak files.
				await removeContactAvatar({ supabase: locals.supabase, key });
				return fail(500, { avatarError: 'Could not save the new avatar.' });
			}

			// New avatar saved — best-effort delete the old file.
			await removeContactAvatar({ supabase: locals.supabase, key: existing?.avatar_url ?? null });

			return { avatarSuccess: true };
		} catch (e) {
			if (e instanceof AvatarUploadError) {
				return fail(400, { avatarError: e.message });
			}
			throw e;
		}
	}
};
```

Save it.

What's going on, from top to bottom:

- **`z.instanceof(File)`** — `formData.get('file')` returns `FormDataEntryValue`, which is `File | string | null`. Zod's `instanceof` narrows it for us at the type level and at runtime.
- **The lookup before upload** — we fetch the existing `avatar_url` first, because we need to know which old file to delete after the new one lands. We also use this query to verify the contact belongs to the user before we touch storage. RLS on `contacts` already enforces that, but doing the explicit `.eq('user_id', user.id)` makes the intent obvious in the code review.
- **Order of operations: upload → DB update → delete old.** This order matters. If the upload succeeds and the DB write fails, we delete the new file (cleanup at the catch). If the DB write succeeds, we remove the old file. We never end up with a DB row pointing at a missing object, because the DB write only happens after the new object is confirmed in storage.
- **Best-effort old-file cleanup** — `removeContactAvatar` logs and swallows. If it fails, we have one orphan. Acceptable.
- **Catch `AvatarUploadError`** — the typed error from the helper. We turn it into a user-facing 400 with the message. Anything else re-throws to the framework's 500 handler.

Now the form. Open `src/routes/(app)/contacts/[id]/edit/+page.svelte` and add this avatar block somewhere above your existing edit form:

```svelte
<!-- src/routes/(app)/contacts/[id]/edit/+page.svelte (avatar section) -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import type { ActionData, PageData } from './$types';

	type Props = { data: PageData; form: ActionData };
	let { data, form }: Props = $props();

	let uploading = $state(false);
	let preview = $state<string | null>(null);

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (preview) URL.revokeObjectURL(preview);
		preview = file ? URL.createObjectURL(file) : null;
	}
</script>

<Card>
	<div class="flex items-center gap-4">
		<div
			class="size-16 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900"
		>
			{#if preview ?? data.avatarUrl}
				<img src={preview ?? data.avatarUrl} alt="Contact avatar" class="size-full object-cover" />
			{:else}
				<div class="flex size-full items-center justify-center text-sm text-slate-500">
					{data.contact.first_name[0]}{data.contact.last_name[0]}
				</div>
			{/if}
		</div>

		<form
			method="POST"
			action="?/uploadAvatar"
			enctype="multipart/form-data"
			use:enhance={() => {
				uploading = true;
				return async ({ update }) => {
					await update();
					uploading = false;
					if (preview) URL.revokeObjectURL(preview);
					preview = null;
				};
			}}
			class="flex flex-1 items-center gap-2"
		>
			<input
				type="file"
				name="file"
				accept="image/jpeg,image/png,image/webp"
				required
				onchange={onFileChange}
				class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-slate-800"
			/>
			<Button type="submit" loading={uploading} size="sm">
				{uploading ? 'Uploading…' : 'Upload'}
			</Button>
		</form>
	</div>

	{#if form?.avatarError}
		<p class="mt-3 text-sm text-red-600 dark:text-red-400">{form.avatarError}</p>
	{/if}
	{#if form?.avatarSuccess}
		<p class="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Avatar updated.</p>
	{/if}
</Card>
```

Save it.

The interesting bits:

- **`enctype="multipart/form-data"`** — required. Without it the browser will URL-encode the form and your file becomes a useless string.
- **`action="?/uploadAvatar"`** — targets our named action. The contact's main edit form keeps using its own action separately.
- **`URL.createObjectURL`** — gives us an instant local preview of the chosen file before the upload finishes. We `revokeObjectURL` after the upload to free the memory; otherwise the blob lives until the page unloads.
- **`accept="..."`** — a UX hint. The native file picker filters to those types. Don't rely on it for security; users can pick "All files" in most OS dialogs. The real check is server-side.
- **The fallback initials** — if there's no avatar yet and no preview, we render `FL` from the first/last name. The page never renders a broken `<img>`.

That's Pattern A. Skip Pattern B if you're using this version.

### Pattern B — SvelteKit Superforms

Same feature, different shape. Superforms removes the manual `FormData` plumbing and gives you a single object with errors mapped per-field.

Server. Open `src/routes/(app)/contacts/[id]/edit/+page.server.ts` and add:

```ts
// src/routes/(app)/contacts/[id]/edit/+page.server.ts (superforms version)
import { error, fail } from '@sveltejs/kit';
import { superValidate, withFiles } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import * as z from 'zod';
import { AvatarUploadError, removeContactAvatar, uploadContactAvatar } from '$lib/server/avatars';
import type { Actions, PageServerLoad } from './$types';

const avatarSchema = z.object({
	file: z
		.instanceof(File, { message: 'Please choose a file.' })
		.refine((f) => f.size > 0, 'The selected file is empty.')
});

export const load: PageServerLoad = async () => {
	return {
		avatarForm: await superValidate(zod(avatarSchema))
	};
};

export const actions: Actions = {
	uploadAvatar: async ({ request, locals, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Unauthorized');

		const form = await superValidate(request, zod(avatarSchema));
		if (!form.valid) return fail(400, withFiles({ form }));

		const { data: existing, error: lookupError } = await locals.supabase
			.from('contacts')
			.select('avatar_url')
			.eq('id', params.id)
			.eq('user_id', user.id)
			.single();

		if (lookupError) {
			return fail(404, withFiles({ form, message: 'Contact not found.' }));
		}

		try {
			const { key } = await uploadContactAvatar({
				supabase: locals.supabase,
				userId: user.id,
				contactId: params.id,
				file: form.data.file
			});

			const { error: updateError } = await locals.supabase
				.from('contacts')
				.update({ avatar_url: key })
				.eq('id', params.id)
				.eq('user_id', user.id);

			if (updateError) {
				await removeContactAvatar({ supabase: locals.supabase, key });
				return fail(500, withFiles({ form, message: 'Could not save the new avatar.' }));
			}

			await removeContactAvatar({ supabase: locals.supabase, key: existing?.avatar_url ?? null });

			return withFiles({ form, message: 'Avatar updated.' });
		} catch (e) {
			if (e instanceof AvatarUploadError) {
				return fail(400, withFiles({ form, message: e.message }));
			}
			throw e;
		}
	}
};
```

Save it.

A few Superforms-specific things worth a note:

- **`superValidate(request, zod(schema))`** — parses `FormData`, including files, validates against the schema, and returns a typed `form` object with `data`, `errors`, and `valid`.
- **`withFiles({ form })`** — when you return a form back to the client (on a `fail`), Superforms strips files by default because they don't survive serialization. `withFiles` wraps the response so the client knows to re-render the form without the now-stale file.
- **`load()` returns `avatarForm`** — Superforms expects an empty form to be available on first render. We compute it once in `load`, the client picks it up.

Client. Same component as before, but the script and form change:

```svelte
<!-- src/routes/(app)/contacts/[id]/edit/+page.svelte (superforms version) -->
<script lang="ts">
	import { fileProxy, superForm } from 'sveltekit-superforms';
	import Card from '$components/ui/Card.svelte';
	import Button from '$components/ui/Button.svelte';
	import type { PageData } from './$types';

	type Props = { data: PageData };
	let { data }: Props = $props();

	const { form, errors, message, enhance, submitting } = superForm(data.avatarForm, {
		resetForm: true
	});

	const fileField = fileProxy(form, 'file');

	let preview = $state<string | null>(null);

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (preview) URL.revokeObjectURL(preview);
		preview = file ? URL.createObjectURL(file) : null;
	}
</script>

<Card>
	<div class="flex items-center gap-4">
		<div
			class="size-16 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900"
		>
			{#if preview ?? data.avatarUrl}
				<img src={preview ?? data.avatarUrl} alt="Contact avatar" class="size-full object-cover" />
			{:else}
				<div class="flex size-full items-center justify-center text-sm text-slate-500">
					{data.contact.first_name[0]}{data.contact.last_name[0]}
				</div>
			{/if}
		</div>

		<form
			method="POST"
			action="?/uploadAvatar"
			enctype="multipart/form-data"
			use:enhance
			class="flex flex-1 items-center gap-2"
		>
			<input
				type="file"
				name="file"
				accept="image/jpeg,image/png,image/webp"
				required
				bind:files={$fileField}
				onchange={onFileChange}
				class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-slate-800"
			/>
			<Button type="submit" loading={$submitting} size="sm">
				{$submitting ? 'Uploading…' : 'Upload'}
			</Button>
		</form>
	</div>

	{#if $errors.file}
		<p class="mt-3 text-sm text-red-600 dark:text-red-400">{$errors.file}</p>
	{:else if $message}
		<p class="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{$message}</p>
	{/if}
</Card>
```

Save it.

The Superforms-specific notes:

- **`superForm(data.avatarForm)`** — initialises a typed form bound to the load result. Returns reactive stores: `$form` (values), `$errors` (per-field), `$message` (free-form server message), `$submitting` (in-flight), and an `enhance` action you bind directly to `<form use:enhance>`.
- **`fileProxy(form, 'file')`** — the bridge between Superforms' string-friendly form store and the browser's `FileList` from a real `<input type="file">`. Use `bind:files={$fileField}` and you get correct two-way binding.
- **`resetForm: true`** — clears the form after a successful submit so the file input doesn't keep the stale file selected.

Pick the pattern you like. The rest of the lesson is identical for both.

## Step 6 — Render avatars on the contacts list

The DB now stores keys like `user-id/contact-id/abc.png`. The browser doesn't know what to do with that. We need to ask Storage for a **signed URL** every time we render the list.

Open `src/routes/(app)/contacts/+page.server.ts` and update the `load`:

```ts
// src/routes/(app)/contacts/+page.server.ts
import { error, fail } from '@sveltejs/kit';
import { signAvatarUrl } from '$lib/server/avatars';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	const { data, error: queryError } = await locals.supabase
		.from('contacts')
		.select('id, first_name, last_name, email, phone, company, avatar_url, created_at, updated_at')
		.order('last_name', { ascending: true })
		.order('first_name', { ascending: true });

	if (queryError) {
		console.error('[contacts] load failed:', queryError);
		error(500, 'Failed to load contacts');
	}

	const rows = data ?? [];

	// Sign every avatar URL in parallel. Sequential awaits would multiply
	// our load time by the number of contacts on the page.
	const signedUrls = await Promise.all(
		rows.map((row) => signAvatarUrl({ supabase: locals.supabase, key: row.avatar_url }))
	);

	const contacts = rows.map((row, i) => ({
		...row,
		avatar_signed_url: signedUrls[i]
	}));

	return { contacts };
};
```

Save it.

What changed:

- We added `avatar_url` to the `select`. Cheap and forgettable but easy to forget.
- We call `signAvatarUrl` for every row **in parallel** with `Promise.all`. If you `await` inside a `for` loop, twenty contacts means twenty round-trips back-to-back. With `Promise.all` they run concurrently, the slowest one decides total latency.
- We attach a `avatar_signed_url` field to each row. The DB key stays separate (in `avatar_url`) in case the UI ever needs it (e.g. for a direct delete action).

Now in the list component (`src/routes/(app)/contacts/+page.svelte`), wherever you render the contact card, swap the initial circle for:

```svelte
{#if contact.avatar_signed_url}
	<img src={contact.avatar_signed_url} alt="" class="size-10 rounded-full object-cover" />
{:else}
	<div
		class="flex size-10 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
	>
		{contact.first_name[0]}{contact.last_name[0]}
	</div>
{/if}
```

`alt=""` because the photo is decorative — the contact's name is right next to it. Adding `alt="Avatar of John Doe"` is redundant noise for screen readers.

## Step 7 — Verify it works

A short manual checklist. Don't skip these — every one has caught me at least once.

1. Run `pnpm dev`.
2. Log in.
3. Open any contact's edit page. You should see the gray initials circle and an upload form.
4. Pick a JPEG under 2 MB. Click Upload. The image should appear next to the form within a second or two.
5. Refresh the page. The image is still there. (If it's gone, your DB write didn't go through — check the terminal.)
6. Go back to `/contacts`. The avatar shows in the list.
7. Try uploading something silly: a 5 MB photo, a `.gif`, a `.txt` renamed to `.png`. All three should show a friendly red error message and **not** crash the page.
8. Open a private/incognito window. Try to access the signed URL from step 4 from your devtools. It should work — until it expires in an hour. After that, refresh the page in your normal window; a new signed URL is issued automatically.

If all eight pass, you're done.

## Step 8 — Commit your work

```bash
git add supabase/migrations src/lib src/routes
git commit -m "feat(contacts): add avatar uploads with signed URLs"
git push
```

CI runs, tests pass, your live site picks it up automatically.

## What's next

You now have a real, secure file-upload flow. You can reuse `src/lib/server/avatars.ts` as the template for any other upload feature in the app — listing photos, document attachments, anything. The pattern (private bucket → folder-scoped RLS → magic-byte validation → signed URLs on render → best-effort cleanup) is the same regardless of what you're storing.

In the next bonus we'll move to **CSV Import & Export**, where the same defense-in-depth thinking shows up in a totally different shape: instead of validating bytes, we'll be validating rows.
