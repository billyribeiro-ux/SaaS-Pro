/**
 * Loads a cassette JSON file from `src/lib/testing/cassettes/` by
 * its bare name.
 *
 * Why a separate module from `cassette.ts`?
 *  - `cassette.ts` is pure: types + schema + parser. Importing it
 *    from any environment (browser, edge, Node test) is safe.
 *  - This module touches `node:fs` + `node:path` and only makes
 *    sense in a Node test runner. Splitting them keeps `cassette.ts`
 *    portable.
 *
 * The loader resolves paths relative to the cassettes directory
 * (NOT the caller's `__dirname`) so callers identify cassettes by
 * a stable name (`'subscribe-pro-monthly-keep'`) rather than a
 * brittle relative path. Cassette files MUST live in
 * `src/lib/testing/cassettes/` and end in `.cassette.json`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCassetteOrThrow, type Cassette } from './cassette';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CASSETTES_DIR = join(HERE, 'cassettes');
const CASSETTE_SUFFIX = '.cassette.json';

/**
 * Load and parse a single cassette by its bare name.
 *
 * `name` is the filename without the `.cassette.json` suffix —
 * `'subscribe-pro-monthly-keep'` resolves to
 * `src/lib/testing/cassettes/subscribe-pro-monthly-keep.cassette.json`.
 *
 * Throws (with the full Zod issue list) if the file is missing or
 * fails validation. Tests want loud failures here — a corrupted
 * cassette silently parsed as `{}` would make every assertion
 * pass for the wrong reason.
 */
export function loadCassette(name: string): Cassette {
	const path = join(CASSETTES_DIR, `${name}${CASSETTE_SUFFIX}`);
	let contents: string;
	try {
		contents = readFileSync(path, 'utf-8');
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Cassette "${name}" not found at ${path}. ` +
				`Available cassettes: ${listCassettes().join(', ') || '(none)'}. ` +
				`Underlying error: ${reason}`,
			{ cause: err }
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(`Cassette "${name}" is not valid JSON: ${reason}`, { cause: err });
	}
	return parseCassetteOrThrow(parsed);
}

/**
 * Enumerate every cassette name available on disk. Useful in
 * sweep tests ("every cassette must validate") and in the
 * loader's error message above.
 */
export function listCassettes(): string[] {
	let entries: string[];
	try {
		entries = readdirSync(CASSETTES_DIR);
	} catch {
		return [];
	}
	return entries
		.filter((n) => n.endsWith(CASSETTE_SUFFIX))
		.map((n) => n.slice(0, -CASSETTE_SUFFIX.length))
		.sort();
}
