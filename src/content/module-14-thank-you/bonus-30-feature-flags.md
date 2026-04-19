---
title: 'Bonus: Feature Flags & Kill Switches'
module: 14
lesson: 30
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-30-feature-flags'
description: 'Build a lightweight feature-flag system with deterministic rollouts, per-user/per-tier targeting, and admin kill switches. Ship dark, roll out gradually, and disable broken features without redeploying.'
duration: 25
preview: false
---

# Bonus: Feature flags & kill switches

The most senior engineering move in a SaaS is **shipping dark**. Merge code that's behind a flag turned off. Turn it on for one user. Then 1%. Then 50%. Then everyone. If something breaks at 1%, you flip a switch — no rollback, no redeploy.

This is the difference between deploys you dread and deploys you barely notice.

You don't need LaunchDarkly to start. A single table, a small evaluator, and a typed API give you 80% of the value. By the end of this lesson you will:

- Define a `feature_flags` table with rules (boolean, percentage rollout, tier-based, user list).
- Build a typed `flags.isEnabled(name, ctx)` API with deterministic hashing for percentage rollouts.
- Cache flag definitions in-memory with a 30s TTL to avoid hammering the DB.
- Build an admin UI to flip flags and view distribution.
- Wire flags into both server (`+page.server.ts`) and client (`$state` store) code.
- Treat unknown flag names as **off** (fail closed for new code, fail open for kill switches via inversion).

## 1. The table

```sql
create type public.flag_type as enum ('boolean', 'percentage', 'tier', 'user_list');

create table public.feature_flags (
    name text primary key,
    description text not null default '',
    type public.flag_type not null default 'boolean',
    enabled boolean not null default false,
    rollout_percent int not null default 0 check (rollout_percent between 0 and 100),
    allowed_tiers text[] not null default '{}',
    user_ids uuid[] not null default '{}',
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id)
);

create index feature_flags_updated_at_idx on public.feature_flags (updated_at);
alter table public.feature_flags enable row level security;
-- Read by anon (we cache, no PII).
create policy "Read flags" on public.feature_flags for select using (true);
-- Write by platform admins only (see Bonus 13).
```

## 2. The evaluator

`src/lib/server/flags.ts`:

```ts
import { withAdmin } from '$lib/server/supabase-admin';
import { createHash } from 'node:crypto';

export type FlagContext = {
	userId?: string | null;
	tier?: string | null;
};

type FlagRow = {
	name: string;
	type: 'boolean' | 'percentage' | 'tier' | 'user_list';
	enabled: boolean;
	rollout_percent: number;
	allowed_tiers: string[];
	user_ids: string[];
};

let cache: { rows: Map<string, FlagRow>; expiresAt: number } | null = null;
const TTL_MS = 30_000;

async function loadFlags(): Promise<Map<string, FlagRow>> {
	if (cache && cache.expiresAt > Date.now()) return cache.rows;

	const { data, error } = await withAdmin()
		.from('feature_flags')
		.select('name, type, enabled, rollout_percent, allowed_tiers, user_ids');

	if (error) {
		// Network failure — return last known cache rather than fail closed everywhere.
		if (cache) return cache.rows;
		return new Map();
	}

	const map = new Map<string, FlagRow>();
	for (const row of data ?? []) map.set(row.name, row as FlagRow);
	cache = { rows: map, expiresAt: Date.now() + TTL_MS };
	return map;
}

export async function isEnabled(name: string, ctx: FlagContext = {}): Promise<boolean> {
	const flags = await loadFlags();
	const flag = flags.get(name);
	if (!flag || !flag.enabled) return false;

	switch (flag.type) {
		case 'boolean':
			return true;

		case 'user_list':
			return ctx.userId != null && flag.user_ids.includes(ctx.userId);

		case 'tier':
			return ctx.tier != null && flag.allowed_tiers.includes(ctx.tier);

		case 'percentage': {
			if (!ctx.userId) return false;
			const bucket = bucketFor(name, ctx.userId);
			return bucket < flag.rollout_percent;
		}
	}
}

export function bucketFor(flagName: string, userId: string): number {
	const h = createHash('sha256').update(`${flagName}:${userId}`).digest();
	return h.readUInt32BE(0) % 100;
}

export function invalidateFlagCache(): void {
	cache = null;
}
```

Two important properties:

1. **Deterministic.** `bucketFor("dark-mode", "user-123")` always returns the same number. The same user is always in the same bucket — no flapping between requests.
2. **Per-flag salting.** Hashing `flagName:userId` (not just `userId`) means a user who's bucket-3 for `dark-mode` is independently bucketed for `new-onboarding`. No correlation between flags.

## 3. Wiring into a load function

`/account/+page.server.ts`:

```ts
import { isEnabled } from '$lib/server/flags';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	const tier = await getTierForUser(user?.id);

	return {
		flags: {
			newSettingsLayout: await isEnabled('new-settings-layout', { userId: user?.id, tier }),
			betaExportButton: await isEnabled('beta-export-button', { userId: user?.id, tier })
		}
	};
};
```

`+page.svelte`:

