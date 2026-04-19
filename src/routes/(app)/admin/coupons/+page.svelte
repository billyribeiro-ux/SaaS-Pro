<script lang="ts">
	import { enhance } from '$app/forms';
	import Card from '$components/ui/Card.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import { formatPrice } from '$utils/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let busy = $state(false);
	let mode = $state<'percent' | 'amount'>('percent');

	function describeCoupon(c: PageData['coupons'][number]) {
		if (c.percent_off != null) return `${c.percent_off}% off`;
		if (c.amount_off != null) return `${formatPrice(c.amount_off, c.currency ?? 'usd')} off`;
		return '—';
	}
</script>

{#if form?.success}
	<div class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
		{form.action} succeeded.
	</div>
{:else if form && 'error' in form && form.error}
	<div class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
		{form.error}
	</div>
{/if}

<div class="grid gap-6 lg:grid-cols-2">
	<Card>
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
			Create coupon
		</h2>
		<form
			method="POST"
			action="?/createCoupon"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
			class="grid gap-3"
		>
			<label class="text-xs">
				Name (optional)
				<input
					name="name"
					placeholder="e.g. Launch promo"
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
				/>
			</label>

			<div class="flex items-center gap-3 text-xs">
				<label class="inline-flex items-center gap-1">
					<input type="radio" bind:group={mode} value="percent" /> Percent
				</label>
				<label class="inline-flex items-center gap-1">
					<input type="radio" bind:group={mode} value="amount" /> Fixed amount
				</label>
			</div>

			{#if mode === 'percent'}
				<label class="text-xs">
					Percent off (1–100)
					<input
						name="percentOff"
						type="number"
						min="1"
						max="100"
						step="1"
						required
						class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
					/>
				</label>
			{:else}
				<div class="grid grid-cols-2 gap-2">
					<label class="text-xs">
						Amount off (cents)
						<input
							name="amountOffCents"
							type="number"
							min="1"
							step="1"
							required
							class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
						/>
					</label>
					<label class="text-xs">
						Currency
						<input
							name="currency"
							maxlength="3"
							value="usd"
							class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm uppercase dark:border-slate-700 dark:bg-slate-950"
						/>
					</label>
				</div>
			{/if}

			<label class="text-xs">
				Duration
				<select
					name="duration"
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
				>
					<option value="once">Once</option>
					<option value="repeating">Repeating</option>
					<option value="forever">Forever</option>
				</select>
			</label>

			<label class="text-xs">
				Repeating: months
				<input
					name="durationInMonths"
					type="number"
					min="1"
					placeholder="ignored unless duration = repeating"
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
				/>
			</label>

			<label class="text-xs">
				Max redemptions (optional)
				<input
					name="maxRedemptions"
					type="number"
					min="1"
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
				/>
			</label>

			<Button type="submit" loading={busy}>Create coupon</Button>
		</form>
	</Card>

	<Card>
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
			Create promotion code
		</h2>
		<form
			method="POST"
			action="?/createPromotion"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
			class="grid gap-3"
		>
			<label class="text-xs">
				Coupon
				<select
					name="couponId"
					required
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
				>
					<option value="">— pick a coupon —</option>
					{#each data.coupons as c (c.id)}
						<option value={c.id}>{c.name ?? c.id} ({describeCoupon(c)})</option>
					{/each}
				</select>
			</label>
			<label class="text-xs">
				Code (uppercase)
				<input
					name="code"
					required
					placeholder="LAUNCH50"
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm uppercase dark:border-slate-700 dark:bg-slate-950"
				/>
			</label>
			<label class="text-xs">
				Max redemptions (optional)
				<input
					name="maxRedemptions"
					type="number"
					min="1"
					class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
				/>
			</label>
			<Button type="submit" loading={busy} variant="outline">Create promotion code</Button>
		</form>
	</Card>
</div>

<div class="mt-8 grid gap-6 lg:grid-cols-2">
	<Card>
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
			Coupons ({data.coupons.length})
		</h2>
		{#if data.coupons.length === 0}
			<p class="text-sm text-slate-500">No coupons yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 text-sm dark:divide-slate-800">
				{#each data.coupons as c (c.id)}
					<li class="flex items-center justify-between py-2">
						<div class="min-w-0">
							<div class="font-mono text-xs">{c.id}</div>
							<div class="text-xs text-slate-500">{c.name ?? '—'} · {describeCoupon(c)}</div>
						</div>
						<div class="flex items-center gap-2">
							<Badge variant={c.valid ? 'success' : 'danger'}>{c.valid ? 'valid' : 'invalid'}</Badge>
							<span class="text-xs text-slate-500">
								{c.times_redeemed}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<Card>
		<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
			Promotion codes ({data.promotionCodes.length})
		</h2>
		{#if data.promotionCodes.length === 0}
			<p class="text-sm text-slate-500">No promo codes yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 text-sm dark:divide-slate-800">
				{#each data.promotionCodes as p (p.id)}
					<li class="flex items-center justify-between py-2">
						<div class="min-w-0">
							<div class="font-mono text-sm tracking-wider">{p.code}</div>
							<div class="text-xs text-slate-500">→ coupon {p.coupon_id}</div>
						</div>
						<div class="flex items-center gap-2">
							<Badge variant={p.active ? 'success' : 'default'}>{p.active ? 'active' : 'off'}</Badge>
							<span class="text-xs text-slate-500">
								{p.times_redeemed}{p.max_redemptions ? ` / ${p.max_redemptions}` : ''}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>
