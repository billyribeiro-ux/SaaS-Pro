---
title: 'Bonus: Real-Time Multi-Tab Sync'
module: 14
lesson: 5
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-05-realtime-sync'
description: 'Subscribe to Supabase Realtime so contacts created or edited in one tab show up instantly in every other tab — without polling, without reloads.'
duration: 18
preview: false
---

# Bonus: Real-time multi-tab sync with Supabase Realtime

Open Gmail in two tabs. Send yourself an email from one. Watch it appear in the other, instantly, without a refresh. That is the kind of thing users now expect — and it is what separates a "snappy" SaaS from a "feels-like-2010" SaaS.

In this lesson we add real-time sync to Contactly: create or edit a contact in one tab, and every other tab belonging to the same user updates automatically. We will use **Supabase Realtime** for this, and we will understand exactly what is happening under the hood because real-time is full of subtle footguns.

## What is Supabase Realtime?

There are three overlapping features bundled as "Realtime":

1. **Postgres Changes.** Subscribe to INSERT/UPDATE/DELETE events on specific tables. Supabase streams them over WebSocket. This is what we will use.
2. **Broadcast.** Ephemeral messaging: clients publish messages to a named channel, other subscribers receive them. No database involvement. Good for "user is typing" indicators, cursor sharing, chat.
3. **Presence.** Tracks which clients are connected to a channel. Good for "5 users online" displays.

We focus on Postgres Changes, which is the feature most directly useful for data-backed SaaS.

### How Postgres Changes works (the plumbing)

1. Postgres has a feature called **logical replication** — a way for a downstream consumer to subscribe to the stream of changes made to specific tables.
2. Supabase runs a service called `supabase_realtime` that is a logical replication consumer. It reads the firehose of all INSERT/UPDATE/DELETE events to tables in the `supabase_realtime` publication.
3. Clients connect to Realtime over a WebSocket, subscribe to a "channel" (an arbitrary name you pick), and tell Realtime what filters apply.
4. When an event passes the filter — and when RLS would allow the user to SELECT the row — Realtime broadcasts it over the WebSocket.

Two things to internalize:

- **Realtime is not a push-notification service.** It is a change-data-capture pipeline. Every broadcast is backed by a real database change.
- **RLS is still in force.** Realtime runs each broadcast through the same RLS policies as a regular SELECT. A user will never receive an event for a row they cannot SELECT. This is critical: if it were not true, real-time would be a massive data-leak channel.

## Step 1: Enable replication on the contacts table

By default, Supabase publishes no tables to the Realtime service, to avoid accidentally broadcasting sensitive data. We have to explicitly opt in.

1. Open the Supabase dashboard.
2. Left sidebar → **Database → Replication**.
3. You will see a single publication called `supabase_realtime`.
4. Click on it. You will see a table list; every table toggle is probably OFF.
5. Toggle **contacts** to ON.
6. Save.

Alternatively, SQL:

```sql
alter publication supabase_realtime add table public.contacts;
```

> **Security thought.** We opt in table-by-table. Never add `supabase_realtime for all tables` — that would include internal tables like `auth.users` which contain password hashes and email verification tokens. RLS protects reads, but do not give Realtime more data than it needs.

## Step 2: Expose the browser Supabase client to pages

Realtime subscriptions run in the browser — they need an open WebSocket. That means our load functions must hand the browser Supabase client down to page components.

Our existing `src/routes/+layout.ts` (the **universal** layout load; note `.ts` not `.server.ts`) should look like this, creating a browser client.

### `src/routes/+layout.ts`

```ts
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
	/**
	 * Declare a dependency so the layout can be invalidated, for example after
	 * a successful sign-in or via realtime events.
	 */
	depends('supabase:auth');
	depends('app:contacts');

	const supabase = isBrowser()
		? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch }
			})
		: createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch },
				cookies: { getAll: () => data.cookies }
			});

	const {
		data: { user }
	} = await supabase.auth.getUser();

	return { supabase, user };
};
```

Key points:

