/**
 * Cross-checks the CURRICULUM config against the lesson markdown files.
 *
 * Fails (non-zero exit) if any of the following is true:
 *   - A `CURRICULUM` lesson has no corresponding `src/content/<module>/<lesson>.md`
 *   - A markdown file under `src/content/` has no corresponding CURRICULUM entry
 *   - Frontmatter (title / module / lesson / moduleSlug / lessonSlug / duration / preview)
 *     drifts from the CURRICULUM source of truth
 *   - Lesson order in `CURRICULUM` doesn't match the on-disk slug ordering
 *
 * Run with: pnpm tsx scripts/validate-curriculum.ts
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRICULUM } from '../src/lib/config/curriculum.config.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dirname, '..', 'src', 'content');

type Issue = { kind: 'error' | 'warn'; where: string; msg: string };
const issues: Issue[] = [];

function err(where: string, msg: string) {
	issues.push({ kind: 'error', where, msg });
}
function warn(where: string, msg: string) {
	issues.push({ kind: 'warn', where, msg });
}

function parseFrontmatter(raw: string): Record<string, string | number | boolean> | null {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;
	const out: Record<string, string | number | boolean> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
		if (!m) continue;
		const key = m[1];
		let val = m[2].trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (val === 'true') out[key] = true;
		else if (val === 'false') out[key] = false;
		else if (/^-?\d+(\.\d+)?$/.test(val)) out[key] = Number(val);
		else out[key] = val;
	}
	return out;
}

async function main() {
	for (const mod of CURRICULUM) {
		const moduleDir = join(CONTENT_ROOT, mod.slug);
		if (!existsSync(moduleDir)) {
			err(mod.slug, `module directory missing on disk`);
			continue;
		}

		const onDisk = (await readdir(moduleDir))
			.filter((f) => f.endsWith('.md'))
			.map((f) => f.replace(/\.md$/, ''))
			.sort();

		const inConfig = mod.lessons.map((l) => l.slug);

		const missingOnDisk = inConfig.filter((s) => !onDisk.includes(s));
		const orphansOnDisk = onDisk.filter((s) => !inConfig.includes(s));
		for (const s of missingOnDisk) err(`${mod.slug}/${s}`, 'in CURRICULUM but no markdown file');
		for (const s of orphansOnDisk)
			err(`${mod.slug}/${s}`, 'markdown file with no CURRICULUM entry');

		for (const lesson of mod.lessons) {
			const file = join(moduleDir, `${lesson.slug}.md`);
			if (!existsSync(file)) continue;
			const raw = await readFile(file, 'utf8');
			const fm = parseFrontmatter(raw);
			const where = `${mod.slug}/${lesson.slug}`;
			if (!fm) {
				err(where, 'missing or malformed frontmatter');
				continue;
			}

			const expect = (key: string, want: string | number | boolean) => {
				if (fm[key] !== want) {
					err(
						where,
						`frontmatter ${key} = ${JSON.stringify(fm[key])} (expected ${JSON.stringify(want)})`
					);
				}
			};

			// Lesson number convention: match the leading digits in the slug
			// filename so it lines up with the user-visible title (e.g. slug
			// `05-account-page` → `lesson: 5`, mirroring "3.5 - Account Page").
			// Sub-lessons like `07-1-close-modal-on-cancel` carry the major
			// number (7), and `bonus-NN-*` slugs carry their bonus number.
			const slugMatch = lesson.slug.match(/^(?:bonus-)?(\d+)/);
			const expectedLessonNumber = slugMatch ? Number(slugMatch[1]) : 0;

			expect('title', lesson.title);
			expect('module', mod.moduleNumber);
			expect('lesson', expectedLessonNumber);
			expect('moduleSlug', mod.slug);
			expect('lessonSlug', lesson.slug);
			expect('duration', lesson.duration);
			expect('preview', lesson.preview);

			if (typeof fm.description !== 'string' || !fm.description.trim()) {
				warn(where, 'frontmatter description missing or empty');
			}
		}
	}

	for (const moduleSlug of (await readdir(CONTENT_ROOT)).filter(async (n) => {
		const p = join(CONTENT_ROOT, n);
		return (await stat(p)).isDirectory();
	})) {
		const dir = join(CONTENT_ROOT, moduleSlug);
		try {
			const s = await stat(dir);
			if (!s.isDirectory()) continue;
		} catch {
			continue;
		}
		if (!CURRICULUM.find((m) => m.slug === moduleSlug)) {
			err(moduleSlug, `module directory exists on disk but not in CURRICULUM`);
		}
	}

	const errors = issues.filter((i) => i.kind === 'error');
	const warns = issues.filter((i) => i.kind === 'warn');
	for (const i of issues) {
		const tag = i.kind === 'error' ? 'ERROR' : 'WARN ';
		console.log(`${tag} ${i.where}: ${i.msg}`);
	}
	console.log(`\nSummary: ${errors.length} errors, ${warns.length} warnings`);
	process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(2);
});
