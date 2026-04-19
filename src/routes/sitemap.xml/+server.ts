import type { RequestHandler } from './$types';
import { CURRICULUM } from '$config/curriculum.config';
import { SITE } from '$config/site.config';

// Prerendered at build time. Regenerates when CURRICULUM or marketing
// routes change, which is exactly as often as a deploy happens.
export const prerender = true;

const staticRoutes: Array<{ path: string; changefreq: string; priority: string }> = [
	{ path: '/', changefreq: 'weekly', priority: '1.0' },
	{ path: '/pricing', changefreq: 'weekly', priority: '0.9' },
	{ path: '/learn', changefreq: 'weekly', priority: '0.8' }
];

function xmlEscape(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export const GET: RequestHandler = async () => {
	const origin = SITE.url.replace(/\/$/, '');
	const urls: string[] = [];

	for (const route of staticRoutes) {
		urls.push(
			`<url><loc>${xmlEscape(origin + route.path)}</loc>` +
				`<changefreq>${route.changefreq}</changefreq>` +
				`<priority>${route.priority}</priority></url>`
		);
	}

	// Only the free-preview lessons are indexable; paid content is behind a
	// subscription gate and shouldn't be listed publicly.
	for (const mod of CURRICULUM) {
		for (const lesson of mod.lessons) {
			if (!lesson.preview) continue;
			const url = `${origin}/learn/${mod.slug}/${lesson.slug}`;
			urls.push(
				`<url><loc>${xmlEscape(url)}</loc>` +
					`<changefreq>monthly</changefreq>` +
					`<priority>0.7</priority></url>`
			);
		}
	}

	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
		urls.join('') +
		`</urlset>`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
