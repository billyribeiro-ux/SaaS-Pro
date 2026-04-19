<script lang="ts">
	import { page } from '$app/state';
	import { CURRICULUM } from '$config/curriculum.config';
	import { cn } from '$utils/cn';
	import Badge from '$components/ui/Badge.svelte';

	type Props = {
		progress: Record<string, Record<string, boolean>>;
		hasSubscription: boolean;
	};

	let { progress, hasSubscription }: Props = $props();

	let activePath = $derived(page.url.pathname);
</script>

<aside class="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
	<nav class="space-y-6">
		{#each CURRICULUM as module (module.slug)}
			<div>
				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
					{module.title}
				</h3>
				<ul class="space-y-0.5">
					{#each module.lessons as lesson (lesson.slug)}
						{@const href = `/learn/${module.slug}/${lesson.slug}`}
						{@const isActive = activePath === href}
						{@const isDone = progress[module.slug]?.[lesson.slug] === true}
						{@const isLocked = !lesson.preview && !hasSubscription}
						<li>
							<a
								{href}
								class={cn(
									'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
									isActive
										? 'bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100'
										: 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800'
								)}
							>
								<span class="flex items-center gap-2 truncate">
									{#if isDone}
										<span class="text-emerald-600" aria-label="Completed">✓</span>
									{:else if isLocked}
										<span class="text-slate-400" aria-label="Locked">🔒</span>
									{:else}
										<span class="text-slate-400" aria-hidden="true">•</span>
									{/if}
									<span class="truncate">{lesson.title}</span>
								</span>
								{#if lesson.preview}
									<Badge variant="preview">{#snippet children()}Free{/snippet}</Badge>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>
</aside>
