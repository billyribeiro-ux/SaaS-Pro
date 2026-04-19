import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	resolveCommitBranch,
	resolveCommitSha,
	resolveEnvironment,
	resolveRelease
} from './release';

/**
 * Module 11.3 — `release.ts` is the single source of truth for
 * the build's release string, used by:
 *
 *   1. `src/lib/sentry-shared.ts` (runtime SDK init)
 *   2. `vite.config.ts`           (@sentry/vite-plugin upload)
 *   3. `src/routes/api/version`   (operator sanity check)
 *
 * Drift between any two of these silently breaks Sentry source-map
 * symbolication. The cases below pin the precedence chain so a
 * future "small refactor" can't reintroduce drift without breaking
 * the suite.
 */
describe('resolveRelease', () => {
	const SAVED = {
		PUBLIC_SENTRY_RELEASE: process.env.PUBLIC_SENTRY_RELEASE,
		VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA
	};

	beforeEach(() => {
		delete process.env.PUBLIC_SENTRY_RELEASE;
		delete process.env.VERCEL_GIT_COMMIT_SHA;
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(SAVED)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it('uses PUBLIC_SENTRY_RELEASE when present (highest precedence)', () => {
		process.env.PUBLIC_SENTRY_RELEASE = 'contactly@manual-pin';
		process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef0000';
		expect(resolveRelease()).toBe('contactly@manual-pin');
	});

	it('truncates VERCEL_GIT_COMMIT_SHA to 12 chars', () => {
		process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef00112233';
		expect(resolveRelease()).toBe('contactly@0123456789ab');
	});

	it('falls back to "contactly@dev" with no env hints', () => {
		expect(resolveRelease()).toBe('contactly@dev');
	});

	it('respects an explicit env dict (build-time loadEnv path)', () => {
		const env = {
			PUBLIC_SENTRY_RELEASE: '',
			VERCEL_GIT_COMMIT_SHA: 'feedfacecafebabe1234'
		};
		expect(resolveRelease(env)).toBe('contactly@feedfacecafe');
	});

	it('explicit env dict overrides process.env', () => {
		process.env.PUBLIC_SENTRY_RELEASE = 'process-env-wins?';
		const env = { PUBLIC_SENTRY_RELEASE: 'dict-wins' };
		expect(resolveRelease(env)).toBe('dict-wins');
	});

	it('empty/whitespace-only PUBLIC_SENTRY_RELEASE is treated as unset', () => {
		process.env.PUBLIC_SENTRY_RELEASE = '   ';
		process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def4567890';
		expect(resolveRelease()).toBe('contactly@abc123def456');
	});
});

describe('resolveEnvironment', () => {
	const SAVED = {
		VERCEL_ENV: process.env.VERCEL_ENV,
		NODE_ENV: process.env.NODE_ENV
	};

	beforeEach(() => {
		delete process.env.VERCEL_ENV;
		process.env.NODE_ENV = 'test';
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(SAVED)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it('prefers VERCEL_ENV over NODE_ENV', () => {
		process.env.VERCEL_ENV = 'preview';
		process.env.NODE_ENV = 'production';
		expect(resolveEnvironment()).toBe('preview');
	});

	it('falls back to NODE_ENV', () => {
		process.env.NODE_ENV = 'production';
		expect(resolveEnvironment()).toBe('production');
	});

	it('falls back to "development" with no env hints', () => {
		delete process.env.NODE_ENV;
		expect(resolveEnvironment()).toBe('development');
	});

	it("treats empty string NODE_ENV as missing (Node's `delete` quirk)", () => {
		process.env.NODE_ENV = '';
		expect(resolveEnvironment()).toBe('development');
	});

	it('respects an explicit env dict', () => {
		const env = { VERCEL_ENV: 'preview' };
		expect(resolveEnvironment(env)).toBe('preview');
	});
});

describe('resolveCommitSha', () => {
	const SAVED = process.env.VERCEL_GIT_COMMIT_SHA;
	beforeEach(() => delete process.env.VERCEL_GIT_COMMIT_SHA);
	afterEach(() => {
		if (SAVED === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
		else process.env.VERCEL_GIT_COMMIT_SHA = SAVED;
	});

	it('returns the full untruncated SHA when present', () => {
		process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef00112233';
		expect(resolveCommitSha()).toBe('0123456789abcdef00112233');
	});

	it('returns null when missing', () => {
		expect(resolveCommitSha()).toBeNull();
	});
});

describe('resolveCommitBranch', () => {
	const SAVED = process.env.VERCEL_GIT_COMMIT_REF;
	beforeEach(() => delete process.env.VERCEL_GIT_COMMIT_REF);
	afterEach(() => {
		if (SAVED === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
		else process.env.VERCEL_GIT_COMMIT_REF = SAVED;
	});

	it('returns the branch name when present', () => {
		process.env.VERCEL_GIT_COMMIT_REF = 'feature/billing-portal';
		expect(resolveCommitBranch()).toBe('feature/billing-portal');
	});

	it('returns null when missing', () => {
		expect(resolveCommitBranch()).toBeNull();
	});
});
