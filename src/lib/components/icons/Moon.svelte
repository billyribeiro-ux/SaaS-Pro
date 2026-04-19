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
	<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
</Icon>
