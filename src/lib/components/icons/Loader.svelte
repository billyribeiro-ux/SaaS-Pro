<script lang="ts">
	import Icon, { type IconSize } from './Icon.svelte';
	import { cn } from '$utils/cn';

	type Props = {
		size?: IconSize | number;
		class?: string;
		'aria-label'?: string;
	};

	let { size, class: className, 'aria-label': ariaLabel }: Props = $props();
</script>

<Icon {size} class={cn('animate-spin', className)} aria-label={ariaLabel}>
	<path d="M21 12a9 9 0 1 1-6.22-8.56" />
</Icon>
