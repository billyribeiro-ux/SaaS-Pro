import { browser } from '$app/environment';

/*
 * Theme store. Tri-state user preference (light | dark | system) with a separate
 * `resolved` field that is always concrete (light | dark) — components and the
 * theme-color meta should bind to `resolved`, not `theme`.
 *
 * Initial application happens synchronously in app.html via an inline script so
 * there is no flash of wrong theme on first paint. This store takes over once
 * the client hydrates; it reads back the current preference from localStorage,
 * keeps the OS media-query listener alive while in "system" mode, and writes
 * future changes back to storage + the DOM.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DARK_MQ = '(prefers-color-scheme: dark)';

// Keep these in sync with the meta tags in app.html so tab UI matches the page.
const THEME_COLOR_LIGHT = '#ffffff';
const THEME_COLOR_DARK = '#020617';

function readStoredTheme(): Theme {
	if (!browser) return 'system';
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === 'light' || v === 'dark' || v === 'system') return v;
	} catch {
		// Storage may be unavailable (private mode, embedded WebView). Fall through.
	}
	return 'system';
}

function readSystemTheme(): ResolvedTheme {
	if (!browser) return 'light';
	return window.matchMedia(DARK_MQ).matches ? 'dark' : 'light';
}

function applyToDom(resolved: ResolvedTheme) {
	if (!browser) return;
	const root = document.documentElement;
	root.classList.toggle('dark', resolved === 'dark');
	root.style.colorScheme = resolved;

	// Single dynamic meta tag — see app.html for why we collapse the two media-
	// query metas down to one when the user has overridden the OS preference.
	const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-dynamic]');
	if (meta) {
		meta.setAttribute('content', resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
	}
}

class ThemeStore {
	theme = $state<Theme>('system');
	resolved = $state<ResolvedTheme>('light');

	#cleanupMql: (() => void) | null = null;
	#initialized = false;

	/**
	 * Idempotent. Call from the root layout's onMount. Reads the persisted
	 * preference, syncs `resolved` to the current DOM state, and starts the
	 * media-query listener if (and only if) the user is in "system" mode.
	 */
	init(): void {
		if (!browser || this.#initialized) return;
		this.#initialized = true;

		this.theme = readStoredTheme();
		this.#syncListener();
		this.#recompute({ writeDom: false }); // DOM is already correct from app.html
	}

	setTheme(next: Theme): void {
		this.theme = next;

		if (browser) {
			try {
				localStorage.setItem(STORAGE_KEY, next);
			} catch {
				// Storage unavailable — preference will not persist across reloads.
			}
		}

		this.#syncListener();
		this.#recompute({ writeDom: true });
	}

	#recompute({ writeDom }: { writeDom: boolean }): void {
		const next: ResolvedTheme = this.theme === 'system' ? readSystemTheme() : this.theme;
		this.resolved = next;
		if (writeDom) applyToDom(next);
	}

	#syncListener(): void {
		if (!browser) return;
		this.#cleanupMql?.();
		this.#cleanupMql = null;

		// Only listen to the OS while the user is in "system" mode. In an
		// explicit override we never want OS changes to reach the DOM.
		if (this.theme !== 'system') return;

		const mql = window.matchMedia(DARK_MQ);
		const handler = () => this.#recompute({ writeDom: true });
		mql.addEventListener('change', handler);
		this.#cleanupMql = () => mql.removeEventListener('change', handler);
	}
}

export const themeStore = new ThemeStore();
