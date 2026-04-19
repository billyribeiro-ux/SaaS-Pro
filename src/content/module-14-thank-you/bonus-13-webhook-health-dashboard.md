---
title: 'Bonus: Webhook Health Dashboard'
module: 14
lesson: 13
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-13-webhook-health-dashboard'
description: 'Two surfaces over the same health snapshot: a Bearer-protected JSON endpoint that UptimeRobot/Datadog can poll for 200/503, and a human admin dashboard with status pills, backlog age, and per-event-type breakdown.'
duration: 28
preview: false
---

# Bonus: Webhook health dashboard

Stripe sends a webhook. Your endpoint is down for 90 seconds. Stripe retries. Your endpoint is back. The retry succeeds. Nothing visible to the user, no alert fired, you don't even know it happened.

Now imagine the same scenario, but your endpoint stays broken for 12 hours overnight because the new schema migration silently broke the `customer.subscription.updated` handler. By the time you wake up, 4,000 subscription state transitions are stuck in a queue, your admin dashboard shows wrong subscription tiers, support tickets are piling up, and you have no idea where to start triaging.

This lesson builds the cheap, durable answer: a **webhook health surface** with two faces — a JSON endpoint a monitor can poll for 200/503, and a human dashboard that shows _where_ the backlog is when an alert fires.

By the end of this lesson you will:

- Add a `is_platform_admin` boolean to `profiles` with a BEFORE-UPDATE trigger that prevents self-promotion.
- Create a `requireAdminOrToken(event)` dual-principal gate that 404s every unauthorised caller (no 401/403 leakage).
- Implement `classifyHealth` — a pure, threshold-driven classifier mapping `(count, oldest_age)` to `'healthy' | 'degraded' | 'unhealthy'` + an HTTP status.
- Build `/api/admin/webhooks/health` (JSON, Bearer-token or admin-user gated) for monitor polling.
- Build `/admin/webhooks` (human dashboard) with status pills, backlog count, oldest age, and per-event-type breakdown.
- Make the partial index `stripe_events_unprocessed_idx` from Module 6.4 do the heavy lifting so the queries scale `O(stuck rows)`, not `O(total events)`.

## 1. Why a schema flag (not an env-var allow-list)

The temptation is `ADMIN_EMAILS=alice@x.com,bob@y.com`. Resist it:

- **Rotation requires a redeploy.** Adding a new on-call engineer means a PR, a build, and a deploy. A schema flag is one row's UPDATE — instant, auditable, identical in dev/preview/prod.
- **RLS can't reference an env var.** `is_platform_admin` is queryable from policies, joins, and views. There is no comparable trick for a hard-coded list of emails.
- **Separation of concerns.** Admin elevation is a database-only operation; the application has no way to express it. A compromised app pod cannot escalate.

The catch: a signed-in user can already PATCH their own `profiles` row. Without a guard, they ship `{ "is_platform_admin": true }` and walk in. The fix is a BEFORE-UPDATE trigger that pins the column for non-service-role callers.

## 2. The migration

`supabase/migrations/<timestamp>_platform_admin.sql`:

```sql
alter table public.profiles
add column is_platform_admin boolean not null default false;

create index profiles_platform_admin_idx
on public.profiles (id)
where is_platform_admin;

create or replace function public.profiles_protect_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    -- Only service_role and the postgres superuser can change the flag.
    -- Any other path silently pins it to its old value.
    if current_user in ('service_role', 'postgres') then
        return new;
    end if;
    new.is_platform_admin = old.is_platform_admin;
    return new;
end;
$$;

create trigger profiles_protect_admin_flag_trg
before update on public.profiles
for each row
execute function public.profiles_protect_admin_flag();
```

The trigger pins the field silently — no error, no leakage. Promotion becomes a service-role-only operation: a DBA `update`, a migration, or a server-side admin tool using your `withAdmin(...)` client.

## 3. The dual-principal admin gate

Create `src/lib/server/auth/admin.ts`:

```ts
import { error, type RequestEvent } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { env as serverEnv } from '$env/dynamic/private';

export type AdminPrincipal =
	| { kind: 'token'; reason: 'ops_api_token' }
	| { kind: 'user'; userId: string };

function tryBearerToken(event: RequestEvent): AdminPrincipal | null {
	const expected = serverEnv.OPS_API_TOKEN ?? '';
	if (expected.length === 0) return null;

	const header = event.request.headers.get('authorization')?.trim() ?? '';
	const match = header.match(/^bearer\s+(.+)$/i);
	if (!match) return null;

	const got = match[1].trim();
	const a = Buffer.from(expected, 'utf8');
	const b = Buffer.from(got, 'utf8');
	const max = Math.max(a.length, b.length);
	const aPad = Buffer.concat([a, Buffer.alloc(max - a.length)]);
	const bPad = Buffer.concat([b, Buffer.alloc(max - b.length)]);
	if (!timingSafeEqual(aPad, bPad) || a.length !== b.length) return null;

	return { kind: 'token', reason: 'ops_api_token' };
}

async function tryAdminUser(event: RequestEvent): Promise<AdminPrincipal | null> {
	const { user } = await event.locals.safeGetSession();
	if (!user) return null;
	const { data } = await event.locals.supabase
		.from('profiles')
		.select('is_platform_admin')
		.eq('id', user.id)
		.maybeSingle();
	if (!data?.is_platform_admin) return null;
	return { kind: 'user', userId: user.id };
}

export async function requireAdminOrToken(event: RequestEvent): Promise<AdminPrincipal> {
	const tokenPrincipal = tryBearerToken(event);
	if (tokenPrincipal) return tokenPrincipal;
	const userPrincipal = await tryAdminUser(event);
	if (userPrincipal) return userPrincipal;
	throw error(404, 'Not Found');
}
```

