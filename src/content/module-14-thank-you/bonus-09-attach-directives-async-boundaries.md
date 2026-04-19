---
title: '{@attach} directives & <svelte:boundary>'
module: 14
lesson: 9
moduleSlug: thank-you
lessonSlug: attach-directives-async-boundaries
description: 'Replace use: actions with the composable {@attach} directive, and wrap async UI in <svelte:boundary> for graceful pending and error states.'
duration: 30
preview: false
---

# Bonus: {@attach} directives & <svelte:boundary>

This lesson bundles two features that you will reach for constantly in a modern Svelte app:

1. **`{@attach ...}`** — Svelte 5.29's replacement for `use:` actions. A way to run imperative code against a DOM element. Smaller, more composable, more reactive, and usable in places actions cannot go.
2. **`<svelte:boundary>`** — Svelte 5.3's error-and-async boundary. Catches errors in child components. Renders a pending state while `await` expressions resolve. The essential glue for async UI that does not fall apart when something breaks.

Both are quietly replacing older patterns. Actions still work; they are not deprecated. But in code I write today, I reach for attachments first because they solve a set of real ergonomic problems that actions never could. Boundaries, on the other hand, are simply required for the async-in-markup pattern you learned in the Remote Functions lesson — if your UI uses `await` inside templates, it uses a boundary.

By the end of this lesson you will:

- Understand the difference between actions and attachments, and why the team introduced a new primitive.
- Write attachments that accept arguments and return cleanup functions.
- Compose attachments (wrap them in factories, pass them through props).
- Migrate three common patterns from `use:` to `{@attach}`: click-outside, autofocus, toast auto-dismiss.
- Use `<svelte:boundary>` with `pending` and `failed` snippets.
- Recover from errors with `reset()`.
- Decide where to nest boundaries (granular vs. page-level).
- Wire error telemetry via `onerror`.

## Part 1: `{@attach}` replaces `use:` actions

### Why actions needed a replacement

Svelte 3/4 had `use:` actions: a function that receives a DOM node, runs side effects, and optionally returns an update or destroy function.

```svelte
<script>
	function clickOutside(node, callback) {
		function handle(e) {
			if (!node.contains(e.target)) callback();
		}
		document.addEventListener('click', handle, true);
		return {
			destroy: () => document.removeEventListener('click', handle, true)
		};
	}
</script>

<div use:clickOutside={() => console.log('clicked outside')}>...</div>
```

Actions worked. They have carried a decade of Svelte apps. But they had four limitations that became increasingly painful:

1. **You cannot spread them.** If you want to pass an action through `...props` to a wrapper component, you cannot. Actions are a special syntactic form — they are not values you can put in a regular object.
2. **They do not compose naturally.** You cannot write a function that returns an action and expect it to plug into `use:` the same way a function-that-returns-a-function does in normal JS.
3. **Reactive arguments are awkward.** `use:clickOutside={callback}` has an implicit contract: if `callback` changes, your action has to implement an `update()` method. In practice, most action code forgets this, and the bugs are subtle (stale closures over the original argument).
4. **They are not first-class values.** You cannot return an action from a helper function and use it as a prop. You cannot conditionally apply one based on state. You cannot put one in an array.

Attachments fix all of this. They are plain JavaScript functions. You can spread them. You can return them from other functions. You can pass them as props. They re-run automatically when their reactive dependencies change. They feel like hooks, but without the rules-of-hooks baggage.

### What an attachment is

An attachment is a function with signature `(element: Element) => (() => void) | void`. It runs once when the element mounts. If it returns a function, that function is the cleanup — called when the element unmounts OR when the attachment re-runs due to reactive changes.

Minimal example:

```svelte
<script>
	function logOnMount(element) {
		console.log('mounted', element.tagName);
		return () => console.log('cleanup');
	}
</script>

<div {@attach logOnMount}>...</div>
```

Done. No `use:`. No return-an-object-with-destroy. Just a function and an optional cleanup.

### Attachment factories

The common case is an attachment that takes arguments. The pattern is a factory that returns an attachment:

