import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The helpers in `sentry-shared.ts` read `process.env` directly,
 * which is exactly the behaviour we want at runtime (Vercel +
 * Node) but means each test needs to stash + restore env vars to
 * stay independent.
 */
describe('sentry-shared', () => {
	const SAVED = {
		PUBLIC_SENTRY_RELEASE: process.env.PUBLIC_SENTRY_RELEASE,
		VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
		VERCEL_ENV: process.env.VERCEL_ENV,
		NODE_ENV: process.env.NODE_ENV
	};

	beforeEach(() => {
		delete process.env.PUBLIC_SENTRY_RELEASE;
		delete process.env.VERCEL_GIT_COMMIT_SHA;
		delete process.env.VERCEL_ENV;
		// Most tests want a known NODE_ENV. The default vitest setup
		// runs with `'test'`; we restore in `afterEach`.
		process.env.NODE_ENV = 'test';
		vi.resetModules();
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(SAVED)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		vi.restoreAllMocks();
	});

	describe('resolveRelease', () => {
		it('uses PUBLIC_SENTRY_RELEASE when present (highest precedence)', async () => {
			process.env.PUBLIC_SENTRY_RELEASE = 'contactly@manual-pin';
			process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef0000';
			const { resolveRelease } = await import('./sentry-shared');
			expect(resolveRelease()).toBe('contactly@manual-pin');
		});

		it('falls back to a truncated VERCEL_GIT_COMMIT_SHA', async () => {
			process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef00112233';
			const { resolveRelease } = await import('./sentry-shared');
			expect(resolveRelease()).toBe('contactly@0123456789ab');
		});

		it('falls back to "contactly@dev" with no env hints', async () => {
			const { resolveRelease } = await import('./sentry-shared');
			expect(resolveRelease()).toBe('contactly@dev');
		});
	});

	describe('resolveEnvironment', () => {
		it('prefers VERCEL_ENV over NODE_ENV', async () => {
			process.env.VERCEL_ENV = 'preview';
			process.env.NODE_ENV = 'production';
			const { resolveEnvironment } = await import('./sentry-shared');
			expect(resolveEnvironment()).toBe('preview');
		});

		it('falls back to NODE_ENV', async () => {
			process.env.NODE_ENV = 'production';
			const { resolveEnvironment } = await import('./sentry-shared');
			expect(resolveEnvironment()).toBe('production');
		});

		it('falls back to "development" with no env hints', async () => {
			delete process.env.NODE_ENV;
			const { resolveEnvironment } = await import('./sentry-shared');
			expect(resolveEnvironment()).toBe('development');
		});
	});

	describe('baseInitOptions', () => {
		it('disables Sentry when DSN is empty', async () => {
			const { baseInitOptions } = await import('./sentry-shared');
			const opts = baseInitOptions('');
			expect(opts.enabled).toBe(false);
			expect(opts.dsn).toBe('');
		});

		it('enables Sentry when DSN is present', async () => {
			const { baseInitOptions } = await import('./sentry-shared');
			const opts = baseInitOptions('https://abc@o1.ingest.sentry.io/1');
			expect(opts.enabled).toBe(true);
			expect(opts.dsn).toBe('https://abc@o1.ingest.sentry.io/1');
		});

		it('uses 10% trace sampling in production', async () => {
			process.env.VERCEL_ENV = 'production';
			const { baseInitOptions } = await import('./sentry-shared');
			expect(baseInitOptions('https://abc@o1.ingest.sentry.io/1').tracesSampleRate).toBe(0.1);
		});

		it('uses 100% trace sampling in non-production', async () => {
			process.env.NODE_ENV = 'development';
			const { baseInitOptions } = await import('./sentry-shared');
			expect(baseInitOptions('https://abc@o1.ingest.sentry.io/1').tracesSampleRate).toBe(1.0);
		});

		it('keeps PII collection off by default', async () => {
			const { baseInitOptions } = await import('./sentry-shared');
			expect(baseInitOptions('https://abc@o1.ingest.sentry.io/1').sendDefaultPii).toBe(false);
		});
	});
});