Three properties matter:

1. **Discriminated principal.** Routes that need to record "who did this" branch on `kind`; the audit shape for an automated monitor (no user id) is meaningfully different from a human admin (user id known).
2. **404, never 401/403.** A 401 from `/admin/*` would tell a scraper "there's something here, brute-force the auth"; a 404 says "nothing here, move on".
3. **Constant-time bearer comparison.** `timingSafeEqual` requires equal-length buffers; mismatched lengths throw synchronously, which is itself a timing leak. We pad to the longer of the two and AND the length-equality bit at the end.

When `OPS_API_TOKEN` is empty (the local-dev default), the bearer branch short-circuits to `null` without comparison — no surprise behaviour.

## 4. The classifier

Pure function. Maps two numbers to a verdict + HTTP status:

```ts
export const WARN_AGE_MS = 2 * 60 * 1000; // 2 minutes
export const CRITICAL_AGE_MS = 10 * 60 * 1000; // 10 minutes

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export function classifyHealth(input: { count: number; oldestAgeMs: number | null }): {
	status: HealthStatus;
	httpStatus: 200 | 503;
} {
	const { count, oldestAgeMs } = input;
	if (count === 0 || oldestAgeMs === null) return { status: 'healthy', httpStatus: 200 };
	if (oldestAgeMs < WARN_AGE_MS) return { status: 'healthy', httpStatus: 200 };
	if (oldestAgeMs < CRITICAL_AGE_MS) return { status: 'degraded', httpStatus: 200 };
	return { status: 'unhealthy', httpStatus: 503 };
}
```

| Input                                 | Verdict       | HTTP |
| ------------------------------------- | ------------- | ---- |
| `count == 0` or `oldestAgeMs == null` | `'healthy'`   | 200  |
| `oldestAgeMs < 2 min`                 | `'healthy'`   | 200  |
| `2 min ≤ oldestAgeMs < 10 min`        | `'degraded'`  | 200  |
| `oldestAgeMs ≥ 10 min`                | `'unhealthy'` | 503  |

Why these thresholds? Stripe retries with exponential backoff — the first three retries fire within a minute, so a one-minute-old stuck row is **expected** during a real, recoverable Stripe outage. After 10 minutes Stripe is well past the early-retry window; if we're still stuck, the issue is not transient and the on-call needs paging.

`'degraded'` is the visible-but-not-paging zone: the dashboard goes amber, the JSON endpoint stays 200, the monitor doesn't fire. Paging at every Stripe blip burns the on-call's pager credibility.

## 5. The reads

`getWebhookHealth(log)` runs three parallel queries — count, oldest, per-type buckets — every one of which rides `stripe_events_unprocessed_idx` (a partial index on `processed_at IS NULL`).

```ts
import type { Logger } from '$lib/server/logger';
import { withAdmin } from '$lib/server/supabase-admin';

const MAX_PER_TYPE_BUCKETS = 25;

export async function getWebhookHealth(log: Logger) {
	const sb = withAdmin();
	const [{ count }, { data: oldestRow }, { data: bucketRows }] = await Promise.all([
		sb.from('stripe_events').select('*', { head: true, count: 'exact' }).is('processed_at', null),
		sb
			.from('stripe_events')
			.select('received_at')
			.is('processed_at', null)
			.order('received_at', { ascending: true })
			.limit(1)
			.maybeSingle(),
		sb
			.from('stripe_events')
			.select('event_type')
			.is('processed_at', null)
			.order('received_at', { ascending: true })
			.limit(500)
	]);

	const oldestUnprocessedAt = oldestRow?.received_at ?? null;
	const oldestAgeMs = oldestUnprocessedAt
		? Date.now() - new Date(oldestUnprocessedAt).getTime()
		: null;

	const buckets = new Map<string, number>();
	for (const row of bucketRows ?? []) {
		buckets.set(row.event_type, (buckets.get(row.event_type) ?? 0) + 1);
	}
	const byEventType = [...buckets.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_PER_TYPE_BUCKETS)
		.map(([type, count]) => ({ type, count }));

	const verdict = classifyHealth({ count: count ?? 0, oldestAgeMs });

	log.info({ ...verdict, count: count ?? 0, oldestAgeMs }, 'webhook-health snapshot');

	return {
		status: verdict.status,
		httpStatus: verdict.httpStatus,
		unprocessedCount: count ?? 0,
		oldestUnprocessedAt,
		oldestUnprocessedAgeMs: oldestAgeMs,
		byEventType,
		thresholds: { warnAgeMs: WARN_AGE_MS, criticalAgeMs: CRITICAL_AGE_MS },
		measuredAt: new Date().toISOString()
	};
}
```

