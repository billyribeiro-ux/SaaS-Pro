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
	<path d="M12 3l1.88 4.85L18.73 9.73 13.88 11.6 12 16.45 10.12 11.6 5.27 9.73l4.85-1.88L12 3z" />
	<path d="M19 14l.94 2.43L22.37 17.4l-2.43.94L19 20.77l-.94-2.43L15.63 17.4l2.43-.94L19 14z" />
</Icon>