```svelte
<script>
	function log(message) {
		return (element) => {
			console.log(message, element.tagName);
		};
	}
</script>

<div {@attach log('div mounted')}>...</div>
```

`log('div mounted')` returns an attachment function. `{@attach}` runs it with the element. If `message` changes reactively, `log(newMessage)` is a new function, so the whole attachment re-runs — cleanup first, then the new attachment. Reactivity is free.

### Migrating click-outside

Click-outside is the canonical example. You want to know when the user clicked anywhere except inside a given element — used for dismissing dropdowns, menus, popovers.

**Before (action):**

```ts
// src/lib/actions/clickOutside.ts
export function clickOutside(node: HTMLElement, callback: () => void) {
	let onclickoutside = callback;

	function handle(e: MouseEvent) {
		if (!node.contains(e.target as Node)) onclickoutside();
	}

	document.addEventListener('click', handle, true);

	return {
		update(newCallback: () => void) {
			onclickoutside = newCallback;
		},
		destroy() {
			document.removeEventListener('click', handle, true);
		}
	};
}
```

```svelte
<script>
	import { clickOutside } from '$lib/actions/clickOutside';
	let { onclose } = $props();
</script>

<div use:clickOutside={onclose}>
	<!-- dropdown content -->
</div>
```

**After (attachment):**

```ts
// src/lib/attachments/clickOutside.ts
import type { Attachment } from 'svelte/attachments';

export function clickOutside(onclickoutside: () => void): Attachment {
	return (node) => {
		function handle(e: MouseEvent) {
			if (!(node as HTMLElement).contains(e.target as Node)) {
				onclickoutside();
			}
		}

		document.addEventListener('click', handle, true);

		return () => {
			document.removeEventListener('click', handle, true);
		};
	};
}
```

```svelte
<script>
	import { clickOutside } from '$lib/attachments/clickOutside';
	let { onclose } = $props();
</script>

<div {@attach clickOutside(onclose)}>
	<!-- dropdown content -->
</div>
```

Line-by-line on the new version:

**Line 1: import the type.** `Attachment` from `svelte/attachments` is the correct type for the return value. It is `(element: Element) => (() => void) | void`.

**Line 3: factory signature.** `clickOutside(onclickoutside)` returns `Attachment`. The callback is captured in the closure.

**Lines 4–11: the attachment itself.** Receives the node (implicitly typed as `Element`; we assert `HTMLElement` for `.contains`), sets up the listener, returns a cleanup function. Notice there is no separate `update()` method — if `onclickoutside` changes, the caller's `clickOutside(onclickoutside)` expression evaluates to a new function, and the whole attachment tears down and rebuilds. If you do not want that (because your listener is expensive to set up), the docs show a pattern using `$effect` inside the attachment — see the gotchas section below.

**Usage:** `{@attach clickOutside(onclose)}` replaces `use:clickOutside={onclose}`. Reads slightly differently but does the same thing with one fewer special form.

### Migrating autofocus

Autofocus — focus the input when the element mounts. Common on modal open, form field focus after error, etc.

**Before (action):**

```ts
export function autofocus(node: HTMLElement) {
	requestAnimationFrame(() => node.focus());
}
```

```svelte
<input use:autofocus />
```

**After (attachment):**

```ts
// src/lib/attachments/autofocus.ts
import type { Attachment } from 'svelte/attachments';

export const autofocus: Attachment = (node) => {
	requestAnimationFrame(() => (node as HTMLElement).focus());
};
```

```svelte
<script>
	import { autofocus } from '$lib/attachments/autofocus';
</script>

<input {@attach autofocus} />
```

Trivial. `Attachment` here is the attachment directly (no factory needed) because there are no parameters. Notice you can use `const` for parameter-less attachments — the `Attachment` type annotation is enough.

### Migrating toast auto-dismiss

Toast notifications that auto-dismiss after a timeout are another common case.

**Before (action):**

```ts
export function autoDismiss(node: HTMLElement, ms: number) {
	let timer = setTimeout(() => node.remove(), ms);
	return {
		update(newMs: number) {
			clearTimeout(timer);
			timer = setTimeout(() => node.remove(), newMs);
		},
		destroy() {
			clearTimeout(timer);
		}
	};
}
```

