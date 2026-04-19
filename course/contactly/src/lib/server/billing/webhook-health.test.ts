import { describe, expect, it } from 'vitest';
import { CRITICAL_AGE_MS, WARN_AGE_MS, classifyHealth } from '$lib/server/billing/webhook-health';

/**
 * Pure-classifier sweep. Boundary-heavy on purpose: getting any
 * one of these wrong is a silent SLO regression.
 */
describe('classifyHealth', () => {
	it('healthy when there are zero unprocessed rows (oldest is null)', () => {
		expect(classifyHealth(0, null)).toEqual({ status: 'healthy', httpStatus: 200 });
	});

	it('healthy even when count > 0 if oldest is null (defensive)', () => {
		// Defensive: a count > 0 with no oldest age means the
		// "oldest" read failed but the count read succeeded.
		// Reporting "healthy" here is the conservative choice — we
		// have no evidence of staleness.
		expect(classifyHealth(5, null)).toEqual({ status: 'healthy', httpStatus: 200 });
	});

	it('healthy when oldest is younger than the warn threshold', () => {
		expect(classifyHealth(1, WARN_AGE_MS - 1)).toEqual({ status: 'healthy', httpStatus: 200 });
	});

	it('degraded at the warn threshold exactly', () => {
		expect(classifyHealth(1, WARN_AGE_MS)).toEqual({ status: 'degraded', httpStatus: 200 });
	});

	it('degraded between warn and critical', () => {
		const midway = (WARN_AGE_MS + CRITICAL_AGE_MS) / 2;
		expect(classifyHealth(3, midway)).toEqual({ status: 'degraded', httpStatus: 200 });
	});

	it('degraded just below critical', () => {
		expect(classifyHealth(7, CRITICAL_AGE_MS - 1)).toEqual({ status: 'degraded', httpStatus: 200 });
	});

	it('unhealthy at the critical threshold exactly', () => {
		expect(classifyHealth(7, CRITICAL_AGE_MS)).toEqual({ status: 'unhealthy', httpStatus: 503 });
	});

	it('unhealthy well past critical', () => {
		expect(classifyHealth(99, 60 * 60 * 1000)).toEqual({ status: 'unhealthy', httpStatus: 503 });
	});

	it('exposes the canonical thresholds (locked so a sneaky rebalance shows up in review)', () => {
		expect(WARN_AGE_MS).toBe(2 * 60 * 1000);
		expect(CRITICAL_AGE_MS).toBe(10 * 60 * 1000);
	});
});
