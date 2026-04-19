// Accepts anything Svelte's class bindings accept (including clsx's ClassValue shape)
// without forcing callers through a narrower union.
export function cn(...inputs: unknown[]): string {
	const out: string[] = [];
	const walk = (value: unknown): void => {
		if (!value) return;
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
			out.push(String(value));
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		if (typeof value === 'object') {
			for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
				if (enabled) out.push(key);
			}
		}
	};
	for (const input of inputs) walk(input);
	return out.join(' ');
}
