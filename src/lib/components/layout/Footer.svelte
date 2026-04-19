<script lang="ts">
	import { SITE } from '$config/site.config';

	const year = new Date().getFullYear();
</script>

<footer class="border-t border-slate-200 bg-white/50 dark:border-slate-800 dark:bg-slate-950/50">
	<div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 text-sm text-slate-600 md:flex-row dark:text-slate-400">
		<p>&copy; {year} {SITE.name}. All rights reserved.</p>
		<nav class="flex gap-4">
			<a href="/pricing" class="hover:underline">Pricing</a>
			<a href="/learn" class="hover:underline">Course</a>
			<a href="/account" class="hover:underline">Account</a>
		</nav>
	</div>
</footer>
