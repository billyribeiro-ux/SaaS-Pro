<script lang="ts">
	import type { LessonContent, LessonNavLinks } from '$types/lesson.types';
	import { formatDuration } from '$utils/format';
	import Badge from '$components/ui/Badge.svelte';
	import LessonNav from './LessonNav.svelte';
	import LessonComplete from './LessonComplete.svelte';

	type Props = {
		lesson: LessonContent;
		navLinks: LessonNavLinks;
		completed: boolean;
		renderedHtml: string;
	};

	let { lesson, navLinks, completed, renderedHtml }: Props = $props();

	/*
	 * Reading-progress bar — percent of the article scrolled. Uses a single rAF-scheduled
	 * scroll handler to stay smooth without any external deps. Tracks the article
	 * element's rect relative to the viewport.
	 */
	let progress = $state(0);
	let articleEl: HTMLElement | null = $state(null);

	$effect(() => {
		function update() {
			const el = articleEl;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			const viewport = window.innerHeight;
			const total = Math.max(1, rect.height - viewport);
			const scrolled = Math.min(Math.max(-rect.top, 0), total);
			progress = (scrolled / total) * 100;
		}
		update();
		let raf = 0;
		function onScroll() {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(update);
		}
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			cancelAnimationFrame(raf);
		};
	});

	/*
	 * Post-render enhancement: the server emits `[data-copy-button]` on every code
	 * block (see $server/lessons/markdown.ts). On mount we delegate a click handler
	 * on the prose container so every code block gets a copy button — without
	 * mounting a Svelte component per block. Delegation keeps listener count at O(1)
	 * regardless of lesson length.
	 */
	function enhanceCodeBlocks(container: HTMLElement) {
		async function copyFromButton(button: HTMLButtonElement) {
			const block = button.closest('[data-copyable]');
			const code = block?.querySelector('pre code');
			if (!code) return;
			try {
				await navigator.clipboard.writeText(code.textContent ?? '');
				const original = button.textContent;
				button.textContent = 'Copied';
				button.setAttribute('data-copied', 'true');
				setTimeout(() => {
					button.textContent = original;
					button.removeAttribute('data-copied');
				}, 1500);
			} catch {
				// Clipboard API unavailable — silently fail rather than break the page.
			}
		}

		function onClick(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			const button = target?.closest<HTMLButtonElement>('[data-copy-button]');
			if (button) copyFromButton(button);
		}

		container.addEventListener('click', onClick);
		return () => container.removeEventListener('click', onClick);
	}
</script>

<!--
	Top reading-progress bar — sticky below the navbar. Pointer-events-none so it
	never steals clicks; z-30 keeps it above page content but below the navbar (z-40).
-->
<div
	class="sticky top-14 z-30 h-0.5 w-full overflow-hidden bg-transparent sm:top-16"
	aria-hidden="true"
>
	<div
		class="h-full bg-gradient-to-r from-brand-500 to-brand-400 transition-[width] duration-100"
		style:width="{progress}%"
	></div>
</div>

<article bind:this={articleEl} class="mx-auto w-full max-w-3xl px-6 py-10">
	<header class="mb-8">
		<div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
			<span class="font-mono font-medium">Module {lesson.meta.module}</span>
			<span aria-hidden="true">·</span>
			<span>{formatDuration(lesson.meta.duration)} read</span>
			{#if lesson.meta.preview}
				<Badge variant="preview">Free preview</Badge>
			{/if}
		</div>
		<h1 class="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl dark:text-white">
			{lesson.meta.title}
		</h1>
		<p class="mt-3 text-lg leading-relaxed text-slate-600 dark:text-slate-400">
			{lesson.meta.description}
		</p>
	</header>

	<!-- Rendered server-side from the markdown body. Content is authored by us, so {@html} is safe. -->
	<div
		class="prose prose-slate max-w-none prose-headings:font-display prose-headings:tracking-tight prose-a:text-brand-700 prose-a:no-underline hover:prose-a:underline dark:prose-invert dark:prose-a:text-brand-400"
		{@attach enhanceCodeBlocks}
	>
		{@html renderedHtml}
	</div>

	<div class="mt-12 border-t border-slate-200/80 pt-8 dark:border-slate-800">
		<LessonComplete {completed} moduleSlug={lesson.meta.moduleSlug} lessonSlug={lesson.meta.lessonSlug} />
	</div>

	<div class="mt-8">
		<LessonNav links={navLinks} />
	</div>
</article>

<style>
	/* Code-block styling for the enhanced <pre> rendered by the server markdown pipe. */
	:global(.code-block) {
		position: relative;
		margin: 1.5rem 0;
		overflow: hidden;
		border-radius: 0.5rem;
		border: 1px solid rgb(30 41 59);
		background: rgb(2 6 23);
	}
	:global(.code-block__header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.875rem;
		background: rgb(15 23 42);
		border-bottom: 1px solid rgb(30 41 59);
		font-size: 0.75rem;
		color: rgb(148 163 184);
	}
	:global(.code-block__lang) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	:global(.code-block__copy) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: 0.375rem;
		border: 1px solid rgb(51 65 85);
		background: rgb(30 41 59);
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		color: rgb(226 232 240);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}
	:global(.code-block__copy:hover) {
		background: rgb(51 65 85);
		border-color: rgb(71 85 105);
	}
	:global(.code-block__copy[data-copied='true']) {
		color: rgb(52 211 153);
		border-color: rgb(5 150 105);
	}
	:global(.code-block__copy--floating) {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		opacity: 0;
	}
	:global(.code-block:hover .code-block__copy--floating),
	:global(.code-block__copy--floating:focus-visible),
	:global(.code-block__copy[data-copied='true']) {
		opacity: 1;
	}
	:global(.code-block pre) {
		margin: 0;
		overflow-x: auto;
		padding: 1rem 1.125rem;
		font-size: 0.875rem;
		line-height: 1.65;
		color: rgb(241 245 249);
	}
	:global(.code-block pre code) {
		background: transparent;
		padding: 0;
		color: inherit;
		font-weight: 400;
	}

	/* Anchor links on headings — render a subtle "#" on hover. */
	:global(.prose h2),
	:global(.prose h3) {
		scroll-margin-top: 6rem;
	}
</style>
