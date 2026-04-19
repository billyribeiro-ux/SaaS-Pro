import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { supabaseAdmin } from '$server/supabase';
import type { LessonContent, LessonFrontmatter } from '$types/lesson.types';

const CONTENT_ROOT = path.resolve(process.cwd(), 'src/content');

// Minimal YAML frontmatter parser for our fixed schema.
// We control every key used in CONTENT_FIELDS, so a full YAML lib would be overkill.
function parseFrontmatter(raw: string): { meta: LessonFrontmatter; content: string } | null {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return null;

	const [, block = '', body = ''] = match;
	const data: Record<string, string | number | boolean> = {};

	for (const line of block.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) continue;

		const key = trimmed.slice(0, colonIndex).trim();
		let value = trimmed.slice(colonIndex + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		if (value === 'true' || value === 'false') {
			data[key] = value === 'true';
		} else if (/^-?\d+(\.\d+)?$/.test(value)) {
			data[key] = Number(value);
		} else {
			data[key] = value;
		}
	}

	const required: Array<keyof LessonFrontmatter> = [
		'title',
		'module',
		'lesson',
		'moduleSlug',
		'lessonSlug',
		'description',
		'duration',
		'preview'
	];
	for (const field of required) {
		if (!(field in data)) return null;
	}

	const meta: LessonFrontmatter = {
		title: String(data.title),
		module: Number(data.module),
		lesson: Number(data.lesson),
		moduleSlug: String(data.moduleSlug),
		lessonSlug: String(data.lessonSlug),
		description: String(data.description),
		duration: Number(data.duration),
		preview: Boolean(data.preview)
	};

	return { meta, content: body };
}

export async function getLessonContent(
	moduleSlug: string,
	lessonSlug: string
): Promise<LessonContent | null> {
	// Guard against path traversal. Slugs in the curriculum are slug-cased,
	// but this input flows from the URL so we validate before touching fs.
	if (!/^[a-z0-9-]+$/.test(moduleSlug) || !/^[a-z0-9-]+$/.test(lessonSlug)) {
		return null;
	}

	const filePath = path.join(CONTENT_ROOT, moduleSlug, `${lessonSlug}.md`);
	if (!filePath.startsWith(CONTENT_ROOT)) return null;

	let raw: string;
	try {
		raw = await readFile(filePath, 'utf8');
	} catch (error) {
		if (
			error instanceof Error &&
			'code' in error &&
			(error as NodeJS.ErrnoException).code === 'ENOENT'
		) {
			return null;
		}
		throw error;
	}

	return parseFrontmatter(raw);
}

// Returns { [lessonSlug]: completed } for all lessons the user has a row for.
export async function getModuleProgress(
	userId: string,
	moduleSlug: string
): Promise<Record<string, boolean>> {
	const { data, error } = await supabaseAdmin
		.from('lesson_progress')
		.select('lesson_slug, completed')
		.eq('user_id', userId)
		.eq('module_slug', moduleSlug);

	if (error) {
		throw new Error(`[content.service] progress fetch failed: ${error.message}`);
	}

	const map: Record<string, boolean> = {};
	for (const row of data ?? []) {
		map[row.lesson_slug] = row.completed;
	}
	return map;
}

export async function markLessonCompleted(
	userId: string,
	moduleSlug: string,
	lessonSlug: string
): Promise<void> {
	const { error } = await supabaseAdmin.from('lesson_progress').upsert(
		{
			user_id: userId,
			module_slug: moduleSlug,
			lesson_slug: lessonSlug,
			completed: true,
			completed_at: new Date().toISOString()
		},
		{ onConflict: 'user_id,module_slug,lesson_slug' }
	);

	if (error) {
		throw new Error(`[content.service] mark completed failed: ${error.message}`);
	}
}
