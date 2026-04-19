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
	<line x1="4" y1="7" x2="20" y2="7" />
	<line x1="4" y1="12" x2="20" y2="12" />
	<line x1="4" y1="17" x2="20" y2="17" />
</Icon>
