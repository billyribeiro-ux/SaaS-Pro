---
title: 'Bonus: Dark Mode Done Right'
module: 14
lesson: 6
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-06-dark-mode'
description: 'Ship a flicker-free dark mode using CSS custom properties, prefers-color-scheme, an inline pre-hydration script, and semantic Tailwind tokens.'
duration: 22
preview: false
---

# Bonus: Dark mode done right

Dark mode is one of those features that users notice when it is bad and do not notice when it is good. A proper dark mode is not just "invert the colors" — it requires thought about contrast, elevation, semantic color tokens, and the awkward moment between page load and JS hydration where a wrongly-themed page flashes onto screen.

In this lesson we build dark mode the right way. No flash. Respects OS preference by default. User can override. Preference persists across reloads. Works with SSR. Fully Tailwind v4.

## Three design options

Before we write code, pick a model. There are three common approaches:

**1. OS preference only.** Use `prefers-color-scheme` via a CSS media query. Zero JS. Zero state. Zero persistence. If the user's OS is dark, your site is dark. If the OS is light, your site is light. User cannot override. Fine for marketing sites, annoying for apps.

**2. User toggle only.** A button flips between light and dark. Ignores OS. Persisted via localStorage. Fine, but annoying for users who have their OS in dark mode and expect the site to start dark — they have to flip the toggle every new browser.

**3. Both (system + override).** Respect OS by default. Let users override with a toggle. Persist the override. The toggle has three states: Light, Dark, System. This is what macOS, iOS, VS Code, and every serious app do. **This is what we will build.**

## What Tailwind v4 gives us

Tailwind v4 changed how dark mode variants work. In v3 you wrote `tailwind.config.js` with `darkMode: 'class'`. In v4 there is no JS config by default — you configure Tailwind from CSS using the `@variant` directive.

For our three-state toggle to work, we need Tailwind's `dark:` variant to fire when the `<html>` element has a `.dark` class (not just when the OS prefers dark). That way JS can add/remove the class based on user choice OR OS state, and Tailwind honors our class.

## Step 1: Configure the dark variant and semantic tokens

### `src/app.css`

```css
@import 'tailwindcss';

/* ------------------------------------------------------------------
 * Dark mode strategy
 *
 * `dark:` variant is active when an ancestor has the .dark class
 * (or when the element itself has it). We apply .dark on <html>
 * via JS, based on user preference + OS fallback.
 * ------------------------------------------------------------------ */
@variant dark (&:where(.dark, .dark *));

/* ------------------------------------------------------------------
 * Design tokens
 *
 * Every color used in the app goes through a semantic token. Never
 * write `bg-white dark:bg-gray-900` in component markup — instead,
 * write `bg-background`, and define what "background" means here in
 * each mode. This keeps the app coherent and lets us re-theme later
 * by editing one file.
 * ------------------------------------------------------------------ */
@theme {
	/* Brand */
	--color-brand: oklch(56% 0.2 260);
	--color-brand-hover: oklch(50% 0.2 260);

	/* Neutral surfaces — LIGHT mode defaults */
	--color-background: oklch(100% 0 0); /* white */
	--color-surface: oklch(98% 0 0); /* off-white cards/sidebars */
	--color-surface-raised: oklch(100% 0 0); /* modal, popover */
	--color-border: oklch(92% 0 0); /* subtle lines */
	--color-border-strong: oklch(85% 0 0); /* input borders */

	/* Text */
	--color-text: oklch(20% 0 0); /* near-black body */
	--color-text-muted: oklch(45% 0 0); /* secondary text */
	--color-text-subtle: oklch(60% 0 0); /* placeholders, labels */
	--color-text-inverse: oklch(98% 0 0); /* on-brand buttons */

	/* Status */
	--color-success: oklch(65% 0.17 145);
	--color-danger: oklch(60% 0.22 25);
	--color-warning: oklch(75% 0.15 80);
}

/* ------------------------------------------------------------------
 * Dark mode overrides
 *
 * Only override the tokens that differ. Brand and status colors are
 * usually stable across modes; neutrals must flip.
 * ------------------------------------------------------------------ */
.dark {
	--color-background: oklch(18% 0 0);
	--color-surface: oklch(22% 0 0);
	--color-surface-raised: oklch(26% 0 0);
	--color-border: oklch(30% 0 0);
	--color-border-strong: oklch(38% 0 0);

	--color-text: oklch(95% 0 0);
	--color-text-muted: oklch(70% 0 0);
	--color-text-subtle: oklch(55% 0 0);
	--color-text-inverse: oklch(18% 0 0);

	--color-success: oklch(72% 0.17 145);
	--color-danger: oklch(68% 0.22 25);
	--color-warning: oklch(80% 0.15 80);
}

/* ------------------------------------------------------------------
 * Base styles
 * ------------------------------------------------------------------ */
html {
	background: var(--color-background);
	color: var(--color-text);
	color-scheme: light;
}

.dark html,
html.dark {
	color-scheme: dark;
}

body {
	@apply antialiased;
}

/* Smooth theme transitions — but only for explicitly toggled color
 * changes. Disable transitions during initial load so no flash. */
.theme-transition,
.theme-transition * {
	transition:
		background-color 200ms ease,
		color 200ms ease,
		border-color 200ms ease;
}
```