**After (attachment):**

```ts
// src/lib/attachments/autoDismiss.ts
import type { Attachment } from 'svelte/attachments';

export function autoDismiss(ms: number, onDismiss: () => void): Attachment {
	return () => {
		const timer = setTimeout(onDismiss, ms);
		return () => clearTimeout(timer);
	};
}
```

```svelte
<script>
	import { autoDismiss } from '$lib/attachments/autoDismiss';
	let { onclose } = $props();
</script>

<div class="toast" {@attach autoDismiss(3000, onclose)}>Your contact was saved.</div>
```

Two improvements over the action version:

1. We no longer reach into the DOM to call `node.remove()`. Instead the attachment calls a callback, and the parent decides what to remove. This is better separation of concerns — the attachment has one job (fire a callback after a delay), not two (fire a callback and mutate the DOM).
2. Reactivity is implicit: if `ms` or `onDismiss` changes, Svelte tears down and rebuilds. No `update()` method.

### Composing attachments via props

Here is where attachments shine beyond what actions could do. You can pass them through props.

```svelte
<!-- Button.svelte -->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let { children, ...props }: HTMLButtonAttributes & { children: import('svelte').Snippet } =
		$props();
</script>

<button {...props}>
	{@render children()}
</button>
```

```svelte
<!-- App.svelte -->
<script>
	import Button from './Button.svelte';
	import { tooltip } from '$lib/attachments/tooltip';
</script>

<Button {@attach tooltip('Click me!')}>Submit</Button>
```

What happens:

- `{@attach tooltip('Click me!')}` on a component creates a prop keyed by a `Symbol`.
- `...props` in `Button.svelte` spreads everything — including attachment props.
- When those are spread onto the `<button>`, Svelte runs them against the `<button>` element.

This is impossible with `use:` actions. The pattern unlocks attachment-as-prop composability: you can write a library of behaviors that work on any element, and let consumers attach them to any wrapper component.

### Conditional attachments

Falsy values are no-ops:

```svelte
<div {@attach enabled && tooltip('help text')}>...</div>
```

If `enabled` is `false`, nothing attaches. If `enabled` is `true`, the tooltip attaches. When `enabled` toggles, the attachment comes and goes automatically.

This is cleaner than the action equivalent, which required you to put an `{#if}` around the element or check `enabled` inside the action's update function.

### Gotcha: re-running vs. persisting

`{@attach tooltip(content)}` re-runs whenever `content` changes. If your attachment does expensive setup (creates a worker, instantiates a heavy third-party library), you do not want to re-create that worker every time a text label changes.

The docs pattern: take a _getter function_ and read it inside an inner `$effect`.

```ts
// src/lib/attachments/expensive.ts
import type { Attachment } from 'svelte/attachments';

export function expensive(getConfig: () => Config): Attachment {
	return (node) => {
		const instance = createExpensiveThing(node);

		$effect(() => {
			instance.update(getConfig());
		});

		return () => instance.destroy();
	};
}
```

```svelte
<div {@attach expensive(() => config)}>...</div>
```

- The outer attachment function runs once, creating the instance.
- The inner `$effect` reads `getConfig()` and updates the instance whenever any reactive dependency inside `config` changes.
- Cleanup tears down the instance.

Pass the _getter_, not the value, when you want to avoid re-running the outer setup.

### Attachments vs. actions — migration strategy

Do not rip out all actions tomorrow. Actions still work. The right migration plan:

1. **New code uses attachments.** Anything new you write, reach for `{@attach}` first.
2. **Migrate actions when you touch the file.** If you are already editing `clickOutside`, port it to an attachment while you are in there.
3. **Migrate when you hit the spread-or-compose limitation.** If you need to pass an action through props, that is the moment to port it.
4. **Mass-migrate is not worth it.** Unless you are doing a big refactor, leave legacy actions alone.

For libraries — especially ones you author — prefer attachments. They give consumers more flexibility.

## Part 2: `<svelte:boundary>` for error + async handling

### Why boundaries exist

Svelte 5 introduced `await` in markup. You can write:

