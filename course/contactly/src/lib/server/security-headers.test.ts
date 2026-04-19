import { describe, expect, it } from 'vitest';

import { applySecurityHeaders, securityHeaders } from './security-headers';

/**
 * Module 11.4 — pin the per-environment header table.
 *
 * The header policy is the kind of code that's easy to "fix" in
 * a hurry and accidentally relax (someone disables HSTS to make
 * a local cert work, never re-enables it). Every environment-
 * specific transition gets a test so a regression breaks the
 * suite instead of breaking a customer's browser cache.
 */
describe('securityHeaders', () => {
	describe('always-on baseline', () => {
		const ALL_ENVS: Array<'production' | 'preview' | 'development'> = [
			'production',
			'preview',
			'development'
		];

		for (const environment of ALL_ENVS) {
			it(`${environment}: nosniff is always on`, () => {
				const h = securityHeaders({ environment });
				expect(h['X-Content-Type-Options']).toBe('nosniff');
			});

			it(`${environment}: clickjacking guard is always on`, () => {
				const h = securityHeaders({ environment });
				expect(h['X-Frame-Options']).toBe('DENY');
			});

			it(`${environment}: referrer policy is always strict-origin-when-cross-origin`, () => {
				const h = securityHeaders({ environment });
				expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
			});

			it(`${environment}: COOP same-origin is on`, () => {
				const h = securityHeaders({ environment });
				expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
			});

			it(`${environment}: COR-P same-site is on`, () => {
				const h = securityHeaders({ environment });
				expect(h['Cross-Origin-Resource-Policy']).toBe('same-site');
			});

			it(`${environment}: Permissions-Policy includes camera=()`, () => {
				const h = securityHeaders({ environment });
				expect(h['Permissions-Policy']).toContain('camera=()');
			});

			it(`${environment}: Permissions-Policy permits Stripe payment origins`, () => {
				const h = securityHeaders({ environment });
				expect(h['Permissions-Policy']).toContain('"https://js.stripe.com"');
			});
		}
	});

	describe('production-only', () => {
		it('sets HSTS for 2 years with subdomain + preload eligibility', () => {
			const h = securityHeaders({ environment: 'production' });
			expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
		});

		it('does NOT set X-Robots-Tag noindex (production should be indexed)', () => {
			const h = securityHeaders({ environment: 'production' });
			expect(h['X-Robots-Tag']).toBeUndefined();
		});
	});

	describe('preview', () => {
		it('omits HSTS (avoids pinning preview hosts that may rotate certs)', () => {
			const h = securityHeaders({ environment: 'preview' });
			expect(h['Strict-Transport-Security']).toBeUndefined();
		});

		it('emits X-Robots-Tag noindex so preview deploys never reach Google', () => {
			const h = securityHeaders({ environment: 'preview' });
			expect(h['X-Robots-Tag']).toBe('noindex, nofollow');
		});
	});

	describe('development', () => {
		it('omits HSTS (does not pin localhost mkcert chain)', () => {
			const h = securityHeaders({ environment: 'development' });
			expect(h['Strict-Transport-Security']).toBeUndefined();
		});

		it('emits X-Robots-Tag noindex', () => {
			const h = securityHeaders({ environment: 'development' });
			expect(h['X-Robots-Tag']).toBe('noindex, nofollow');
		});
	});

	it('returns a fresh object per call (safe to mutate)', () => {
		const a = securityHeaders({ environment: 'production' });
		const b = securityHeaders({ environment: 'production' });
		a['X-Custom'] = 'mutated';
		expect(b['X-Custom']).toBeUndefined();
	});
});

describe('applySecurityHeaders', () => {
	it('layers the env-appropriate headers onto a fresh response', () => {
		const response = new Response('ok');
		applySecurityHeaders(response, 'production');
		expect(response.headers.get('strict-transport-security')).toBe(
			'max-age=63072000; includeSubDomains; preload'
		);
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('preserves a header the route already set (no-stomp policy)', () => {
		const response = new Response('ok', {
			headers: { 'X-Frame-Options': 'SAMEORIGIN' }
		});
		applySecurityHeaders(response, 'production');
		expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
	});

	it('does not throw on unknown environment strings', () => {
		const response = new Response('ok');
		expect(() => applySecurityHeaders(response, 'staging')).not.toThrow();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});
});
