import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const subsSelect = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({
	withAdmin: vi.fn((_op, _actor, fn) =>
		fn({
			from: (table: string) => {
				if (table !== 'stripe_subscriptions') {
					throw new Error(`unexpected table ${table}`);
				}
				return { select: subsSelect };
			}
		})
	)
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/**
 * Build a chained mock for:
 *
 *   admin.from('stripe_subscriptions')
 *        .select('id', { count: 'exact', head: true })
 *        .eq('user_id', userId)
 *        .not('trial_start', 'is', null)
 *
 * Resolves to `{ count, error }`.
 */
function mockTrialQuery({
	count,
	error
}: {
	count: number | null;
	error: { message: string } | null;
}) {
	const result = Promise.resolve({ count, error });
	const not = vi.fn().mockReturnValueOnce(result);
	const eq = vi.fn().mockReturnValueOnce({ not });
	subsSelect.mockReturnValueOnce({ eq });
	return { eq, not };
}

describe('billing/trial-eligibility — hasUserUsedTrial', () => {
	it('returns false for a brand-new user with no subscription history', async () => {
		mockTrialQuery({ count: 0, error: null });
		const { hasUserUsedTrial } = await import('./trial-eligibility');
		await expect(hasUserUsedTrial('user_new')).resolves.toBe(false);
	});

	it('returns true when ANY historical subscription has trial_start set', async () => {
		// canceled trial, paid-then-canceled, currently trialing — all
		// produce a non-zero count and all should suppress a new trial.
		mockTrialQuery({ count: 1, error: null });
		const { hasUserUsedTrial } = await import('./trial-eligibility');
		await expect(hasUserUsedTrial('user_returning')).resolves.toBe(true);
	});

	it('treats a null count as zero (no rows)', async () => {
		// Supabase occasionally returns null with no rows; we don't
		// want that to read as "infinite trials".
		mockTrialQuery({ count: null, error: null });
		const { hasUserUsedTrial } = await import('./trial-eligibility');
		await expect(hasUserUsedTrial('user_x')).resolves.toBe(false);
	});

	it('throws with context when the underlying query fails', async () => {
		mockTrialQuery({ count: null, error: { message: 'PG connection lost' } });
		const { hasUserUsedTrial } = await import('./trial-eligibility');
		await expect(hasUserUsedTrial('user_y')).rejects.toThrow(/PG connection lost/);
	});

	it('queries with the right filter shape: user_id eq + trial_start not null', async () => {
		const { eq, not } = mockTrialQuery({ count: 0, error: null });
		const { hasUserUsedTrial } = await import('./trial-eligibility');
		await hasUserUsedTrial('user_filter_check');
		expect(subsSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
		expect(eq).toHaveBeenCalledWith('user_id', 'user_filter_check');
		expect(not).toHaveBeenCalledWith('trial_start', 'is', null);
	});
});

describe('billing/trial-eligibility — trialDaysForNextCheckout', () => {
	it('grants the default 14 days to a first-time trialer', async () => {
		mockTrialQuery({ count: 0, error: null });
		const { trialDaysForNextCheckout, DEFAULT_TRIAL_DAYS } = await import('./trial-eligibility');
		await expect(trialDaysForNextCheckout('user_new')).resolves.toBe(DEFAULT_TRIAL_DAYS);
		// Sanity-check the policy value here so a future change to
		// the constant fails this test loudly.
		expect(DEFAULT_TRIAL_DAYS).toBe(14);
	});

	it('grants zero days to a user who has previously trialed', async () => {
		mockTrialQuery({ count: 1, error: null });
		const { trialDaysForNextCheckout } = await import('./trial-eligibility');
		await expect(trialDaysForNextCheckout('user_returning')).resolves.toBe(0);
	});
});
