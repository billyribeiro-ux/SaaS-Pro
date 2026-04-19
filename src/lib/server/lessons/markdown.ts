import { marked } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: false
});

// Converts our lesson markdown body to HTML. Content is authored in-repo,
// so we skip sanitization — if user-submitted content is ever added, pipe through DOMPurify.
export function renderMarkdown(body: string): string {
	return marked.parse(body, { async: false });
}