```svelte
{#each await getContacts() as contact (contact.id)}
	<li>{contact.first_name}</li>
{/each}
```

This is beautiful, but it raises two immediate questions:

1. **What renders while the `await` is resolving?** There is no DOM to show during a 200ms fetch.
2. **What happens if `getContacts()` throws?** The error has to go somewhere.

Before boundaries, you handled both manually: `{#await promise}{:then data}{:catch error}{/await}` blocks. They work, but they are verbose and do not compose — each `{#await}` is independent.

`<svelte:boundary>` is a scoped wrapper: anything inside it shares one pending state and one error handler. Like React's Error Boundary plus Suspense rolled into one.

### Anatomy of a boundary

```svelte
<svelte:boundary onerror={(err, reset) => console.error(err)}>
	{#snippet pending()}
		<p>Loading...</p>
	{/snippet}

	{#snippet failed(err, reset)}
		<div class="error">
			Something went wrong: {err.message}
			<button onclick={reset}>Try again</button>
		</div>
	{/snippet}

	<ContactList />
</svelte:boundary>
```

Four pieces:

- **Children** (`<ContactList />`) — the normal content the boundary wraps.
- **`pending` snippet** — shown while any `await` inside the boundary is resolving _for the first time_. Required if children use top-level await.
- **`failed` snippet** — shown if any child throws during render. Receives the error and a `reset()` callback.
- **`onerror` handler** — side effect, runs when an error is caught. Useful for telemetry.

You can provide `pending` without `failed`, or `failed` without `pending`, or both, or just `onerror`. All combinations are valid.

### Using boundaries with remote functions

The Remote Functions lesson already showed this pattern; let's look at it more carefully:

```svelte
<script>
	import { getContacts } from './contacts.remote';
</script>

<svelte:boundary>
	{#snippet pending()}
		<div class="skeleton">
			<div class="skeleton-row"></div>
			<div class="skeleton-row"></div>
			<div class="skeleton-row"></div>
		</div>
	{/snippet}

	{#snippet failed(err, reset)}
		<div class="error-panel">
			<h3>We couldn't load your contacts.</h3>
			<p>{err.message}</p>
			<button onclick={reset}>Retry</button>
		</div>
	{/snippet}

	<ul>
		{#each await getContacts() as contact (contact.id)}
			<li>{contact.first_name} {contact.last_name}</li>
		{/each}
	</ul>
</svelte:boundary>
```

What the boundary does:

- **First render:** `getContacts()` returns a promise. Svelte sees an unresolved `await` inside this boundary, renders the `pending` snippet, subscribes to the promise.
- **Promise resolves:** `pending` unmounts. The `<ul>` renders with the data.
- **Promise rejects:** `failed` snippet mounts with the error. `onerror` fires (not shown here). User clicks "Retry" → `reset()` → the boundary's children tear down and re-render, which re-creates the query and re-issues the request.

Subsequent refreshes (e.g., after a `refresh()` call post-mutation) do **not** re-show the `pending` snippet. The UI shows the stale data, and then updates to the new data. If you want per-update spinners, use `$effect.pending()` inside the component that owns the query.

### The `reset()` dance

`reset()` is a function Svelte passes to your `failed` snippet and `onerror`. Calling it tells Svelte: "tear down the children, re-render them from scratch."

This is useful, but it has gotchas:

- **State inside the boundary is wiped.** Any `$state()` rune inside a child component resets to its initial value. If your "Try again" button is in the failed snippet, the children remount fresh, which is exactly what you want for transient network failures. If the failure was due to bad input state that would still be bad, you need a different strategy (a full page reload, or route-level error handling).
- **Reset is component-level, not query-level.** Specifically for remote queries, `reset()` re-runs the `<svelte:boundary>` children, which re-calls `getContacts()`, which (because it is a cached query) may return the same failed promise if the server is still down. The query layer has its own retry semantics. Combining them is nuanced — usually `reset()` is fine because the query infrastructure re-issues the request on re-evaluation.

### `onerror` for telemetry

The `onerror` handler is where you wire error reporting.

