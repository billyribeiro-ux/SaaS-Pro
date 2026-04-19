<script lang="ts">
	import Icon, { type IconSize } from './Icon.svelte';

	type Props = {
		size?: IconSize | number;
		class?: string;
		'aria-label'?: string;
	};

	let { size, class: className, 'aria-label': ariaLabel }: Props = $props();
</script>

<Icon {size} class={className} aria-label={ariaLabel}>
	<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
	<line x1="8" y1="21" x2="16" y2="21" />
	<line x1="12" y1="17" x2="12" y2="21" />
</Icon>