- **`isBrowser()`** — the universal load runs on both server and browser. We use `createBrowserClient` in the browser (where we want a long-lived client with WebSocket support) and `createServerClient` on the server (where we want one-shot, cookie-backed clients per request).
- **`depends('app:contacts')`** — this registers a dependency key. Anywhere in our app we call `invalidate('app:contacts')`, this load function reruns. That is how Realtime events will trigger a data refresh: instead of manually splicing changes into our state, we invalidate and let SvelteKit re-fetch.

Match this in the server layout so cookies flow correctly. Most of you have this from earlier modules; if not, the general shape is:

### `src/routes/+layout.server.ts`

```ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { getUser }, cookies }) => {
	const user = await getUser();
	return {
		user,
		cookies: cookies.getAll()
	};
};
```

## Step 3: Subscribe in the contacts list page

Now the fun part. We will open a Realtime subscription when the contacts list mounts, close it when the component unmounts, and invalidate the load function on every event.

### `src/routes/(app)/contacts/+page.svelte`

```svelte
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { invalidate } from '$app/navigation';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { data } = $props();

	let channel: RealtimeChannel | null = null;
	let connectionStatus = $state<'connecting' | 'connected' | 'error' | 'closed'>('connecting');

	onMount(() => {
		// Build a channel name scoped to the user so a user's tabs share the
		// same channel but other users are on separate channels. Name is
		// arbitrary; it just has to be unique per subscription.
		const channelName = `contacts:${data.user.id}`;

		channel = data.supabase
			.channel(channelName)
			.on(
				'postgres_changes',
				{
					event: '*', // INSERT | UPDATE | DELETE
					schema: 'public',
					table: 'contacts',
					filter: `user_id=eq.${data.user.id}`
				},
				(payload) => {
					// `payload` has { eventType, new, old, ... } if you ever want
					// to splice the changes in manually. For simplicity we just
					// re-run the load function.
					console.debug('[realtime] contacts event', payload.eventType);
					invalidate('app:contacts');
				}
			)
			.subscribe((status) => {
				if (status === 'SUBSCRIBED') connectionStatus = 'connected';
				else if (status === 'CHANNEL_ERROR') connectionStatus = 'error';
				else if (status === 'CLOSED') connectionStatus = 'closed';
			});
	});

	onDestroy(() => {
		if (channel) {
			data.supabase.removeChannel(channel);
			channel = null;
		}
	});
</script>

<div class="mb-2 flex items-center justify-between">
	<h1 class="text-2xl font-semibold">Contacts</h1>
	<span
		class="text-xs"
		class:text-green-600={connectionStatus === 'connected'}
		class:text-yellow-600={connectionStatus === 'connecting'}
		class:text-red-600={connectionStatus === 'error'}
		class:text-gray-400={connectionStatus === 'closed'}
	>
		{#if connectionStatus === 'connected'}
			Live
		{:else if connectionStatus === 'connecting'}
			Connecting…
		{:else if connectionStatus === 'error'}
			Live unavailable
		{:else}
			Offline
		{/if}
	</span>
</div>

<ul class="divide-y divide-gray-100">
	{#each data.contacts as c (c.id)}
		<li class="flex items-center gap-3 py-3">
			<a href="/contacts/{c.id}" class="font-medium hover:underline">
				{c.first_name ?? ''}
				{c.last_name ?? ''}
			</a>
			<span class="ml-auto text-sm text-gray-500">{c.email ?? ''}</span>
		</li>
	{/each}
</ul>
```

### Walk through the subscription

**`data.supabase.channel(channelName)`** — creates a new channel object. The name is a label. Channels scoped per-user are useful because you can also use them for Broadcast/Presence later ("show me everyone typing in this doc"). For Postgres Changes, the channel name does not affect what events you get — that is governed entirely by the `.on()` filter.

**`.on('postgres_changes', config, handler)`** — registers a handler for Postgres change events.

Config object:

