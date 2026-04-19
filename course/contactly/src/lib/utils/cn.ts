import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose Tailwind class names.
 *
 * Two-step merge:
 *   1. `clsx`        — flattens conditional inputs (objects, arrays, falsey
 *                      values) into a single space-separated string.
 *   2. `twMerge`     — resolves Tailwind conflicts last-wins. So
 *                      `cn('px-2', isLarge && 'px-4')` collapses to
 *                      `'px-4'` when `isLarge`, not `'px-2 px-4'`.
 *
 * Used by every UI primitive that accepts a caller-supplied `class` prop
 * — without `twMerge`, a caller's `class="px-6"` would fight the
 * primitive's internal `class="px-3"` and the cascade would win
 * unpredictably depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
