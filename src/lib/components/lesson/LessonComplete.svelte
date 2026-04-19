<script lang="ts">
	import Button from '$components/ui/Button.svelte';

	type Props = {
		completed: boolean;
		moduleSlug: string;
		lessonSlug: string;
	};

	let { completed, moduleSlug, lessonSlug }: Props = $props();
</script>

<form method="POST" action={`/learn/${moduleSlug}/${lessonSlug}?/complete`} class="flex items-center gap-3">
	{#if completed}
		<span class="inline-flex items-center gap-2 rounded-md bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
			<span aria-hidden="true">✓</span>
			Completed
		</span>
		<Button type="submit" variant="ghost" size="sm" name="action" value="uncomplete">
			{#snippet children()}Mark incomplete{/snippet}
		</Button>
	{:else}
		<Button type="submit" variant="primary" size="md">
			{#snippet children()}Mark as complete{/snippet}
		</Button>
	{/if}
</form>
