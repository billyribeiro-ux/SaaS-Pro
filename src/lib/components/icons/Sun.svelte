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
	<circle cx="12" cy="12" r="4" />
	<path d="M12 2v2" />
	<path d="M12 20v2" />
	<path d="M4.93 4.93l1.41 1.41" />
	<path d="M17.66 17.66l1.41 1.41" />
	<path d="M2 12h2" />
	<path d="M20 12h2" />
	<path d="M4.93 19.07l1.41-1.41" />
	<path d="M17.66 6.34l1.41-1.41" />
</Icon>