Let us unpack this.

**`@import 'tailwindcss';`** — Tailwind v4's new single-line import. Replaces the three `@tailwind` directives from v3.

**`@variant dark (&:where(.dark, .dark *));`** — defines the `dark:` variant. Tailwind v4's `@variant` takes a CSS selector and says "when a class like `dark:bg-foo` is used, emit the rule behind this selector." The selector is `&:where(.dark, .dark *)` — meaning "the element itself if it has `.dark`, or any descendant of a `.dark` element." Why `:where`? It keeps specificity at zero so `.dark` overrides do not mysteriously beat utility classes in unexpected ways.

**`@theme { ... }`** — Tailwind v4's way to declare design tokens. Any `--color-foo` inside `@theme` becomes a utility class: `bg-foo`, `text-foo`, `border-foo`, etc. So by declaring `--color-background`, we make `bg-background` available everywhere.

**OKLCH color syntax** — a modern color format that is perceptually uniform. `oklch(L% C H)` is Lightness, Chroma, Hue. The advantage: a lightness of 50% looks the same brightness across all hues, so colors in your palette feel balanced. Tailwind v4 defaults to OKLCH-based palettes for this reason.

**Semantic tokens, not literal tokens.** This is the key move. We write `bg-background` in components. We never write `bg-white dark:bg-gray-900`. The meaning ("background") is stable across modes; only the concrete color changes. When a designer says "actually let's warm up the backgrounds 10%," you change three variables in one file, not a thousand utility classes in components.

**`color-scheme`** — a CSS property that tells the browser to use native dark form controls, scrollbars, selection colors, etc. Without it, a dark-themed app will have a white scrollbar and a white autofill on inputs. With it, those native UI bits match.

**`.theme-transition`** — we will apply this class to `<html>` _after_ the initial load to enable smooth transitions when the user toggles. During initial load we do not want transitions (otherwise the initial color application animates on every page load, which looks weird). We will toggle this class from JS.

## Step 2: The no-flash script

This is the most important part. It goes in `src/app.html`, in the `<head>`, _before_ the SvelteKit stylesheet and _before_ any JS. It runs synchronously, blocking the first paint. This is the one place "blocking the main thread" is correct — we must have the theme applied before anything is rendered, or there will be a visible flash.

