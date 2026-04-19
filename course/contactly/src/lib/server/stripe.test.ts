import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/server/env', () => ({
	serverEnv: {
		STRIPE_SECRET_KEY: 'sk_test_unit_test_placeholder_key_DO_NOT_USE',
		STRIPE_WEBHOOK_SECRET: 'whsec_unit_test_placeholder_secret_DO_NOT_USE'
	}
}));

describe('server/stripe', () => {
	beforeEach(() => vi.resetModules());
	afterEach(() => vi.restoreAllMocks());

	it('exports the pinned API version', async () => {
		const mod = await import('./stripe');
		expect(mod.STRIPE_API_VERSION).toBe('2026-03-25.dahlia');
	});

	it('returns the same client on repeat invocations (lazy singleton)', async () => {
		const mod = await import('./stripe');
		const a = mod.stripe();
		const b = mod.stripe();
		expect(a).toBe(b);
	});

	it('withIdempotencyKey rejects too-short keys', async () => {
		const { withIdempotencyKey } = await import('./stripe');
		await expect(withIdempotencyKey('', async () => 'noop')).rejects.toThrow(
			/withIdempotencyKey: key must be a stable, non-trivial string/
		);
		await expect(withIdempotencyKey('short', async () => 'noop')).rejects.toThrow(
			/withIdempotencyKey: key must be a stable, non-trivial string/
		);
	});

	it('withIdempotencyKey passes a valid key through to the callback', async () => {
		const { withIdempotencyKey } = await import('./stripe');
		const result = await withIdempotencyKey('upgrade:user_abc:nonce_xyz', async (key) => {
			expect(key).toBe('upgrade:user_abc:nonce_xyz');
			return 'ok' as const;
		});
		expect(result).toBe('ok');
	});
});
