/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		strictPort: false
	},
	// Vitest picks up from vite.config by default. Scope it to the
	// colocated `src/**/*.test.ts` pattern so it never grabs
	// Playwright's `tests/*.spec.ts` files (those are e2e, not unit).
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		exclude: ['tests/**', 'node_modules/**', 'build/**', '.svelte-kit/**'],
		environment: 'node'
	}
});