### `src/app.html`

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" href="%sveltekit.assets%/favicon.png" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="theme-color" content="#ffffff" id="theme-color-meta" />

		<!--
      Flash-of-wrong-theme prevention.

      Runs before any style or component renders. Reads the saved
      preference (or defaults to 'system'), resolves it against the
      OS, and applies the .dark class on <html> before the browser
      paints anything.

      Note: inline scripts like this bypass SvelteKit's hydration —
      that is deliberate. CSP nonces are supported if needed.
    -->
		<script>
			(function () {
				try {
					var saved = localStorage.getItem('theme');
					var theme = saved === 'light' || saved === 'dark' ? saved : 'system';
					var resolved =
						theme === 'system'
							? window.matchMedia('(prefers-color-scheme: dark)').matches
								? 'dark'
								: 'light'
							: theme;
					if (resolved === 'dark') document.documentElement.classList.add('dark');
					// Update the theme-color meta so mobile status bar matches.
					var meta = document.getElementById('theme-color-meta');
					if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0a0a' : '#ffffff');
				} catch (e) {
					/* localStorage unavailable (private mode in old browsers); fail silent */
				}
			})();
		</script>

		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

Critical details:

- **Inline, synchronous.** Not loaded via `<script src>`. Not `defer`. We want it to execute before the browser paints anything. Yes, this blocks first paint for a few milliseconds. The alternative — painting white first and then swapping to dark — is much worse.
- **`try/catch`** around `localStorage`. In some privacy-restricted contexts (incognito with strict settings), accessing localStorage throws. We swallow.
- **`theme-color` meta** — on iOS Safari (and Android Chrome), this sets the color of the status bar / address bar area. Updating it on theme change matches the system chrome to the app.
- **`document.documentElement.classList.add('dark')`** — sets the class on `<html>`. Tailwind's dark variant picks this up.

**This script is the entire reason the page does not flash.** Skip it, and for 100-300ms during page load the user sees a white page before Svelte hydrates and applies dark mode. It is jarring. Never skip.

## Step 3: The theme store (Svelte 5 class-based rune store)

We will build a state class that:

- Tracks the user's selected theme (`light | dark | system`).
- Tracks the OS preference so we know what `system` resolves to right now.
- Exposes the "resolved" theme (the one actually applied).
- Persists changes to localStorage.
- Listens for OS changes and updates if the user is on `system`.

### `src/lib/stores/theme.svelte.ts`

```ts
import { browser } from '$app/environment';

type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function readInitial(): Theme {
	if (!browser) return 'system';
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'light' || saved === 'dark') return saved;
	} catch {}
	return 'system';
}

function readSystem(): Resolved {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

class ThemeStore {
	// User preference: what they selected in the toggle.
	preference = $state<Theme>(readInitial());

	// OS preference: updates when the user changes their OS setting.
	system = $state<Resolved>(readSystem());

	// The theme actually applied to <html>.
	resolved = $derived<Resolved>(this.preference === 'system' ? this.system : this.preference);

	constructor() {
		if (!browser) return;

		// Listen for OS changes so users on `system` track them live.
		const mql = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = (e: MediaQueryListEvent) => {
			this.system = e.matches ? 'dark' : 'light';
		};
		mql.addEventListener('change', handler);

		// Every time resolved changes, apply it.
		$effect.root(() => {
			$effect(() => {
				const r = this.resolved;
				document.documentElement.classList.toggle('dark', r === 'dark');
				const meta = document.getElementById('theme-color-meta');
				if (meta) meta.setAttribute('content', r === 'dark' ? '#0a0a0a' : '#ffffff');
			});
		});

		// Enable smooth transitions after the first paint so toggling animates
		// but initial load does not.
		requestAnimationFrame(() => {
			document.documentElement.classList.add('theme-transition');
		});
	}

	set(value: Theme) {
		this.preference = value;
		try {
			if (value === 'system') localStorage.removeItem(STORAGE_KEY);
			else localStorage.setItem(STORAGE_KEY, value);
		} catch {}
	}
}

export const theme = new ThemeStore();
```

Why a class instead of top-level `$state`?

- Svelte 5 runes work inside classes, and class instances are a clean way to encapsulate related state + methods (the `set` function, the listeners). This is the idiomatic pattern for stores with behavior, not just data.
- Exporting a singleton (`export const theme = new ThemeStore()`) means every import references the same instance — same semantics as a Svelte 4 store, but using runes.

