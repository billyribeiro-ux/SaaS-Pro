<script lang="ts">
	/**
	 * Admin → Webhook health (Module 10.3).
	 *
	 * Reads the snapshot produced by `+page.server.ts` and renders
	 * a single-screen dashboard:
	 *
	 *   - A status pill (healthy / degraded / unhealthy) that
	 *     mirrors the JSON endpoint's verdict.
	 *   - Headline counters: backlog count, oldest-row age, last
	 *     measured timestamp.
	 *   - A per-event-type table for triage.
	 *   - A copy-friendly link to the JSON endpoint so an
	 *     operator can pipe the same data into curl / a monitor.
	 *
	 * The page is intentionally fully server-rendered (no
	 * onMount, no in-page polling). Refresh is a hard reload, which
	 * is the right pattern for an admin dashboard: every measurement
	 * is server-of-record, no client-state sync to hold.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	type Props = { data: PageData; form: ActionData };
	let { data, form }: Props = $props();

	let snapshot = $derived(data.snapshot);
	let loadError = $derived(data.loadError);
	let pendingEventId = $state<string | null>(null);
	let pendingBatch = $state(false);

	const STATUS_STYLES: Record<string, string> = {
		healthy: 'border-emerald-200 bg-emerald-50 text-emerald-800',
		degraded: 'border-amber-200 bg-amber-50 text-amber-800',
		unhealthy: 'border-rose-200 bg-rose-50 text-rose-800'
	};

	function formatAge(ms: number | null): string {
		if (ms === null) return '—';
		if (ms < 1000) return `${ms} ms`;
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remSeconds = seconds % 60;
		if (minutes < 60) return remSeconds === 0 ? `${minutes}m` : `${minutes}m ${remSeconds}s`;
		const hours = Math.floor(minutes / 60);
		const remMinutes = minutes % 60;
		return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
	}

	const dateFormatter = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		timeZoneName: 'short'
	});

	const OUTCOME_STYLES: Record<string, string> = {
		replayed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
		'already-processed': 'bg-slate-50 text-slate-800 border-slate-200',
		'dry-run': 'bg-sky-50 text-sky-800 border-sky-200',
		'not-found': 'bg-amber-50 text-amber-800 border-amber-200',
		failed: 'bg-rose-50 text-rose-800 border-rose-200'
	};
</script>

<header class="mb-6 flex items-baseline justify-between">
	<div>
		<h1 class="text-xl font-semibold text-slate-900">Webhook health</h1>
		<p class="text-sm text-slate-600">
			Snapshot of <code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs">stripe_events</code>
			rows whose <code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs">processed_at</code> is
			still
			<code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs">NULL</code>.
		</p>
	</div>
	<a
		href={resolve('/api/admin/webhooks/health')}
		class="text-sm text-slate-600 underline hover:text-slate-900"
		data-testid="webhook-health-json-link"
	>
		View JSON →
	</a>
</header>

{#if loadError}
	<div
		class="mb-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
		role="alert"
		data-testid="webhook-health-error"
	>
		<p class="font-medium">Could not load webhook health snapshot.</p>
		<p class="mt-1 text-xs">{loadError}</p>
	</div>
{:else if snapshot}
	<section class="grid gap-4 sm:grid-cols-3" data-testid="webhook-health-summary">
		<article class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
			<div class="text-xs tracking-wide text-slate-500 uppercase">Status</div>
			<div class="mt-2">
				<span
					class={'inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ' +
						STATUS_STYLES[snapshot.status]}
					data-testid="webhook-health-status"
				>
					{snapshot.status}
				</span>
			</div>
			<p class="mt-3 text-xs text-slate-500">
				HTTP {snapshot.httpStatus} returned by
				<code class="rounded bg-slate-100 px-1 py-0.5">/api/admin/webhooks/health</code>.
			</p>
		</article>
		<article class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
			<div class="text-xs tracking-wide text-slate-500 uppercase">Backlog</div>
			<div
				class="mt-2 text-2xl font-semibold text-slate-900"
				data-testid="webhook-health-unprocessed-count"
			>
				{snapshot.unprocessedCount}
			</div>
			<p class="mt-3 text-xs text-slate-500">unprocessed events right now</p>
		</article>
		<article class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
			<div class="text-xs tracking-wide text-slate-500 uppercase">Oldest stuck</div>
			<div
				class="mt-2 text-2xl font-semibold text-slate-900"
				data-testid="webhook-health-oldest-age"
			>
				{formatAge(snapshot.oldestUnprocessedAgeMs)}
			</div>
			<p class="mt-3 text-xs text-slate-500">
				warn at {formatAge(snapshot.thresholds.warnAgeMs)} • critical at
				{formatAge(snapshot.thresholds.criticalAgeMs)}
			</p>
		</article>
	</section>

	<section class="mt-8 rounded-lg border border-slate-200 bg-white shadow-sm">
		<header class="flex items-baseline justify-between border-b border-slate-200 px-5 py-3">
			<h2 class="text-sm font-semibold text-slate-900">Backlog by event type</h2>
			<span class="text-xs text-slate-500">
				measured {dateFormatter.format(new Date(snapshot.measuredAt))}
			</span>
		</header>
		{#if snapshot.byEventType.length === 0}
			<p class="px-5 py-6 text-sm text-slate-600" data-testid="webhook-health-empty">
				No unprocessed events. Everything we've received is acknowledged.
			</p>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
					<tr>
						<th class="px-5 py-2 font-medium">Event type</th>
						<th class="px-5 py-2 font-medium">Stuck count</th>
					</tr>
				</thead>
				<tbody data-testid="webhook-health-by-type">
					{#each snapshot.byEventType as row (row.type)}
						<tr class="border-t border-slate-100">
							<td class="px-5 py-2 font-mono text-xs text-slate-800">{row.type}</td>
							<td class="px-5 py-2 text-slate-900 tabular-nums">{row.count}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section class="mt-8 rounded-lg border border-slate-200 bg-white shadow-sm">
		<header class="flex items-baseline justify-between border-b border-slate-200 px-5 py-3">
			<div>
				<h2 class="text-sm font-semibold text-slate-900">Stuck events</h2>
				<p class="text-xs text-slate-500">
					Top {snapshot.stuckEvents.length} unprocessed by age. Replay re-runs the dispatcher for the
					row in place — Stripe is not contacted.
				</p>
			</div>
			{#if snapshot.stuckEvents.length > 0}
				<form
					method="POST"
					action="?/replayBatch"
					use:enhance={() => {
						pendingBatch = true;
						return async ({ update }) => {
							await update();
							pendingBatch = false;
						};
					}}
					data-testid="webhook-replay-batch-form"
				>
					<input type="hidden" name="dryRun" value="false" />
					<button
						type="submit"
						disabled={pendingBatch}
						class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
						data-testid="webhook-replay-batch-submit"
					>
						{pendingBatch ? 'Replaying…' : `Replay all (≤ ${data.batchReplayCap})`}
					</button>
				</form>
			{/if}
		</header>

		{#if form?.kind === 'replayBatch'}
			<div
				class="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm"
				data-testid="webhook-replay-batch-result"
			>
				<p class="font-medium text-slate-900">
					Batch replay processed {form.requested} event{form.requested === 1 ? '' : 's'}.
				</p>
				{#if form.outcomes && form.outcomes.length > 0}
					<ul class="mt-2 space-y-1 text-xs">
						{#each form.outcomes as outcome (outcome.eventId)}
							<li class="flex items-center gap-2">
								<span
									class={'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ' +
										OUTCOME_STYLES[outcome.status]}
								>
									{outcome.status}
								</span>
								<code class="font-mono text-slate-700">{outcome.eventId}</code>
								{#if outcome.status === 'failed'}
									<span class="text-rose-700">— {outcome.error}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if snapshot.stuckEvents.length === 0}
			<p class="px-5 py-6 text-sm text-slate-600" data-testid="webhook-stuck-empty">
				Nothing stuck. Excellent.
			</p>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
					<tr>
						<th class="px-5 py-2 font-medium">Event ID</th>
						<th class="px-5 py-2 font-medium">Type</th>
						<th class="px-5 py-2 font-medium">Age</th>
						<th class="px-5 py-2 text-right font-medium">Replay</th>
					</tr>
				</thead>
				<tbody data-testid="webhook-stuck-events">
					{#each snapshot.stuckEvents as event (event.id)}
						<tr class="border-t border-slate-100">
							<td class="px-5 py-2 font-mono text-xs text-slate-800">{event.id}</td>
							<td class="px-5 py-2 font-mono text-xs text-slate-700">{event.type}</td>
							<td class="px-5 py-2 text-slate-900 tabular-nums">{formatAge(event.ageMs)}</td>
							<td class="px-5 py-2 text-right">
								<form
									method="POST"
									action="?/replay"
									use:enhance={() => {
										pendingEventId = event.id;
										return async ({ update }) => {
											await update();
											pendingEventId = null;
										};
									}}
									data-testid="webhook-replay-form"
								>
									<input type="hidden" name="eventId" value={event.id} />
									<input type="hidden" name="dryRun" value="false" />
									<button
										type="submit"
										disabled={pendingEventId !== null}
										class="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
										data-testid={`webhook-replay-${event.id}`}
									>
										{pendingEventId === event.id ? 'Replaying…' : 'Replay'}
									</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if form?.kind === 'replay'}
			<footer
				class="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs"
				data-testid="webhook-replay-result"
			>
				{#if form.outcome}
					<div class="flex items-center gap-2">
						<span
							class={'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ' +
								OUTCOME_STYLES[form.outcome.status]}
						>
							{form.outcome.status}
						</span>
						<code class="font-mono text-slate-700">{form.outcome.eventId}</code>
						{#if form.outcome.status === 'failed' && 'error' in form.outcome}
							<span class="text-rose-700">— {form.outcome.error}</span>
						{/if}
					</div>
				{:else if 'error' in form && form.error}
					<p class="text-rose-700">{form.error}</p>
				{/if}
			</footer>
		{/if}
	</section>
{/if}