- **`event: '*'`** — subscribe to INSERT, UPDATE, and DELETE. You can set it to any one specifically.
- **`schema: 'public'`** — schema name. Supabase uses `public` by default for your tables.
- **`table: 'contacts'`** — the table to watch.
- **`filter: 'user_id=eq.<uuid>'`** — a server-side filter. Realtime only broadcasts matching rows, which reduces bandwidth and event volume on the client. **This is a performance optimization, NOT security.** RLS is still the actual protection — the filter is just a hint so Realtime does not bother streaming events that the client would discard anyway.

**Defense in depth.** If we set `filter: 'user_id=eq.someone-else'` maliciously, we would still NOT receive events for their rows — RLS blocks the broadcast. The filter is just an optimization. This is important to internalize: never rely on client-side filters for security; always rely on RLS.

**`.subscribe((status) => ...)`** — opens the WebSocket. The callback gets `SUBSCRIBED` when it succeeds; `CHANNEL_ERROR` or `CLOSED` on failures.

**`invalidate('app:contacts')`** — this is the SvelteKit magic. Because our layout declared `depends('app:contacts')`, this call reruns the load function, which re-fetches contacts, which re-renders the list. We do not need to manually reconcile INSERT/UPDATE/DELETE events with our local state — we just tell SvelteKit "the data changed" and let it handle the rest.

**`onDestroy(() => removeChannel(...))`** — absolutely critical. If you forget this, every page navigation leaks a WebSocket subscription. After a few minutes of normal use, the browser is holding dozens of open subscriptions, CPU spins, and you get rate-limited by Supabase. Always clean up.

> **Note on `onMount` vs `$effect`.** You could do this in an `$effect(() => { ... })` with a cleanup return. That works and is more Svelte-5-idiomatic. `onMount`/`onDestroy` is also fine and more explicit about lifecycle. Both are fully supported with runes. Use whichever reads clearer to you.

## Step 4: Also handle the detail page

If a user is viewing `/contacts/123` in tab A and editing the same contact in tab B, we want tab A to refresh when the save happens.

### `src/routes/(app)/contacts/[id]/+page.svelte`

Add to the existing component:

```svelte
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { invalidate } from '$app/navigation';
	import type { RealtimeChannel } from '@supabase/supabase-js';

	let { data } = $props();

	let channel: RealtimeChannel | null = null;

	onMount(() => {
		channel = data.supabase
			.channel(`contact:${data.contact.id}`)
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'contacts',
					filter: `id=eq.${data.contact.id}`
				},
				() => invalidate('app:contact')
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) data.supabase.removeChannel(channel);
	});
</script>
```

And in the detail load function, declare `depends('app:contact')`:

### `src/routes/(app)/contacts/[id]/+page.server.ts`

```ts
export const load: PageServerLoad = async ({ params, locals: { supabase, getUser }, depends }) => {
	depends('app:contact');
	const user = await getUser();
	// ... rest
};
```

Now the detail page live-updates too.

## Step 5: Test it

1. Open two browser windows side by side, both logged in as the same user.
2. In window A, go to `/contacts`.
3. In window B, go to `/contacts` also. Or go to `/contacts/new`.
4. In window B, create a new contact. The list in window A updates without a refresh. You should see the new row appear.
5. In window A, click on the new contact to open its detail page.
6. In window B, edit that contact (change the first name) and save.
7. Watch window A update immediately.
8. Delete the contact from window B. Window A's detail page should navigate away (because the row no longer exists and the load function will redirect). You can test this by explicitly handling 404 in the load function.

Now open the browser devtools Network tab, filter to "WS" (WebSockets). You should see exactly one open connection to `wss://<project>.supabase.co/realtime/v1/websocket`. If you navigate between pages, the frame traffic on that connection ticks as channels are joined and left, but the underlying socket stays open. That is the efficient design: one WebSocket per browser tab, many logical channels multiplexed over it.

## Gotchas and what senior engineers think about

### 1. `@supabase/ssr` and Realtime: the cookies trap

Our server client (`createServerClient`) uses cookies for auth. Our browser client uses either cookies (for SSR) or localStorage (for pure-client apps). The `createBrowserClient` defaults to using cookies to match SSR — which means Realtime uses the same JWT as your HTTP requests, which is exactly what we want.