Line-by-line notes:

**`browser`** — SvelteKit's flag for "are we on the client?" We gate DOM-touching logic on this.

**`readInitial`** — run once when the class is constructed. On the server this returns `'system'` (a safe default); on the client it reads from localStorage. Note that our no-flash script already applied the correct class by the time Svelte hydrates, so reading initial state from localStorage here is just for the toggle UI — by the time we read it, the visual state already matches.

**`$derived(preference === 'system' ? system : preference)`** — the actual applied theme. Automatically recomputes when either `preference` or `system` changes.

**`$effect.root(() => { $effect(...) })`** — we are inside a class constructor, which is NOT a reactive component context. Plain `$effect()` would complain that it has no owner. `$effect.root` creates an effect root that lives for the lifetime of the object (basically forever, since it is a singleton). Inside that root, we create a normal `$effect` that reacts to `this.resolved` changing.

**Applying the class** — `document.documentElement.classList.toggle('dark', r === 'dark')` adds `.dark` if resolved is dark, removes otherwise. Tailwind's variant picks this up and re-skins everything instantly.

**`requestAnimationFrame` to enable transitions** — we wait for the first frame, then add `.theme-transition`. This way the initial load has no transitions (no animation from white to dark), but user toggles do animate.

**`set(value)`** — the setter for user toggles. Removes localStorage when going back to `system` — that way a fresh visit starts with `system` again, consistent with "I did not customize".

## Step 4: The toggle component

A three-state segmented control: Light, System, Dark.

### `src/lib/components/ThemeToggle.svelte`

```svelte
<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';

	const options = [
		{ value: 'light', label: 'Light' },
		{ value: 'system', label: 'System' },
		{ value: 'dark', label: 'Dark' }
	] as const;
</script>

<div
	class="border-border bg-surface inline-flex items-center gap-0 rounded-full border p-0.5 text-xs"
	role="group"
	aria-label="Theme"
>
	{#each options as opt}
		<button
			type="button"
			onclick={() => theme.set(opt.value)}
			aria-pressed={theme.preference === opt.value}
			class="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition"
			class:bg-background={theme.preference === opt.value}
			class:text-text={theme.preference === opt.value}
			class:shadow-sm={theme.preference === opt.value}
			class:text-text-muted={theme.preference !== opt.value}
		>
			{#if opt.value === 'light'}
				<svg
					class="h-3.5 w-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="4" />
					<path
						d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
						stroke-linecap="round"
					/>
				</svg>
			{:else if opt.value === 'system'}
				<svg
					class="h-3.5 w-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<rect x="3" y="4" width="18" height="12" rx="2" />
					<path d="M8 20h8M12 16v4" stroke-linecap="round" />
				</svg>
			{:else}
				<svg
					class="h-3.5 w-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path
						d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{/if}
			{opt.label}
		</button>
	{/each}
</div>
```

Notes:

- **`role="group"` + `aria-label`** — screen readers announce this as a related set of buttons.
- **`aria-pressed`** — marks the currently-selected option as the pressed state in the group.
- **Icons** — inline SVG is cheap, themeable via `currentColor`, and does not require loading an icon library. The sun/monitor/moon metaphor is universal.
- **`bg-background` / `text-text`** — our semantic tokens. Never `bg-white dark:bg-gray-900`.

Place it in your app header or settings page:

```svelte
<script>
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
</script>

<header class="border-border bg-surface flex items-center justify-between border-b px-6 py-3">
	<a href="/app" class="text-text font-semibold">Contactly</a>
	<ThemeToggle />
</header>
```

## Step 5: Refactor existing components to use semantic tokens

This is the grind. Anywhere you have:

```svelte
<div class="bg-white text-gray-900 border-gray-200">
```

Change to:

```svelte
<div class="bg-background text-text border-border">
```

Some common replacements:

