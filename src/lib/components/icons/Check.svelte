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
	<polyline points="20 6 9 17 4 12" />
</Icon>