Where people get tripped up: if you instantiate `createClient` (not `createBrowserClient`) in client code, it defaults to localStorage. If your SSR layout sets cookies and your client `createClient` reads from localStorage, they drift, and Realtime connects with a stale or missing JWT. Symptom: subscriptions never fire, or fire once then die. **Fix:** always use `createBrowserClient` in the browser so it stays cookie-aware. Our `+layout.ts` does this correctly.

### 2. Token refresh

Supabase auth tokens expire (default: 1 hour). The Supabase client auto-refreshes them. Realtime detects the refresh and re-authenticates the WebSocket. In practice, a tab that stays open for 8 hours stays connected fine. You do not need to handle refresh manually.

### 3. Reconnection

If the user's network blips (wifi drop, tunnel, laptop sleep), the WebSocket closes. Supabase's client reconnects automatically with exponential backoff. During the downtime, events are **lost** — Realtime does not buffer missed events. When the connection re-establishes, your subscription is resubscribed and new events flow, but anything that happened while offline is missed. This is why we call `invalidate` on reconnection too — actually, our current code does not; we should. Add:

```ts
.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    connectionStatus = 'connected'
    invalidate('app:contacts') // refetch in case we missed events
  }
  // ...
})
```

This ensures that any changes that happened during a disconnect get picked up the moment we reconnect.

### 4. The `filter` option syntax

Realtime filters use PostgREST-style operator syntax. The ones you will use most:

- `user_id=eq.<uuid>` — equality
- `status=in.(active,pending)` — membership
- `created_at=gt.2024-01-01` — comparison

You can only have ONE filter per `.on()`. If you need AND logic, the filter can still be a single expression; if you need OR or complex logic, you either subscribe to `*` and filter client-side, or you subscribe to multiple channels.

Note that `like` and `ilike` are not supported in filters, but equality and in-list cover 90% of real use cases.

### 5. Performance

Each subscription costs Supabase some CPU and bandwidth. For a typical app it is trivial, but if you are subscribing to every row in a huge table (`event: '*'` with no filter), you can saturate the client. Strategies:

- Filter narrowly. Subscribe to only the user's own rows.
- Subscribe to the specific events you need (INSERT only, if you never need UPDATE notifications).
- Share channels — if multiple components need the same data, subscribe once in a layout and let children invalidate.

### 6. Order of events vs. RLS changes

An edge case: if row ownership changes (user_id updated from A to B), user A might see the UPDATE event (because they could SELECT the "old" version) and user B might also see it (because they can SELECT the "new" version). This is usually fine but worth thinking about if your RLS is row-specific.

### 7. The "2 tabs, same action, race" question

If two tabs both issue a form action that edits the same contact, we get two HTTP requests and two realtime events. The last write wins at the database level. Each tab receives two events — one for its own write, one for the other tab's. `invalidate` is idempotent, so calling it twice is fine: both tabs end up showing the final state.

If you need optimistic-concurrency control (reject the second write), add a `version` column to contacts with `check (version = OLD.version)` via a trigger, or use Postgres row locks. For Contactly this is overkill.

### 8. Don't subscribe to tables with PII you should not leak

Your RLS policies protect you at read-time. But think: do I want my frontend to even _know_ that some row exists with a sensitive name, before RLS filters it out? For Contactly the answer is fine because contacts are owned 1:1 by users. If you have a multi-tenant table where rows might be visible to some users but not others, double-check your RLS policies cover Realtime too by looking at Supabase logs for REALTIME events.

## What you built

With about 30 lines of code across three files:

- Multi-tab sync: edits in one tab appear in others.
- Multi-device sync: edits on your phone appear on your laptop.
- Defense-in-depth: RLS, server-side filter, plus narrow channel scoping.
- Cheap reconnection: `invalidate` on resubscribe covers offline gaps.
- Clean teardown: no leaked sockets.

This is the foundation for any collaborative feature you might add later — shared boards, multi-user comments, presence indicators. All of those are small variations on what you just did.

Next bonus: dark mode, done right.
