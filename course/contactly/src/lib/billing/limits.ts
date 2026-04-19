/**
 * Per-tier resource limits — the single source of truth for "what
 * does each plan get?"
 *
 * RULES OF ENGAGEMENT
 * -------------------
 * - Limits live in code, not the database. They're product policy,
 *   not customer data. Putting them in a migration would make every
 *   pricing tweak a deploy-blocking schema change with no rollback
 *   path. Putting them in code means they ship with the rest of the
 *   feature gates that read them, in a single PR, reviewed together.
 *
 * - `null` means "unlimited" — explicitly. We pick `null` over
 *   `Infinity` so consumers MUST pattern-match (`limit === null`
 *   ?: unlimited) instead of accidentally relying on `> Infinity`
 *   never being true. TypeScript catches the missing branch.
 *
 * - The Starter cap is intentionally low enough to nudge upgrades
 *   from teams who actually use the product, but high enough that
 *   a casual evaluator can sign up and load real-looking data
 *   before hitting the wall. 50 contacts is the standard "you can
 *   build a small CRM and feel the value" threshold across CRM
 *   SaaS comparisons; we'll A/B this once we have funnel data.
 *
 * - Any new resource limit (e.g. "deals per pipeline", "API calls
 *   per day") should land in this file, not scattered across
 *   feature-area modules. That keeps the pricing page, the gates,
 *   and the docs from drifting.
 */
import type { Tier } from './lookup-keys';

/**
 * Maximum contacts allowed per organization, by tier.
 *
 * `null` ⇒ unlimited (functionally; we still cap at the underlying
 * Postgres `bigint`).
 */
export const CONTACT_CAP: Readonly<Record<Tier, number | null>> = {
	starter: 50,
	pro: null,
	business: null
};

/**
 * Convenience accessor used by both the gate and the marketing copy.
 *
 * Keeping this as a function (rather than letting consumers index
 * `CONTACT_CAP` directly) lets us swap the source — e.g. read from
 * a remote-config flag for a temporary promo — without touching
 * call-sites.
 */
export function contactCapFor(tier: Tier): number | null {
	return CONTACT_CAP[tier];
}
