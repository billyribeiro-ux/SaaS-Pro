<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { CURRICULUM } from '$config/curriculum.config';
	import { cn } from '$utils/cn';
	import Badge from '$components/ui/Badge.svelte';
	import Check from '$components/icons/Check.svelte';
	import Lock from '$components/icons/Lock.svelte';
	import ChevronDown from '$components/icons/ChevronDown.svelte';

	type Props = {
		progress: Record<string, Record<string, boolean>>;
		hasSubscription: boolean;
	};

	let { progress, hasSubscription }: Props = $props();

	let activePath = $derived(page.url.pathname);

	// Open the module that contains the current lesson by default; leave the others
	// collapsed so the sidebar doesn't feel overwhelming on a 73-lesson curriculum.
	let openModules = $state<Record<string, boolean>>({});

	$effect(() => {
		const match = activePath.match(/^\/learn\/([^/]+)/);
		const slug = match?.[1];
		if (slug && !openModules[slug]) {
			openModules = { ...openModules, [slug]: true };
		}
	});

	function toggle(slug: string) {
		openModules = { ...openModules, [slug]: !openModules[slug] };
	}

	function moduleProgress(moduleSlug: string): { done: number; total: number } {
		const mod = CURRICULUM.find((m) => m.slug === moduleSlug);
		if (!mod) return { done: 0, total: 0 };
		const done = mod.lessons.filter((l) => progress[moduleSlug]?.[l.slug]).length;
		return { done, total: mod.lessons.length };
	}
</script>

<aside
	class="hidden w-72 shrink-0 overflow-y-auto border-r border-slate-200/80 bg-slate-50/50 p-4 md:block dark:border-slate-800 dark:bg-slate-950"
>
	<nav class="space-y-1">
		{#each CURRICULUM as module (module.slug)}
			{@const { done, total } = moduleProgress(module.slug)}
			{@const isOpen = openModules[module.slug] ?? false}
			<div>
				<button
					type="button"
					onclick={() => toggle(module.slug)}
					class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold tracking-wider text-slate-600 uppercase transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70"
					aria-expanded={isOpen}
				>
					<span class="flex items-center gap-2 truncate">
						<span class="truncate text-[0.78rem] tracking-normal normal-case">{module.title}</span>
					</span>
					<span class="flex items-center gap-2">
						<span class="font-mono text-[0.65rem] font-medium text-slate-400 dark:text-slate-500">
							{done}/{total}
						</span>
						<ChevronDown
							size="xs"
							class={cn(
								'transition-transform duration-200 ease-[var(--ease-out-expo)]',
								isOpen && 'rotate-180'
							)}
						/>
					</span>
				</button>
				{#if isOpen}
					<ul class="mt-0.5 mb-2 space-y-0.5">
						{#each module.lessons as lesson (lesson.slug)}
							{@const href = resolve(`/learn/${module.slug}/${lesson.slug}`)}
							{@const isActive = activePath === href}
							{@const isDone = progress[module.slug]?.[lesson.slug] === true}
							{@const isLocked = !lesson.preview && !hasSubscription}
							<li>
								<a
									{href}
									class={cn(
										'group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
										isActive
											? 'bg-brand-50 text-brand-900 dark:bg-brand-950/50 dark:text-brand-100'
											: 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
									)}
									aria-current={isActive ? 'page' : undefined}
								>
									<span class="flex min-w-0 items-center gap-2">
										<span
											class={cn(
												'grid size-4 shrink-0 place-items-center rounded-full ring-1 transition-colors ring-inset',
												isDone
													? 'bg-emerald-500 text-white ring-emerald-500'
													: isLocked
														? 'bg-transparent text-slate-400 ring-slate-300 dark:text-slate-500 dark:ring-slate-700'
														: isActive
															? 'bg-brand-500 text-white ring-brand-500'
															: 'bg-transparent text-transparent ring-slate-300 dark:ring-slate-700'
											)}
											aria-hidden="true"
										>
											{#if isDone}
												<Check size={10} />
											{:else if isLocked}
												<Lock size={10} />
											{/if}
										</span>
										<span class="truncate">{lesson.title}</span>
									</span>
									{#if lesson.preview}
										<Badge variant="preview">Free</Badge>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</nav>
</aside>
