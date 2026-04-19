# Bonus: Contact avatars with Supabase Storage

Contactly looks professional now, but every contact card is the same gray circle with initials. In this lesson we will let users upload a profile photo for each contact. We will use Supabase Storage, and we will do it the safe way — private bucket, per-user folders, signed URLs, MIME validation, size caps, and Row Level Security on the bucket itself.

We will not just "make it work." We will build the kind of upload flow you would be proud to defend in a security review.

## What is object storage?

A normal filesystem stores files in a tree of folders, accessed by path on your hard drive. It scales to one computer. A **database** stores structured rows, accessed by keys and indexes; it scales but is expensive per gigabyte. **Object storage** is a third thing: a big flat key-value store where the key is a filename (like `users/alice/avatar.png`) and the value is an arbitrary blob of bytes. It is cheap per gigabyte, scales horizontally across many servers, and is the right tool for "blobs that are bigger than a row in a database" — images, PDFs, videos, backups.

Examples you have heard of: **Amazon S3**, **Google Cloud Storage**, **Cloudflare R2**. Supabase Storage is built on top of S3-compatible storage and exposes it via REST and a JavaScript SDK.

### The vocabulary you need

- **Bucket:** a top-level container for files, like a drive or a root folder. You create buckets in the dashboard.
- **Object:** a single file inside a bucket. The "key" is the path, e.g. `user-id/contact-id/abc123.png`.
- **Public bucket:** anyone on the internet who knows the URL can `GET` objects. Good for non-sensitive assets (marketing images, your logo).
- **Private bucket:** clients must authenticate and pass RLS checks to read or write. Good for user content.
- **Signed URL:** a temporary, signed URL that grants a specific object access for a short window (minutes to hours) without requiring auth. Useful for embedding a private image in an `<img>` tag — the browser fetches the image directly from Supabase's CDN, no JS credentials needed.

## Why avatars belong in a private bucket

A contact's photo is personal data. If bucket is public, the raw URL — something like `https://<project>.supabase.co/storage/v1/object/public/avatars/user-1/contact-3/abc.png` — is a permanent, unguessable-but-not-secret token. Anyone who gets that URL can see the image forever. Worse, if you accidentally log it, embed it in a shared screenshot, or leak it in a referer header, the image is exposed.

With a **private** bucket plus **signed URLs**, even if a URL leaks, it expires in an hour. And on the server side, even authenticated users can only read files inside their own folder, because we write an RLS policy that enforces it. That is defense in depth:

1. **Bucket privacy** — default-deny for unauthenticated access.
2. **Storage RLS policies** — default-deny even for authenticated users outside their folder.
3. **Signed-URL expiry** — leaked URLs become useless in an hour.

## Step 1: The migration — bucket, column, policies

Create a new migration file. We will do everything in one migration for atomicity.

### `supabase/migrations/20260418_avatars.sql`

