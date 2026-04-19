import { describe, expect, it } from 'vitest';
import { logger, requestLogger } from './logger';

/**
 * The logger module itself reads `NODE_ENV` at module-load time
 * (`silent` in tests), which keeps every other test file quiet by
 * default. These tests don't try to fight that — they assert the
 * surface shape of the logger and the per-request bindings.
 *
 * The pino "is this actually emitting" coverage is exercised in
 * `pino`'s own test suite; reproducing it here would mean stubbing
 * `process.stdout` and accepting the brittleness for no real
 * confidence gain.
 */
describe('logger', () => {
	it('exposes the standard pino level methods', () => {
		expect(typeof logger.trace).toBe('function');
		expect(typeof logger.debug).toBe('function');
		expect(typeof logger.info).toBe('function');
		expect(typeof logger.warn).toBe('function');
		expect(typeof logger.error).toBe('function');
		expect(typeof logger.fatal).toBe('function');
		expect(typeof logger.child).toBe('function');
	});

	it('returns a child logger that exposes the same surface', () => {
		const child = logger.child({ scope: 'unit-test' });
		expect(typeof child.info).toBe('function');
		expect(typeof child.child).toBe('function');
	});

	it('emits "silent" at the level threshold under NODE_ENV=test', () => {
		// `bindings()` returns the inherited base bindings; level
		// resolution happens inside pino. We assert the configured
		// level reached pino unchanged, which is the contract our
		// caller code relies on (no stray prod-noise during unit
		// tests).
		expect(logger.level).toBe('silent');
	});
});

describe('requestLogger', () => {
	function fakeEvent(headers: Record<string, string> = {}, routeId: string | null = null) {
		// `RequestEvent['route']` is a tight literal-union of every
		// route id SvelteKit knows about. We're not pulling in the
		// generated `$types`-flavored union for a unit test — cast
		// at the boundary to keep the contract loose enough to
		// exercise null + arbitrary string ids.
		return {
			request: new Request('https://example.test/route', { headers }),
			route: { id: routeId } as { id: never },
			locals: {} as never
		};
	}

	it('uses the platform-supplied request id when present', () => {
		const log = requestLogger(fakeEvent({ 'x-request-id': 'abc-123' }, '/api/probe'));
		const bindings = log.bindings();
		expect(bindings.req_id).toBe('abc-123');
		expect(bindings.route_id).toBe('/api/probe');
	});

	it('falls back to x-vercel-id when x-request-id is absent', () => {
		const log = requestLogger(fakeEvent({ 'x-vercel-id': 'iad1::abc' }, '/api/billing/checkout'));
		const bindings = log.bindings();
		expect(bindings.req_id).toBe('iad1::abc');
		expect(bindings.vercel_id).toBe('iad1::abc');
	});

	it('synthesizes a request id when no header is provided', () => {
		const log = requestLogger(fakeEvent({}, '/api/webhooks/stripe'));
		const bindings = log.bindings();
		expect(typeof bindings.req_id).toBe('string');
		expect((bindings.req_id as string).length).toBeGreaterThan(0);
		expect(bindings.vercel_id).toBeNull();
	});

	it('merges caller bindings without dropping req_id / route_id', () => {
		const log = requestLogger(fakeEvent({ 'x-request-id': 'r1' }, '/api/probe'), {
			user_id: 'usr_test_1'
		});
		const bindings = log.bindings();
		expect(bindings.req_id).toBe('r1');
		expect(bindings.user_id).toBe('usr_test_1');
		expect(bindings.route_id).toBe('/api/probe');
	});
});
