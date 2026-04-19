/**
 * Contact-cap entitlement gate — fail-closed.
 *
 * THE PROBLEM
 * -----------
 * Starter is the only paid-feature wall the product currently
 * enforces, and it lives at "you can have at most N contacts in your
 * workspace". A naive check (`if (count >= cap) refuse`) is wrong in
 * three subtle ways:
 *
 *   1. Race conditions. Two concurrent inserts can both read
 *      `count = 49`, both decide they're under cap, both insert,
 *      and now the workspace has 51 contacts. We address this with
 *      Postgres at the database layer (a per-org partial unique +
 *      `count(*)` recheck inside a transaction would be the next
 *      step), but at the application layer we keep it pragmatic:
 *      we read the count immediately before the insert, and accept
 *      that the worst-case overshoot is +1 contact under heavy
 *      concurrency. That's an acceptable failure mode for a
 *      Starter-tier user; we are not running an exchange.
 *
 *   2. Silent overage on outage. If the count query fails, we
 *      MUST refuse the insert — never grant a paid resource on a
 *      DB error. That's the fail-closed half of "fail-closed."
 *
 *   3. UX without context. The wall must tell the user *why* they
 *      were stopped (cap reached) and *how* to fix it (upgrade).
 *      A 500 or "could not save" loses both. So the gate returns a
 *      structured `Decision`, not a thrown error: callers map it to
 *      a `fail(402, ...)` that the form surface can render.
 *
 * THIS MODULE'S SHAPE
 * -------------------
 * Two layers, like every other gate in the codebase:
 *
 *   - `evaluateContactCap({ tier, currentCount })` — pure decision
 *     function. Trivially unit-testable; no Supabase, no fetch, no
 *     `Date.now()`. Owns the business rule.
 *
 *   - `checkContactCap({ supabase, organizationId, tier })` — async
 *     shell. Counts the rows, hands the result to `evaluateContactCap`.
 *     Owns the I/O, the fail-closed mapping, and nothing else.
 *
 * Callers (today: contacts/+page.server.ts and contacts/new/+page.server.ts)
 * should depend on the async shell. The pure function exists so the
 * unit tests don't need a database, and so a future "evaluate
 * before showing the upgrade banner from cached count" call-site
 * can reuse the rule without re-querying.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import type { Tier } from '$lib/billing/lookup-keys';
import { contactCapFor } from '$lib/billing/limits';

/**
 * Outcome of asking "can this org add another contact?"
 *
 * `allowed: true` carries `remaining` (or `null` for unlimited)
 * so the UI can render a "X of Y used" hint without re-querying.
 *
 * `allowed: false` carries the structured reason. Today the only
 * rejection cause is the tier cap; we still tag the discriminator
 * so a future "soft pause for past_due > 7 days" branch slots in
 * without breaking call-sites.
 */
export type ContactCapDecision =
	| {
			allowed: true;
			tier: Tier;
			limit: number | null;
			used: number;
			remaining: number | null;
	  }
	| {
			allowed: false;
			reason: 'cap_reached';
			tier: Tier;
			limit: number;
			used: number;
	  }
	| {
			allowed: false;
			reason: 'unknown';
			tier: Tier;
	  };

/**
 * Pure decision: given a tier and the current row count, decide
 * whether one more insert is permitted.
 *
 * Edge cases worth stating:
 *   - `currentCount < 0` is treated as 0. Postgres `count(*)`
 *     can never return negative, but a buggy caller could; we
 *     normalize defensively rather than trust the input.
 *   - `currentCount > limit` is allowed-as-stuck: the user is
 *     already over (e.g. they downgraded from Pro to Starter and
 *     kept their 200 contacts). We don't auto-delete; the gate
 *     simply refuses *new* inserts until they prune or upgrade.
 *     `remaining` reads as 0 in that case.
 */
export function evaluateContactCap(args: { tier: Tier; currentCount: number }): ContactCapDecision {
	const { tier } = args;
	const used = Math.max(0, Math.trunc(args.currentCount));
	const limit = contactCapFor(tier);

	if (limit === null) {
		return { allowed: true, tier, limit: null, used, remaining: null };
	}

	if (used >= limit) {
		return { allowed: false, reason: 'cap_reached', tier, limit, used };
	}

	return { allowed: true, tier, limit, used, remaining: limit - used };
}

/**
 * Async shell: count the org's contacts, then evaluate.
 *
 * `head: true, count: 'exact'` makes Postgres return the count
 * without shipping any rows over the wire — much cheaper than
 * fetching ids we throw away. `exact` (vs. `estimated`) is fine
 * here because we're acting on the result; an estimate could let
 * the user squeeze in extras under cap or wrongly block a
 * legitimate insert.
 *
 * On query error we return `{ allowed: false, reason: 'unknown' }`.
 * That's the FAIL-CLOSED contract: when we can't answer with
 * confidence, the right answer is "no". Callers map this to a
 * generic "Could not verify your plan limits — try again." rather
 * than letting the insert through.
 */
export async function checkContactCap(args: {
	supabase: SupabaseClient<Database>;
	organizationId: string;
	tier: Tier;
}): Promise<ContactCapDecision> {
	const { supabase, organizationId, tier } = args;

	const { count, error: countError } = await supabase
		.from('contacts')
		.select('id', { head: true, count: 'exact' })
		.eq('organization_id', organizationId);

	if (countError || count === null) {
		console.error('[contact-cap] count query failed; failing closed', {
			organization_id: organizationId,
			tier,
			err: countError
		});
		return { allowed: false, reason: 'unknown', tier };
	}

	return evaluateContactCap({ tier, currentCount: count });
}