Even at 100k+ events of history this whole call is well under 10 ms in practice because the index is `O(stuck rows)`, not `O(total events)`.

## 6. The JSON endpoint

`src/routes/api/admin/webhooks/health/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { requireAdminOrToken } from '$lib/server/auth/admin';
import { getWebhookHealth } from '$lib/server/billing/webhook-health';

export async function GET(event) {
	await requireAdminOrToken(event);
	const snapshot = await getWebhookHealth(event.locals.logger);
	return json(snapshot, {
		status: snapshot.httpStatus,
		headers: { 'cache-control': 'no-store' }
	});
}
```

`Cache-Control: no-store` is mandatory — a CDN that caches even a "healthy" 200 will silently mask the next regression.

A monitor that polls every 60 seconds with the bearer token gets the verdict in `httpStatus` directly, so the alert rule is just **"fire when /api/admin/webhooks/health returns non-200"**.

## 7. The human dashboard

`/admin/webhooks/+page.server.ts` reads the same snapshot:

```ts
export async function load(event) {
	await requireAdminOrToken(event);
	try {
		const snapshot = await getWebhookHealth(event.locals.logger);
		return { snapshot, loadError: null };
	} catch (err) {
		event.locals.logger.error({ err: String(err) }, 'webhook-health load failed');
		return { snapshot: null, loadError: 'Failed to load webhook health snapshot.' };
	}
}
```

The `loadError` path is a **soft fail** — a Postgres hiccup on this page should still render the chrome and an explanatory banner, not a generic 500 that the on-call has to ssh into something to interpret.

The page is intentionally fully server-rendered (no `onMount`, no in-page polling). Refresh is a hard reload, which is the right pattern for an admin dashboard: every measurement is server-of-record, no client state to sync.

## 8. Promoting a user — the runbook

```sql
update public.profiles
set is_platform_admin = true
where email = 'oncall@contactly.io';
```

Run from the Supabase SQL editor or a service-role psql session. The `profiles_protect_admin_flag` trigger short-circuits for service-role / postgres so the UPDATE goes through. The admin sees `/admin` on their next request.

Demote with the symmetric statement.

## 9. Tests

Two pure suites, ~18 cases:

```ts
describe('classifyHealth', () => {
	it('healthy when count is 0', () => {
		expect(classifyHealth({ count: 0, oldestAgeMs: null })).toEqual({
			status: 'healthy',
			httpStatus: 200
		});
	});
	it('healthy when oldest is younger than WARN_AGE_MS', () => {
		expect(classifyHealth({ count: 1, oldestAgeMs: 60_000 })).toEqual({
			status: 'healthy',
			httpStatus: 200
		});
	});
	it('degraded between WARN and CRITICAL', () => {
		expect(classifyHealth({ count: 1, oldestAgeMs: 5 * 60_000 })).toEqual({
			status: 'degraded',
			httpStatus: 200
		});
	});
	it('unhealthy at or above CRITICAL', () => {
		expect(classifyHealth({ count: 1, oldestAgeMs: 10 * 60_000 })).toEqual({
			status: 'unhealthy',
			httpStatus: 503
		});
	});
});
```

Plus admin-gate tests covering bearer accept/reject, empty-token disables branch, whitespace + scheme case tolerance, signed-in admin/non-admin, profile-read failure, no session.

## 10. Acceptance checklist

- [ ] `is_platform_admin` column + trigger migration applied.
- [ ] `OPS_API_TOKEN` validated as `''` or ≥32 chars in your env schema.
- [ ] `requireAdminOrToken` returns a discriminated principal, throws 404 on every other path.
- [ ] Bearer comparison is constant-time and bypassed when token env is empty.
- [ ] `classifyHealth` is exported and has its own boundary-sweep tests.
- [ ] `/api/admin/webhooks/health` returns the snapshot with `Cache-Control: no-store` and the classifier-picked status.
- [ ] `/admin/webhooks` renders status pill, count, oldest age, per-type table, and degrades softly on Postgres errors.
- [ ] Self-PATCHing `is_platform_admin` from a signed-in user is silently ignored (verified by SQL trace or test).

## What's next

Bonus 14 builds the **replay tool** that turns this dashboard into action: stuck `evt_…` next to a "Replay" button that re-runs the dispatcher and updates the snapshot in real time.
