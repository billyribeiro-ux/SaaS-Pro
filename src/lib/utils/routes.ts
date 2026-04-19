import { resolve } from '$app/paths';
import type { Pathname, PathnameWithSearchOrHash } from '$app/types';

/**
 * Type-safe wrapper around SvelteKit's `resolve()` that accepts any union of
 * known pathnames (with or without `?search` / `#hash` suffixes) and returns
 * a resolved string.
 *
 * `resolve()` is a generic function whose argument type distributes over
 * unions, which makes the TS compiler reject calls where the argument is
 * itself a union of literal pathnames (e.g. when iterating over a config
 * array of nav links). The internal cast to `never` is safe because the
 * input domain is constrained to the exact set of pathnames `resolve()`
 * already accepts — we just bypass the distribution caveat in the
 * conditional return type.
 */
export function resolvePathname(path: Pathname | PathnameWithSearchOrHash): string {
	return (resolve as (p: string) => string)(path);
}