```svelte
<script lang="ts">
	import * as Sentry from '@sentry/svelte';

	function reportError(err: unknown, reset: () => void) {
		Sentry.captureException(err, {
			tags: { source: 'component-boundary' }
		});
	}
</script>

<svelte:boundary onerror={reportError}>
	{#snippet failed(err, reset)}
		<p>Sorry, this bit is broken.</p>
	{/snippet}

	<FlakyChart />
</svelte:boundary>
```

- `reportError` is called with `(error, reset)`. You log, you tag, you forward to your APM.
- The `failed` snippet handles the UI.
- These are two separate concerns, expressed cleanly. No try/catch scattered in components.

### What boundaries catch, what they don't

**Caught:**

- Errors thrown during rendering (template expressions, `$derived` computations, component initialization).
- Errors from `await` expressions in markup.
- Errors thrown inside `$effect`.
- Errors thrown inside child components' rendering logic.

**Not caught:**

- Errors in event handlers (`onclick`, `oninput`, etc.). These go to the nearest `window.error` handler or SvelteKit's `handleClientError` hook.
- Errors from `setTimeout` callbacks, `Promise.then`, `requestAnimationFrame`, or anything that runs outside the render tree.
- Server-side rendering errors (by default). As of Svelte 5.51 you can configure `transformError` on the server renderer — SvelteKit will surface this via `handleError` in a future version.

The rule of thumb: if the error happens while Svelte is _rendering_, the boundary catches it. If it happens in response to a user event or a background task, it does not.

### Granular vs. page-level boundaries

You can nest boundaries. When an error bubbles up, the _nearest_ boundary catches it. This lets you scope errors to the smallest reasonable unit.

**Bad pattern: one giant boundary:**

```svelte
<svelte:boundary>
	{#snippet failed(err, reset)}
		<p>Oh no, everything broke. <button onclick={reset}>Reload page</button></p>
	{/snippet}

	<Header />
	<Sidebar />
	<MainContent>
		<ContactList />
		<RecentActivity />
		<ChartOfEverything />
	</MainContent>
	<Footer />
</svelte:boundary>
```

If the chart fails, the header, sidebar, main content, and footer all disappear behind the error UI. The user loses their navigation, their sidebar state, everything. They have to reset, which tears it all down.

**Better pattern: scoped boundaries:**

```svelte
<Header />
<Sidebar />

<MainContent>
	<svelte:boundary>
		{#snippet failed(err, reset)}
			<div class="card-error">
				<p>Contact list unavailable.</p>
				<button onclick={reset}>Retry</button>
			</div>
		{/snippet}
		<ContactList />
	</svelte:boundary>

	<svelte:boundary>
		{#snippet failed(err, reset)}
			<div class="card-error">
				<p>Activity unavailable.</p>
				<button onclick={reset}>Retry</button>
			</div>
		{/snippet}
		<RecentActivity />
	</svelte:boundary>

	<svelte:boundary>
		{#snippet failed(err, reset)}
			<div class="card-error">
				<p>Chart unavailable.</p>
			</div>
		{/snippet}
		<ChartOfEverything />
	</svelte:boundary>
</MainContent>

<Footer />
```

Now if the chart fails, only the chart's card shows an error. The contact list and recent activity are unaffected. Retries are scoped. The header, sidebar, footer are always there.

### Using boundaries for graceful loading

You do not have to use boundaries for errors. You can use them just for the pending snippet:

```svelte
<svelte:boundary>
	{#snippet pending()}
		<p>Loading contacts...</p>
	{/snippet}

	<ContactList />
</svelte:boundary>
```

No `failed` snippet means errors propagate to the next boundary up, or to SvelteKit's error page if none exists. Appropriate when you want the app-wide error page to handle failures but still want inline loading states per-section.

### Boundaries and `await` expressions

The boundary's `pending` snippet shows while `await` resolves. If you have multiple `await` expressions inside one boundary, the pending snippet stays until **all** of them resolve:

```svelte
<svelte:boundary>
	{#snippet pending()}
		<p>Loading...</p>
	{/snippet}

	<h1>{await getUserName()}</h1>
	<p>You have {await getContactCount()} contacts.</p>
	<p>{await getRecentActivity()} activities this week.</p>
</svelte:boundary>
```

