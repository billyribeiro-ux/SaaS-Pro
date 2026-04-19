<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import Check from '$components/icons/Check.svelte';

	type Props = {
		completed: boolean;
		moduleSlug: string;
		lessonSlug: string;
	};

	let { completed, moduleSlug, lessonSlug }: Props = $props();
</script>

<form
	method="POST"
	action={`/learn/${moduleSlug}/${lessonSlug}?/complete`}
	class="flex flex-wrap items-center gap-3"
>
	{#if completed}
		<span
			class="animate-scale-in inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-500/30 ring-inset dark:text-emerald-300"
		>
			<span
				class="grid size-5 place-items-center rounded-full bg-emerald-500 text-white"
				aria-hidden="true"
			>
				<Check size={12} />
			</span>
			Lesson completed
		</span>
		<Button type="submit" variant="ghost" size="sm" name="action" value="uncomplete">
			Mark incomplete
		</Button>
	{:else}
		<Button type="submit" variant="primary" size="md">
			<Check size="sm" />
			Mark as complete
		</Button>
		<span class="text-xs text-slate-500 dark:text-slate-400">
			Your progress updates instantly.
		</span>
	{/if}
</form>