```sql
-- ============================================================
-- Contact avatars migration
-- ============================================================

-- 1. Create the avatars bucket (private).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- 2. Add avatar_path to contacts.
alter table public.contacts
  add column if not exists avatar_path text;

-- 3. Storage RLS: users can read only their own folder.
create policy "avatars: owner can read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Storage RLS: users can insert into only their own folder.
create policy "avatars: owner can insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Storage RLS: users can update only their own files (for upsert).
create policy "avatars: owner can update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6. Storage RLS: users can delete only their own files.
create policy "avatars: owner can delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Let us unpack this carefully.

**`storage.buckets`** is a Postgres table inside the `storage` schema that Supabase manages. Inserting a row is how you create a bucket programmatically. `public: false` means unauthenticated `GET` requests are refused.

**`storage.objects`** is the metadata table for every file. `name` is the full path including folders, e.g. `abc-user-id/def-contact-id/photo.png`. `bucket_id` is which bucket the file belongs to.

**`storage.foldername(name)`** is a Supabase-provided function that splits the path on `/` and returns an array of folder names. For `abc/def/photo.png` it returns `{abc, def}`. So `(storage.foldername(name))[1]` is the first element — `abc` — which we constrain to equal `auth.uid()::text`. In other words: **the first folder in every path must be the current user's ID.**

This means user `abc-123` can only touch files under `abc-123/whatever/...`. User `def-456` cannot see or modify `abc-123`'s files. Postgres enforces this at the RLS layer, so even if our frontend code has a bug that tries to upload to someone else's folder, Postgres refuses.

**Four policies — select/insert/update/delete — cover all operations.** Supabase Storage translates every API call (upload, download, delete, etc.) into the corresponding SQL operation on `storage.objects`, so those four policies fully constrain the API.

Apply the migration:

```bash
pnpm supabase migration up
```

or, if you manage migrations through the Supabase dashboard, paste the SQL into the SQL editor and run it. Then verify:

1. **Dashboard → Storage.** You should see a bucket called `avatars` with a "private" tag.
2. **Dashboard → Authentication → Policies → storage.objects tab.** You should see four policies starting with `avatars:`.
3. **Dashboard → Table Editor → contacts.** You should see the new `avatar_path` column.

## Step 2: The upload form component

We want a reusable `<AvatarUpload>` component that:

- Shows the current avatar (or a placeholder if none).
- Lets the user pick a new file.
- Previews the new file immediately (before upload) so they know what they chose.
- Submits the file to a form action when they save.
- Validates client-side for a better UX — but we will validate server-side too, because client validation is never security.

### `src/lib/components/AvatarUpload.svelte`

```svelte
<script lang="ts">
  type Props = {
    /** Currently stored avatar URL (signed) or undefined if none. */
    currentUrl: string | null
    /** Max file size in bytes (default 2MB). */
    maxBytes?: number
  }

  let { currentUrl, maxBytes = 2 * 1024 * 1024 }: Props = $props()

  let fileInput = $state<HTMLInputElement>()
  let previewUrl = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

  const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

  function handlePick(e: Event) {
    errorMessage = null
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      previewUrl = null
      return
    }

    if (!ACCEPTED.includes(file.type)) {
      errorMessage = 'Please choose a JPEG, PNG, or WebP image.'
      input.value = ''
      previewUrl = null
      return
    }
    if (file.size > maxBytes) {
      errorMessage = `File too large. Max is ${(maxBytes / 1024 / 1024).toFixed(0)}MB.`
      input.value = ''
      previewUrl = null
      return
    }

    // Generate a preview URL. FileReader returns base64, cheap and
    // no external request needed.
    const reader = new FileReader()
    reader.onload = () => {
      previewUrl = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  const displayUrl = $derived(previewUrl ?? currentUrl)
</script>

<div class="flex items-center gap-4">
  <div
    class="h-20 w-20 overflow-hidden rounded-full bg-gray-200 ring-1 ring-gray-300"
  >
    {#if displayUrl}
      <img src={displayUrl} alt="Avatar" class="h-full w-full object-cover" />
    {:else}
      <div class="flex h-full w-full items-center justify-center text-gray-400">
        <svg class="h-10 w-10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-8 2-8 6v2h16v-2c0-4-4-6-8-6z" />
        </svg>
      </div>
    {/if}
  </div>

  <div class="flex-1">
    <input
      bind:this={fileInput}
      type="file"
      name="avatar"
      accept="image/jpeg,image/png,image/webp"
      onchange={handlePick}
      class="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-black file:px-3 file:py-2 file:text-white"
    />
    {#if errorMessage}
      <p class="mt-1 text-sm text-red-600">{errorMessage}</p>
    {:else}
      <p class="mt-1 text-xs text-gray-500">JPG, PNG, WebP. Max 2MB.</p>
    {/if}
  </div>
</div>
```

Key ideas:

- `type Props = { currentUrl: string | null; maxBytes?: number }` — we type the props so TypeScript yells if callers pass garbage.
- `let { ... }: Props = $props()` — Svelte 5 runes prop destructuring.
- `let previewUrl = $state<string | null>(null)` — runes reactive state.
- `$derived(previewUrl ?? currentUrl)` — show the preview if we have one, otherwise the stored avatar. `$derived` re-evaluates whenever its dependencies change.
- `FileReader.readAsDataURL(file)` — reads the chosen file into a base64 data URL we can assign directly to `<img src>`. This is how you show an image preview before upload without any network request. It is a bit memory-heavy for multi-megabyte files, but fine for 2MB avatars.
- `input.value = ''` on validation failure — resets the file input so picking the same invalid file again re-fires the `change` event. Without this, if a user picks `huge.png`, sees the error, then picks `huge.png` again, nothing happens.
- `name="avatar"` on the `<input type="file">` — when this is inside a form with `enctype="multipart/form-data"`, the browser will include the binary bytes in the form submission under the field name `avatar`.

## Step 3: The parent form that uses the component

Say we are editing a contact at `src/routes/(app)/contacts/[id]/edit/+page.svelte`. We already have a form for name/email/company. We just need to add the avatar upload beside it.

### `src/routes/(app)/contacts/[id]/edit/+page.svelte`

```svelte
<script lang="ts">
  import AvatarUpload from '$lib/components/AvatarUpload.svelte'
  import { enhance } from '$app/forms'

  let { data, form } = $props()
</script>

<h1 class="text-2xl font-semibold">Edit contact</h1>

<form
  method="POST"
  action="?/save"
  enctype="multipart/form-data"
  use:enhance
  class="mt-6 max-w-xl space-y-6"
>
  <AvatarUpload currentUrl={data.avatarUrl} />

  <label class="block">
    <span class="text-sm">First name</span>
    <input
      name="first_name"
      value={data.contact.first_name ?? ''}
      class="mt-1 block w-full rounded border px-3 py-2"
    />
  </label>

  <label class="block">
    <span class="text-sm">Last name</span>
    <input
      name="last_name"
      value={data.contact.last_name ?? ''}
      class="mt-1 block w-full rounded border px-3 py-2"
    />
  </label>

  <label class="block">
    <span class="text-sm">Email</span>
    <input
      name="email"
      type="email"
      value={data.contact.email ?? ''}
      class="mt-1 block w-full rounded border px-3 py-2"
    />
  </label>

  <label class="block">
    <span class="text-sm">Company</span>
    <input
      name="company"
      value={data.contact.company ?? ''}
      class="mt-1 block w-full rounded border px-3 py-2"
    />
  </label>

  {#if form?.error}
    <p class="text-sm text-red-600">{form.error}</p>
  {/if}

  <button class="rounded bg-black px-4 py-2 text-white">Save</button>
</form>
```

Critical detail: **`enctype="multipart/form-data"`**. Without this, the browser will send the form as `application/x-www-form-urlencoded` and the file bytes will be silently dropped. If you ever write a form that uploads a file and "the file is empty on the server", it is almost certainly a missing `enctype`.

## Step 4: The load function

### `src/routes/(app)/contacts/[id]/edit/+page.server.ts`

```ts
import { error, fail, redirect } from '@sveltejs/kit'
import * as z from 'zod'
import type { Actions, PageServerLoad } from './$types'

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
type AcceptedMime = (typeof ACCEPTED_MIME)[number]
const isAcceptedMime = (mime: string): mime is AcceptedMime =>
  (ACCEPTED_MIME as readonly string[]).includes(mime)

const MAX_BYTES = 2 * 1024 * 1024
const EXT_BY_MIME: Record<AcceptedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

const ContactSchema = z.object({
  first_name: z.string().trim().max(100).nullable().transform((v) => v || null),
  last_name: z.string().trim().max(100).nullable().transform((v) => v || null),
  email: z.string().trim().toLowerCase().email().nullable().transform((v) => v || null),
  company: z.string().trim().max(200).nullable().transform((v) => v || null)
})

export const load: PageServerLoad = async ({ params, locals: { supabase, getUser } }) => {
  const user = await getUser()
  if (!user) throw redirect(303, '/login')

  const { data: contact, error: dbError } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', params.id)
    .single()

  if (dbError || !contact) throw error(404, 'Contact not found')

  let avatarUrl: string | null = null
  if (contact.avatar_path) {
    const { data: signed } = await supabase.storage
      .from('avatars')
      .createSignedUrl(contact.avatar_path, 3600) // 1 hour
    avatarUrl = signed?.signedUrl ?? null
  }

  return { contact, avatarUrl }
}

export const actions: Actions = {
  save: async ({ request, params, locals: { supabase, getUser } }) => {
    const user = await getUser()
    if (!user) throw redirect(303, '/login')

    const formData = await request.formData()

    // ---- 1. Validate text fields ----
    const parsed = ContactSchema.safeParse({
      first_name: formData.get('first_name'),
      last_name: formData.get('last_name'),
      email: formData.get('email'),
      company: formData.get('company')
    })
    if (!parsed.success) {
      return fail(400, { error: 'Invalid fields: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', ') })
    }

    // ---- 2. Handle avatar file (optional) ----
    const file = formData.get('avatar')
    let avatarPath: string | undefined

    if (file instanceof File && file.size > 0) {
      if (!isAcceptedMime(file.type)) {
        return fail(400, { error: 'Avatar must be JPEG, PNG, or WebP.' })
      }
      if (file.size > MAX_BYTES) {
        return fail(400, { error: `Avatar must be under ${MAX_BYTES / 1024 / 1024}MB.` })
      }

      const ext = EXT_BY_MIME[file.type]
      avatarPath = `${user.id}/${params.id}/${crypto.randomUUID()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(avatarPath, file, {
          contentType: file.type,
          upsert: true,
          cacheControl: '3600'
        })

      if (uploadError) {
        console.error('avatar upload failed', uploadError)
        return fail(500, { error: 'Failed to upload avatar.' })
      }
    }

    // ---- 3. Save row ----
    const update: Record<string, unknown> = { ...parsed.data }
    if (avatarPath) update.avatar_path = avatarPath

    const { error: updateError } = await supabase
      .from('contacts')
      .update(update)
      .eq('id', params.id)

    if (updateError) {
      return fail(500, { error: updateError.message })
    }

    throw redirect(303, `/contacts/${params.id}`)
  }
}
```

Let us go line by line through the security-relevant parts.

**`ACCEPTED_MIME`** — we list the exact MIME types we accept. `image/svg+xml` is NOT on the list because SVG can contain `<script>` tags and constitutes an XSS vector if served inline. `image/gif` is excluded because it is rarely useful for avatars and decoding gifs can be a memory vector. If you want to allow GIF later, add it explicitly.

**`isAcceptedMime` type predicate** — TypeScript's narrowest types on `as const` tuples make `ACCEPTED_MIME.includes(anyString)` a compile error (the tuple's literal-type argument is narrower than `string`). Instead of escaping with `file.type as any`, a one-line user-defined type guard (`mime is AcceptedMime`) both satisfies the compiler *and* narrows `file.type` to the literal union on the true branch — so `EXT_BY_MIME[file.type]` below is a typed index into a `Record<AcceptedMime, string>`, not a loose `Record<string, string>` lookup. Free correctness.

**`MAX_BYTES`** — 2MB. Enforced server-side. The client-side check in the component is UX, not security. A malicious client can always skip it.

**`ContactSchema`** — Zod v4 schema with `.trim()` and `.toLowerCase()` transforms on email, and `.transform((v) => v || null)` so empty strings become `null` (Postgres treats those differently and we want null for "not set").

**`file instanceof File && file.size > 0`** — `formData.get('avatar')` can return `null` (no field), a `File` with `size === 0` (field present but empty), or a real `File`. We only process a real non-empty file.

**`avatarPath = `${user.id}/${params.id}/${crypto.randomUUID()}.${ext}``** — the path has three segments:
1. **`user.id`** — required by our RLS policy. Postgres will reject uploads where this does not match the caller.
2. **`params.id`** (the contact ID) — organizes files so deleting a contact can later delete its avatars easily.
3. **`crypto.randomUUID()`** — a fresh filename every time. If the user re-uploads, we do not overwrite — we write to a new path. This avoids CDN caching bugs where the old avatar keeps showing up because the URL did not change.

Why do we `upsert: true` if we are generating a unique filename every time? Because it does no harm and guards against the ultra-rare case of a UUID collision (functionally zero probability). More importantly, `upsert` means Supabase Storage does not error if the object somehow already exists — which can happen with retries.

**`cacheControl: '3600'`** — tells Supabase to set `Cache-Control: max-age=3600` on the CDN response, so the browser caches the image for an hour. The signed URL also lasts one hour, so these line up.

**`.upload(path, file, ...)`** — this sends the raw file bytes to Supabase Storage. The server Supabase client is RLS-aware, so if `user.id` does not match what is in the path, the storage.objects insert policy will reject.

**`update.avatar_path = avatarPath`** — we only overwrite `avatar_path` in the DB if a new file was uploaded. If the user did not pick a new file, the existing `avatar_path` is unchanged.

**Leaking old avatars?** Yes — when a user uploads a new avatar, the old file is still in storage. In a production app you would clean up with a background job, or inside the action itself (before updating `avatar_path`, read the old value and `.remove([oldPath])`). For a learning project it is fine to leave orphaned files; storage is cheap. We will add cleanup later.

## Step 5: Displaying avatars in the list view

The contacts list needs to show avatars too. Here we have to generate a signed URL per contact, which is an extra call per row. For a list of 50 contacts that is fine. If you ever hit hundreds, batch via `createSignedUrls` (plural).

### `src/routes/(app)/contacts/+page.server.ts`

```ts
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals: { supabase, getUser } }) => {
  const user = await getUser()
  if (!user) throw redirect(303, '/login')

  const { data: contacts, error: dbError } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, company, avatar_path')
    .order('created_at', { ascending: false })

  if (dbError) throw new Error(dbError.message)

  const pathsToSign = contacts
    .filter((c) => c.avatar_path)
    .map((c) => c.avatar_path!) as string[]

  let signedByPath = new Map<string, string>()
  if (pathsToSign.length > 0) {
    const { data: signed } = await supabase.storage
      .from('avatars')
      .createSignedUrls(pathsToSign, 3600)
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl)
    })
  }

  const contactsWithAvatars = contacts.map((c) => ({
    ...c,
    avatarUrl: c.avatar_path ? signedByPath.get(c.avatar_path) ?? null : null
  }))

  return { contacts: contactsWithAvatars }
}
```

And the list template:

### `src/routes/(app)/contacts/+page.svelte`

```svelte
<script lang="ts">
  let { data } = $props()
</script>

<ul class="divide-y divide-gray-100">
  {#each data.contacts as c (c.id)}
    <li class="flex items-center gap-3 py-3">
      {#if c.avatarUrl}
        <img src={c.avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
      {:else}
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm">
          {(c.first_name?.[0] ?? '?') + (c.last_name?.[0] ?? '')}
        </div>
      {/if}
      <a href="/contacts/{c.id}" class="font-medium hover:underline">
        {c.first_name ?? ''} {c.last_name ?? ''}
      </a>
      <span class="ml-auto text-sm text-gray-500">{c.email ?? ''}</span>
    </li>
  {/each}
</ul>
```

**Why keyed each (`(c.id)`)?** Svelte uses the key to track which DOM node belongs to which row. Without it, if the list reorders, Svelte reuses nodes in place — which means an `<img>` that had one signed URL might try to display a different contact's photo for a flash. Always key lists that contain per-row side-effecty elements like images.

## Step 6: Test the full flow

1. Apply the migration.
2. `pnpm dev`.
3. Go to a contact's edit page. Pick a JPG under 2MB. You should see an instant preview.
4. Click Save. You are redirected back to the contact detail page with the new avatar.
5. Go to **Supabase Dashboard → Storage → avatars**. You should see a folder named with your user UUID. Inside, a folder with the contact UUID. Inside that, your file.
6. Try to cheat: in devtools, submit the form with a `.txt` file renamed to `.jpg`. The server should reject it because the MIME type is `text/plain`, not `image/jpeg`. (Browsers set MIME from file content, not just extension — another reason client-side validation is not enough.)
7. Try to upload a 10MB file. Server rejects with the size error.
8. In Storage, manually try to upload a file to another user's folder via the dashboard. It will fail the RLS check if you are logged in as a non-service-role user. (Dashboard uses service role, so dashboard bypasses — this is expected. The RLS protects API traffic, which is what clients see.)

## Why not public URLs?

If the bucket were public, you could use `getPublicUrl(path)` instead of `createSignedUrl`. It is simpler: no expiry, no second API call, URL is stable forever. You would use this for things like your logo, product images on a marketing page — data you want search engines to index and the CDN to cache aggressively.

For contact photos, though, we do not want that. Contact photos are private — they are tied to the owner's account. Even if the URL is unguessable, "unguessable" is not a security model. Signed URLs with expiry give us a security model: the image is only reachable while a valid signature exists, and only for an hour.

## Senior-engineer checklist

- [x] MIME validated server-side against a specific allowlist (not a blocklist).
- [x] File size capped server-side.
- [x] SVG and other script-capable formats rejected.
- [x] Upload path enforced to include `user.id` as first segment via RLS.
- [x] Unique filename per upload (no overwrite bugs, no CDN staleness).
- [x] Bucket private; access only via short-lived signed URLs.
- [x] Client-side validation for UX, but never trusted.
- [x] `enctype="multipart/form-data"` on the form.
- [ ] TODO: cleanup of orphaned avatars when a new one is uploaded. Add later.
- [ ] TODO: cleanup of all avatars when a contact is deleted. Add later.
- [ ] TODO: virus scanning — most SaaS does not need this for images, but if you ever accept arbitrary file types, integrate ClamAV or similar.

Now every contact card has a face. Let us go import some contacts in bulk.
