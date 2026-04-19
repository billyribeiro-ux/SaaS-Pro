---
title: 'Bonus: Vercel Cron Jobs & Scheduled Tasks'
module: 14
lesson: 29
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-29-vercel-cron-jobs'
description: 'Schedule background work with Vercel Cron Jobs. Build authenticated cron endpoints with idempotency, leases, and observability — daily Stripe reconciliation, weekly digests, trial-expiring reminders.'
duration: 22
preview: false
---

# Bonus: Vercel cron jobs & scheduled tasks

Some work doesn't belong in a request. Daily Stripe ↔ DB reconciliation. Trial-expiring reminders. Weekly digest emails. Stale-record cleanup. You _could_ run a separate worker process, but for most SaaS workloads, **Vercel Cron Jobs** are dead-simple and cost nothing extra.

By the end you will:

- Add a Vercel cron schedule via `vercel.json`.
- Build an authenticated `/api/cron/*` endpoint that only Vercel can call.
- Make the job idempotent with a leased run-token.
- Reconcile Stripe subscriptions against your DB.
- Send trial-ending reminder emails three days before expiry.
- Wire structured logs + Sentry breadcrumbs for cron failures.

## 1. Schedule via `vercel.json`

```json
{
	"crons": [
		{ "path": "/api/cron/stripe-reconcile", "schedule": "0 3 * * *" },
		{ "path": "/api/cron/trial-reminders", "schedule": "0 9 * * *" },
		{ "path": "/api/cron/cleanup-stale-events", "schedule": "0 4 * * 0" }
	]
}
```

Cron syntax is standard: `min hour dom mon dow`. Times are UTC. Aim for off-peak. Reconciliation at 03:00 UTC, reminders at 09:00 UTC (~mid-morning Europe, before-work US).

Vercel hits each path with a GET request at the scheduled time, with an `Authorization: Bearer ${CRON_SECRET}` header.

## 2. Authenticate the endpoint

`src/lib/server/cron-auth.ts`:

```ts
import { error, type RequestEvent } from '@sveltejs/kit';
import { serverEnv } from '$lib/config/env.server';
import { logger } from '$lib/server/logger';

export function assertCronRequest(event: RequestEvent): void {
	const auth = event.request.headers.get('authorization');
	const expected = `Bearer ${serverEnv.CRON_SECRET}`;

	if (!auth || auth !== expected) {
		logger.warn({ ip: event.getClientAddress(), path: event.url.pathname }, 'cron_auth_failed');
		throw error(401, 'Unauthorized');
	}
}
```

`CRON_SECRET` is set in Vercel's project env vars. Vercel automatically populates the `Authorization` header on cron-triggered requests.

## 3. Stripe reconciliation cron

`/api/cron/stripe-reconcile/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { assertCronRequest } from '$lib/server/cron-auth';
import { acquireRunLease, releaseRunLease } from '$lib/server/cron-lease';
import { logger } from '$lib/server/logger';
import { reconcileStripeSubscriptions } from '$lib/server/billing/reconcile';

export const GET: RequestHandler = async (event) => {
	assertCronRequest(event);

	const lease = await acquireRunLease('stripe-reconcile', { ttlSec: 600 });
	if (!lease) {
		return json({ status: 'skipped', reason: 'lease_held' });
	}

	const log = logger.child({ job: 'stripe-reconcile', run_id: lease.runId });
	log.info('cron_started');

	try {
		const result = await reconcileStripeSubscriptions(log);
		log.info(result, 'cron_completed');
		return json({ status: 'ok', ...result });
	} catch (err) {
		log.error({ err: (err as Error).message }, 'cron_failed');
		throw err;
	} finally {
		await releaseRunLease('stripe-reconcile', lease.runId);
	}
};
```

## 4. Run lease (prevents overlapping runs)

If a job takes longer than its schedule (rare, but possible), or if Vercel double-fires (also rare), you don't want two reconciliation jobs racing. A lease in Postgres solves this:

```sql
create table public.cron_run_leases (
    job_name text primary key,
    run_id uuid not null,
    held_until timestamptz not null,
    started_at timestamptz not null default now()
);
```

`src/lib/server/cron-lease.ts`:

```ts
import { withAdmin } from '$lib/server/supabase-admin';

export async function acquireRunLease(
	jobName: string,
	{ ttlSec }: { ttlSec: number }
): Promise<{ runId: string } | null> {
	const runId = crypto.randomUUID();
	const heldUntil = new Date(Date.now() + ttlSec * 1000).toISOString();

	const { error } = await withAdmin().rpc('try_acquire_lease', {
		p_job_name: jobName,
		p_run_id: runId,
		p_held_until: heldUntil
	});

	if (error) return null;
	return { runId };
}

export async function releaseRunLease(jobName: string, runId: string): Promise<void> {
	await withAdmin().from('cron_run_leases').delete().eq('job_name', jobName).eq('run_id', runId);
}
```