```svelte
<script lang="ts">
	let { data } = $props();
</script>

{#if data.flags.newSettingsLayout}
	<NewSettingsPage />
{:else}
	<LegacySettingsPage />
{/if}
```

Pass flags from the server to the client via the load function so SSR and CSR agree. **Never call the evaluator from client-side runtime code** — flags would leak the rule definitions and you'd hit Postgres on every page transition.

## 4. The admin UI

A platform-admin route (gated by Bonus 13's `is_platform_admin`) that lists every flag with toggles:

```svelte
<table>
	<thead>
		<tr>
			<th>Name</th>
			<th>Type</th>
			<th>Status</th>
			<th>Rollout</th>
		</tr>
	</thead>
	<tbody>
		{#each data.flags as flag (flag.name)}
			<tr>
				<td>{flag.name}</td>
				<td>{flag.type}</td>
				<td>
					<form method="POST" action="?/toggle" use:enhance>
						<input type="hidden" name="name" value={flag.name} />
						<button>{flag.enabled ? 'On' : 'Off'}</button>
					</form>
				</td>
				<td>
					{#if flag.type === 'percentage'}
						<form method="POST" action="?/setRollout" use:enhance>
							<input type="hidden" name="name" value={flag.name} />
							<input name="percent" type="number" min="0" max="100" value={flag.rollout_percent} />
							<button>Save</button>
						</form>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>
```

The `toggle` action invalidates the cache after writing:

```ts
import { invalidateFlagCache } from '$lib/server/flags';

export const actions: Actions = {
	toggle: async ({ request, locals }) => {
		await requirePlatformAdmin(locals);
		const data = await request.formData();
		const name = String(data.get('name'));
		const { data: cur } = await withAdmin()
			.from('feature_flags')
			.select('enabled')
			.eq('name', name)
			.single();
		await withAdmin()
			.from('feature_flags')
			.update({ enabled: !cur?.enabled, updated_at: new Date().toISOString() })
			.eq('name', name);
		invalidateFlagCache();
		return { ok: true };
	}
};
```

## 5. Kill switches (the inverse pattern)

A "kill switch" is a flag that, when on, **disables** something:

```ts
const stripeWebhooksDisabled = await isEnabled('kill.stripe-webhooks');
if (stripeWebhooksDisabled) {
	return json({ status: 'disabled' }, { status: 503 });
}
```

When Stripe is having an incident and your queue is melting, flip `kill.stripe-webhooks` on, drain, fix, flip off. No deploy.

Naming convention: `kill.*` for kill switches, plain names for feature gates. The convention makes intent obvious in code review.

## 6. Gradual rollout playbook

1. Ship the code behind a flag, type `boolean`, `enabled: false`. Nothing changes for users.
2. Switch to type `user_list`, add your own user ID. Verify in production. Add a few teammates.
3. Switch to type `percentage`, `rollout_percent: 1`. Watch error rates and Sentry for ~30 min.
4. Bump to 5%, then 25%, then 50%, then 100%. Pause at any percentage if metrics look off.
5. Once stable for a week at 100%: delete the flag check from code. Remove the row from `feature_flags`. The flag has graduated.

Step 5 matters. Old flags accumulate as cognitive debt. A flag that's been at 100% for three months is just dead `if`-branches.

## 7. Tests

Unit:

- `bucketFor` is deterministic across calls.
- `bucketFor` distribution is roughly uniform across 1000 sample IDs (each bucket within 5–15%).
- Boolean flag returns `enabled` value.
- Percentage flag with 50% includes ~50% of users (sampled).
- Tier flag includes user when tier matches.
- User-list flag includes user when ID matches.
- Unknown flag name returns `false`.
- Cache reload after `invalidateFlagCache()`.

Integration:

- `loadFlags()` returns last cache when DB read fails.

## 8. When to graduate to LaunchDarkly / Statsig

This is enough for ~80% of SaaS use cases up through ~$10M ARR. Reach for a hosted system when you need:

- Multi-environment promotion workflows (dev → staging → prod) with audit trails.
- A/B testing with statistical analysis baked in.
- SDK-side evaluation for mobile apps that need to work offline.
- Compliance auditing (SOC 2 evidence trails).

The interface (`isEnabled(name, ctx)`) is the same. Swapping the implementation is a 50-line change.

## 9. Acceptance checklist

- [ ] `feature_flags` table with `flag_type` enum, RLS read for all, write for admins.
- [ ] `isEnabled(name, ctx)` evaluator with all four flag types.
- [ ] `bucketFor` is deterministic and per-flag salted.
- [ ] In-memory cache with 30s TTL and cache-on-error fallback.
- [ ] Admin UI to toggle flags and set rollout percentages.
- [ ] Cache invalidation on writes.
- [ ] Naming convention: `kill.*` for kill switches.
- [ ] Tests for evaluator, bucketing distribution, and cache fallback.

## What you've built

You've shipped a course that mirrors what real, senior engineering teams ship. From the basics (auth, CRUD) through Stripe integration, observability, deployment hardening, deterministic testing harnesses, and operational tooling — every pattern here is the one you'd reach for at a series-B startup or a Big Tech team building internal SaaS.

Take the patterns. Take the code. Adapt them to whatever you're building next.

Now go ship something.