| Before            | After                  |
| ----------------- | ---------------------- |
| `bg-white`        | `bg-background`        |
| `bg-gray-50`      | `bg-surface`           |
| `bg-gray-100`     | `bg-surface-raised`    |
| `text-gray-900`   | `text-text`            |
| `text-gray-700`   | `text-text-muted`      |
| `text-gray-400`   | `text-text-subtle`     |
| `border-gray-200` | `border-border`        |
| `border-gray-300` | `border-border-strong` |

Keep brand colors (`bg-brand`, `text-brand`) the same across modes unless you specifically want to shift the brand for dark mode (some brands do this — a bright blue at 500 looks garish on a dark background, so they shift to 400).

Status colors (success/danger/warning) generally look better slightly lighter in dark mode — hence the small adjustments in the `.dark` override.

## Step 6: Test

1. Open the site in light mode (OS or selected). Reload several times. Confirm no flash of dark, no flash of white.
2. Click the dark toggle. Everything transitions smoothly.
3. Reload the page with dark selected. Confirm no flash of light.
4. Switch to "System". Change your OS preference while the tab is open. The site should update live (the `matchMedia` listener catches it).
5. Open devtools → Application → Local Storage. See the `theme` key set to `light` or `dark` when you override. See it removed when you go back to System.
6. Try in incognito. Confirm `localStorage` still works (modern browsers allow within-session only).
7. Test on mobile. The status bar color updates via `theme-color` meta.
8. Test accessibility: Tab to the toggle, Enter to activate. Screen reader announces "Theme group. Light, button, pressed. System, button. Dark, button."

## What senior engineers think about

**1. Never hardcode dark overrides in markup.** If you find yourself writing `dark:bg-gray-900` in a component, you are fighting the system. Add a semantic token instead. Your future self, redesigning in six months, will thank you.

**2. Contrast ratios.** WCAG AA requires 4.5:1 for body text, 3:1 for large text. Test with <https://webaim.org/resources/contrastchecker/>. The dark-mode palette above is designed to meet AA; do not lower the lightness of `--color-text` without re-checking.

**3. Images and videos.** Raster images do not adapt. If your logo is dark-on-white, it will look bad on dark. Options: SVG with `currentColor`, provide a dark variant with `<picture><source media="(prefers-color-scheme: dark)">`, or a JS swap based on `theme.resolved`.

**4. Focus rings.** Default focus rings (blue) often disappear on dark mode. Add `focus-visible:ring-2 focus-visible:ring-brand` consistently, or override Tailwind's default focus color via a token.

**5. Shadows.** Shadows are less visible in dark mode. Reduce `shadow` use in dark; substitute a subtle border instead. You can encode this: define `--shadow-sm` in both modes, with dark using a smaller-and-lighter shadow.

**6. Browser controls.** `color-scheme` property (we set it above) fixes scrollbars and form autofill. Without it, a dark page has Windows/macOS-themed white scrollbars pasted on top. Always set.

**7. Multiple tabs.** If the user changes the theme in tab A, tab B does not automatically update (no Realtime for localStorage). If you care, listen to the `storage` event on `window` and sync. For most apps it is fine to not bother.

**8. SSR consistency.** With SSR, the server renders without knowing the user's theme (we do not send it as a cookie). The no-flash script handles the client-side fix. If you want perfect server-rendered HTML to match, store the preference in a cookie (in addition to localStorage) and read it in a hook. That is overkill for most apps.

**9. Print styles.** Users print in light. `@media print { html { color-scheme: light; } }` and ensure print layouts use light colors regardless of current theme.

## What you built

A complete, production-grade theming system. Semantic tokens. Three-state toggle. OS-aware default. Flash-free load. Smooth transitions. Accessible. Persists. It is the kind of thing you might take a full sprint to build on a real product — and you just did it in an hour.

Contactly is now a serious piece of SaaS. It has OAuth, avatars, CSV import/export, full-text search, real-time sync, and a proper dark mode on top of everything you shipped in the main course. You have walked the path from zero-lines-of-code to something you could legitimately put in front of paying customers. Well done.
