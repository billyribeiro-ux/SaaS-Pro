import { marked, Renderer } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: false
});

// We emit `<pre data-copyable>` with a sibling header containing the
// language label and a copy button placeholder. Client-side, the
// `enhanceCodeBlocks` attachment (see LessonViewer.svelte) wires up the
// copy behavior. Rendering HTML once on the server with a stable shape
// is cheaper than mounting a Svelte component per code block.
const renderer = new Renderer();

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

renderer.code = ({ text, lang }) => {
	const language = (lang || '').split(/\s+/)[0] || '';
	const labelAttr = language ? ` data-language="${escapeHtml(language)}"` : '';
	return (
		`<div class="code-block not-prose" data-copyable${labelAttr}>` +
		(language
			? `<div class="code-block__header"><span class="code-block__lang">${escapeHtml(language)}</span><button type="button" class="code-block__copy" data-copy-button aria-label="Copy code">Copy</button></div>`
			: `<button type="button" class="code-block__copy code-block__copy--floating" data-copy-button aria-label="Copy code">Copy</button>`) +
		`<pre><code class="language-${escapeHtml(language)}">${escapeHtml(text)}</code></pre>` +
		`</div>`
	);
};

marked.use({ renderer });

// Process-level cache. Lesson markdown is read-only content shipped with the
// deployment, so the rendered HTML for a given body is stable for the lifetime
// of the process. Keyed by a cheap fingerprint of the source body.
const cache = new Map<string, string>();

// djb2 — fast, no deps. Length-prefixed to further reduce collision risk.
function fingerprint(body: string): string {
	let hash = 5381;
	for (let i = 0; i < body.length; i++) {
		hash = ((hash << 5) + hash + body.charCodeAt(i)) | 0;
	}
	return `${body.length}:${hash >>> 0}`;
}

// Converts our lesson markdown body to HTML. Content is authored in-repo,
// so we skip sanitization — if user-submitted content is ever added, pipe through DOMPurify.
export function renderMarkdown(body: string): string {
	const key = fingerprint(body);
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const html = marked.parse(body, { async: false });
	cache.set(key, html);
	return html;
}
