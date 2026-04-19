import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * The admin gate has two acceptance paths and one error mode. Each
 * path needs its own assertion against the discriminated principal
 * shape, plus a "wrong inputs ⇒ 404" case for every branch.
 *
 * `requireAdminOrToken` reads `serverEnv.OPS_API_TOKEN` lazily, so
 * we re-mock the env per test to flip the bearer-branch on/off.
 */

function silentLogger() {
	const noop = () => {};
	return {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		trace: noop,
		fatal: noop,
		child: () => silentLogger()
	};
}

interface FakeEvent {
	request: Request;
	locals: {
		logger: ReturnType<typeof silentLogger>;
		safeGetSession: () => Promise<{ user: { id: string } | null }>;
		supabase: {
			from: (table: string) => {
				select: (cols: string) => {
					eq: (
						col: string,
						val: string
					) => {
						maybeSingle: () => Promise<{
							data: { is_platform_admin: boolean } | null;
							error: { code: string; message: string } | null;
						}>;
					};
				};
			};
		};
	};
}

function makeEvent(opts: {
	authHeader?: string;
	user?: { id: string } | null;
	profile?: { is_platform_admin: boolean } | null;
	profileError?: { code: string; message: string } | null;
}): FakeEvent {
	const headers = new Headers();
	if (opts.authHeader) headers.set('authorization', opts.authHeader);
	return {
		request: new Request('http://localhost/api/admin/webhooks/health', { headers }),
		locals: {
			logger: silentLogger(),
			safeGetSession: async () => ({ user: opts.user ?? null }),
			supabase: {
				from: () => ({
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({
								data: opts.profile ?? null,
								error: opts.profileError ?? null
							})
						})
					})
				})
			}
		}
	};
}

const VALID_TOKEN = 'a'.repeat(48);

async function importHelper() {
	return import('./admin');
}

describe('requireAdminOrToken', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('bearer token branch', () => {
		it('accepts a valid bearer token when OPS_API_TOKEN is configured', async () => {
			vi.doMock('$lib/server/env', () => ({
				serverEnv: { OPS_API_TOKEN: VALID_TOKEN }
			}));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({ authHeader: `Bearer ${VALID_TOKEN}` });
			const result = await requireAdminOrToken(event as unknown as RequestEvent);
			expect(result).toEqual({ kind: 'token', reason: 'ops_api_token' });
		});

		it('rejects a wrong bearer token (404)', async () => {
			vi.doMock('$lib/server/env', () => ({
				serverEnv: { OPS_API_TOKEN: VALID_TOKEN }
			}));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({ authHeader: `Bearer ${'b'.repeat(48)}` });
			await expect(requireAdminOrToken(event as unknown as RequestEvent)).rejects.toMatchObject({
				status: 404
			});
		});

		it('ignores the bearer header entirely when OPS_API_TOKEN is empty', async () => {
			// No env token → bearer header is meaningless. Falls
			// through to the user branch, which (with no user)
			// 404s.
			vi.doMock('$lib/server/env', () => ({
				serverEnv: { OPS_API_TOKEN: '' }
			}));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({ authHeader: `Bearer ${VALID_TOKEN}` });
			await expect(requireAdminOrToken(event as unknown as RequestEvent)).rejects.toMatchObject({
				status: 404
			});
		});

		it('tolerates extra whitespace in the bearer header', async () => {
			vi.doMock('$lib/server/env', () => ({
				serverEnv: { OPS_API_TOKEN: VALID_TOKEN }
			}));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({ authHeader: `Bearer    ${VALID_TOKEN}   ` });
			const result = await requireAdminOrToken(event as unknown as RequestEvent);
			expect(result.kind).toBe('token');
		});

		it('is case-insensitive on the "Bearer" scheme', async () => {
			vi.doMock('$lib/server/env', () => ({
				serverEnv: { OPS_API_TOKEN: VALID_TOKEN }
			}));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({ authHeader: `bearer ${VALID_TOKEN}` });
			const result = await requireAdminOrToken(event as unknown as RequestEvent);
			expect(result.kind).toBe('token');
		});
	});

	describe('user branch', () => {
		it('accepts a signed-in platform admin', async () => {
			vi.doMock('$lib/server/env', () => ({ serverEnv: { OPS_API_TOKEN: '' } }));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({
				user: { id: 'user-1' },
				profile: { is_platform_admin: true }
			});
			const result = await requireAdminOrToken(event as unknown as RequestEvent);
			expect(result).toEqual({ kind: 'user', userId: 'user-1' });
		});

		it('rejects a signed-in non-admin (404)', async () => {
			vi.doMock('$lib/server/env', () => ({ serverEnv: { OPS_API_TOKEN: '' } }));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({
				user: { id: 'user-1' },
				profile: { is_platform_admin: false }
			});
			await expect(requireAdminOrToken(event as unknown as RequestEvent)).rejects.toMatchObject({
				status: 404
			});
		});

		it('rejects when the profile read fails (fail-closed)', async () => {
			vi.doMock('$lib/server/env', () => ({ serverEnv: { OPS_API_TOKEN: '' } }));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({
				user: { id: 'user-1' },
				profileError: { code: 'PG-XYZ', message: 'simulated outage' }
			});
			await expect(requireAdminOrToken(event as unknown as RequestEvent)).rejects.toMatchObject({
				status: 404
			});
		});

		it('rejects an unauthenticated request (404)', async () => {
			vi.doMock('$lib/server/env', () => ({ serverEnv: { OPS_API_TOKEN: '' } }));
			const { requireAdminOrToken } = await importHelper();
			const event = makeEvent({ user: null });
			await expect(requireAdminOrToken(event as unknown as RequestEvent)).rejects.toMatchObject({
				status: 404
			});
		});
	});
});
