// Default to `auto` — SvelteKit will prerender routes it can (no per-request
// state) and fall back to SSR for dynamic ones. Routes that cannot be
// prerendered safely opt out with `export const prerender = false`.
export const prerender = 'auto';