The pending snippet shows until all three promises resolve. If you want per-piece pending states, nest boundaries:

```svelte
<svelte:boundary>
	{#snippet pending()}<p>Loading name...</p>{/snippet}
	<h1>{await getUserName()}</h1>
</svelte:boundary>

<svelte:boundary>
	{#snippet pending()}<p>Loading count...</p>{/snippet}
	<p>You have {await getContactCount()} contacts.</p>
</svelte:boundary>

<svelte:boundary>
	{#snippet pending()}<p>Loading activity...</p>{/snippet}
	<p>{await getRecentActivity()} activities this week.</p>
</svelte:boundary>
```

Each boundary owns its own pending state. The three sections stream in independently as their data arrives. This is the waterfall-avoiding pattern — no single slow query blocks the whole page.

## Principal Engineer Notes

**Attachments are the future. Actions are the past.** The Svelte core team has said explicitly that attachments are the preferred primitive going forward. New documentation leads with attachments. When a feature needs to choose between "add method to actions" and "work better with attachments," the team chooses attachments. Write new code with them.

**Nest boundaries by UI unit, not by component boundary.** A card on a dashboard is a UI unit. Wrap it in a boundary. The sidebar is a UI unit. Wrap it in a boundary. Do not wrap every single component — you will end up with an error-UI explosion.

**`onerror` is your telemetry hook.** Wire it to Sentry, PostHog, Honeycomb, or whatever. Do not use `window.onerror` for Svelte render errors — they are caught by boundaries and never bubble up to `window`.

**Boundaries do NOT catch event handler errors.** If `onclick={() => explode()}` throws, that goes to SvelteKit's client error hook, not to any boundary. For event handler errors, wrap the logic in try/catch and surface errors via component state (e.g., a local `$state('')` error message) or toast notifications.

**The `pending` snippet is per-boundary, not per-navigation.** If you navigate away and come back, the boundary is a fresh instance — pending shows again. If you do a remote query refresh, pending does NOT re-show — the stale data stays until the new data arrives. This is the right default for avoiding "layout thrash" during mutations. If you want a mutation spinner, add `$effect.pending()` or a local loading state.

**Combine `<svelte:boundary>` with `preloadData`.** If you preload data before pushing to a shallow route, the modal component renders instantly (no boundary needed for initial data). If you then trigger async work inside the modal, wrap that part in a boundary. Shallow route + preload + modal = instant perceived performance.

**`Attachment` is typed.** Always import `import type { Attachment } from 'svelte/attachments'` and annotate your attachment factories. You get autocomplete, and downstream consumers can verify their usage at compile time.

**Verification steps:**

1. **Attachment:** add `{@attach clickOutside(onclose)}` to a dropdown. Open dropdown, click outside. Dropdown closes. Open console — no warnings about "action used as attachment" or vice versa.
2. **Attachment re-run:** add `{@attach log(count)}` where `count` is `$state(0)`. Increment count. Console shows "mounted" / "cleanup" cycle each time.
3. **Boundary pending:** add a remote query inside a boundary. Reload page. See the `pending` snippet render for ~200ms, then the data.
4. **Boundary failed:** force an error (throw in a remote handler). See the `failed` snippet render. Click `reset` — `pending` shows again while the query re-fires.
5. **Nested boundaries:** break one card's query. Verify other cards still render. Verify `failed` UI is scoped to the broken card.
6. **`onerror` telemetry:** temporarily add `onerror={(e) => console.log('caught', e)}`. Trigger an error. Confirm it logs.
7. **Event handler error:** add `onclick={() => { throw new Error('boom') }}`. Click. Confirm the boundary does NOT catch it (it should log to the console as an uncaught error, or hit SvelteKit's `handleClientError`).

## What's next

Attachments clean up your side-effect code. Boundaries make async UI bulletproof. With those in your toolkit, you have the ergonomics of a 2026 SvelteKit app dialed in.

The final bonus closes the loop on production-readiness: **observability**. When something is slow in prod, how do you find out what is slow and why? OpenTelemetry tracing, baked into SvelteKit, is the answer.

Continue to `bonus-10: Observability — trace every request`.