The Postgres RPC `try_acquire_lease`:

```sql
create or replace function public.try_acquire_lease(
    p_job_name text, p_run_id uuid, p_held_until timestamptz
) returns void language plpgsql as $$
begin
    insert into public.cron_run_leases (job_name, run_id, held_until)
    values (p_job_name, p_run_id, p_held_until)
    on conflict (job_name) do update
        set run_id = excluded.run_id,
            held_until = excluded.held_until,
            started_at = now()
        where cron_run_leases.held_until < now();
    if not found then
        raise exception 'Lease held by another run';
    end if;
end;
$$;
```

Stale leases (job crashed without releasing) auto-expire after `ttlSec`. Set TTL = (worst-case duration × 2).

## 5. Reconciliation logic

`src/lib/server/billing/reconcile.ts`:

```ts
import type { Logger } from 'pino';
import Stripe from 'stripe';
import { stripe } from '$lib/server/stripe';
import { withAdmin } from '$lib/server/supabase-admin';

export async function reconcileStripeSubscriptions(log: Logger) {
	let updated = 0;
	let drift = 0;
	let cursor: string | undefined = undefined;

	do {
		const page: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
			limit: 100,
			starting_after: cursor,
			status: 'all'
		});

		for (const sub of page.data) {
			const { data: row } = await withAdmin()
				.from('subscriptions')
				.select('status, current_period_end')
				.eq('id', sub.id)
				.maybeSingle();

			const stripePeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
			const drifted =
				!row || row.status !== sub.status || row.current_period_end !== stripePeriodEnd;

			if (drifted) {
				drift++;
				await withAdmin().from('subscriptions').upsert({
					id: sub.id,
					status: sub.status,
					current_period_end: stripePeriodEnd,
					cancel_at_period_end: sub.cancel_at_period_end
				});
				updated++;
				log.warn(
					{ subscription_id: sub.id, prev: row?.status, next: sub.status },
					'drift_repaired'
				);
			}
		}

		cursor = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
	} while (cursor);

	return { updated, drift };
}
```

If `drift > 0` consistently, you have a webhook handler bug. Reconciliation catches it; investigate the gap.

## 6. Trial-ending reminders

```ts
export const GET: RequestHandler = async (event) => {
	assertCronRequest(event);
	const log = logger.child({ job: 'trial-reminders' });

	const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
	const today = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

	const { data: subs } = await withAdmin()
		.from('subscriptions')
		.select('id, user_id, trial_end, profiles(email, full_name)')
		.eq('status', 'trialing')
		.is('trial_reminder_sent_at', null)
		.gte('trial_end', threeDaysFromNow)
		.lt('trial_end', today);

	for (const sub of subs ?? []) {
		try {
			await sendTrialEndingEmail({
				to: sub.profiles.email,
				name: sub.profiles.full_name,
				trialEnd: sub.trial_end
			});
			await withAdmin()
				.from('subscriptions')
				.update({ trial_reminder_sent_at: new Date().toISOString() })
				.eq('id', sub.id);
			log.info({ subscription_id: sub.id }, 'trial_reminder_sent');
		} catch (err) {
			log.error({ err: (err as Error).message, subscription_id: sub.id }, 'trial_reminder_failed');
		}
	}

	return json({ status: 'ok', reminded: subs?.length ?? 0 });
};
```

Note the `trial_reminder_sent_at` flag — without it, every cron run would re-spam every trialing user.

## 7. Local development

Cron only fires in Vercel production. Locally, hit the endpoint manually:

```bash
curl -H "Authorization: Bearer dev-cron-secret" http://localhost:5173/api/cron/stripe-reconcile
```

Or set up a one-line shell loop that hits each cron path on the same schedule for staging environments.

## 8. Observability

Every cron job should emit structured logs (Bonus 11) and capture errors to Sentry (Bonus 12). Add a Sentry transaction:

```ts
import * as Sentry from '@sentry/sveltekit';

return Sentry.startSpan({ name: 'cron.stripe-reconcile', op: 'cron' }, async () => {
	const result = await reconcileStripeSubscriptions(log);
	return json({ status: 'ok', ...result });
});
```

Set up a Sentry alert for `cron_failed` log lines so you don't discover a broken job four weeks later.

## 9. Acceptance checklist

- [ ] `vercel.json` has a `crons` array with at least one entry.
- [ ] `assertCronRequest` checks the `Authorization` header against `CRON_SECRET`.
- [ ] `cron_run_leases` table + `try_acquire_lease` RPC.
- [ ] At least one production cron (reconciliation) is wired and tested.
- [ ] Idempotency flags (`trial_reminder_sent_at`) prevent re-firing.
- [ ] Cron failures are caught by Sentry and logged with `job:` and `run_id:`.

## What's next

Bonus 30 wraps the course with **feature flags & kill switches** — gradual rollouts, instant disable, per-tier feature gating without a deploy.
