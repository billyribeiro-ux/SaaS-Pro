import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Poll `/_app/version.json` once a minute. When the deployed version
		// changes underneath an open tab, the client's `updated` store flips
		// `current` to `true` and our `beforeNavigate` hook in the root layout
		// does a full page reload on the next navigation. Without this, the
		// tab keeps trying to fetch immutable JS/CSS hashes from a previous
		// deploy that the new build has overwritten — which is exactly the
		// `_app/immutable/...` 404 storm we want to make impossible.
		version: {
			pollInterval: 60_000
		},
		alias: {
			$components: 'src/lib/components',
			$server: 'src/lib/server',
			$types: 'src/lib/types',
			$config: 'src/lib/config',
			$utils: 'src/lib/utils',
			$content: 'src/content'
		}
	}
};

export default config;
