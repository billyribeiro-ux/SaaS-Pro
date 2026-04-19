<script lang="ts" module>
	/*
	 * Shared wrapper for every icon in this folder. Each leaf icon (Check.svelte, etc.)
	 * renders an <Icon> and passes in its path data via the `children` snippet. Centralising
	 * stroke width, sizing and accessibility here means one place to change the whole set.
	 */
	export type IconSize = 'xs' | 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$utils/cn';

	type Props = {
		size?: IconSize | number;
		class?: string;
		'aria-label'?: string;
		children: Snippet;
	};

	let { size = 'md', class: className, 'aria-label': ariaLabel, children }: Props = $props();

	const sizeMap: Record<IconSize, number> = {
		xs: 12,
		sm: 14,
		md: 16,
		lg: 20
	};

	let pixelSize = $derived(typeof size === 'number' ? size : sizeMap[size]);
	let decorative = $derived(!ariaLabel);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={pixelSize}
	height={pixelSize}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cn('shrink-0', className)}
	aria-hidden={decorative ? 'true' : undefined}
	aria-label={ariaLabel}
	role={decorative ? undefined : 'img'}
	focusable="false"
>
	{@render children()}
</svg>
