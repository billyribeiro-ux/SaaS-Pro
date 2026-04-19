# 03 — Entitlements snapshot + plan badge (Module 8.3)

The `(app)` shell now knows what plan you're on. Every authenticated
screen gets the same `EntitlementSnapshot` — the badge in the nav,
`/account` (Lesson 8.4), and the contact-cap gate (Lesson 8.5) all
read from the same record loaded once per request.

## What got added

```text
src/lib/server/billing/entitlements.ts        # snapshot model + loader
src/lib/server/billing/entitlements.test.ts   # 8 pure-function tests
src/lib/components/billing/PlanBadge.svelte   # the visual surface
src/routes/(app)/+layout.server.ts            # loads + exposes the snapshot
src/lib/components/layout/AppNav.svelte       # renders the badge
src/routes/(app)/+layout.svelte               # passes entitlements through
```

## The snapshot

```ts
type EntitlementSnapshot = {
	tier: 'starter' | 'pro' | 'business';
	isPaid: boolean;
	isTrialing: boolean;
	status: SubscriptionStatus | null;
	badgeLabel: 'Starter' | 'Pro' | 'Business';
	badgeTone: 'starter' | 'paid' | 'trial' | 'past_due';
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	trialEnd: string | null;
	priceId: string | null;
};
```

Module 7.4 already gave us `tierForUser(userId)` and
`getActiveSubscription(userId)`. This module does NOT add a new
billing fact — it composes the two existing ones into a single
typed record, so the UI never has to reach back into the DB to
answer questions like "is the user on a trial?"

The shape is the public contract. Pages that import
`EntitlementSnapshot` are coupled to this file, not to the raw
Supabase row, so a future schema change (e.g. adding
`grace_period_end`) doesn't ripple into every component.

## Pure core, async shell

```ts
export function snapshotFor(args: {
	tier: Tier;
	subscription: SubscriptionRow | null;
}): EntitlementSnapshot;

export async function loadEntitlements(userId: string): Promise<EntitlementSnapshot>;
```

`snapshotFor` is the entire business logic — given a tier and a
subscription row, return the snapshot. Pure → tested directly,
without mocking Supabase. The unit test file proves:

- Starter snapshot when tier is `'starter'` (or when tier is paid
  but the row is somehow missing — defense in depth).
- Pro/Business snapshots use the right label.
- `isTrialing` is true iff `status === 'trialing'`.
- `badgeTone` is `'past_due'` for past-due subscriptions, `'trial'`
  for trialing, `'paid'` otherwise.
- `cancel_at_period_end` is exposed verbatim for `/account`.

`loadEntitlements` is a five-line async wrapper that calls
`tierForUser` + `getActiveSubscription` in **parallel** (`Promise.all`)
because the two queries are independent. Sequential awaits would
double the layout's load latency for no benefit.

## Wired into the layout, fail-closed

```ts
export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { session, user } = await safeGetSession();
	if (!user) redirect(303, `/sign-in?next=${encodeURIComponent(url.pathname)}`);

	let entitlements;
	try {
		entitlements = await loadEntitlements(user.id);
	} catch (err) {
		console.error('[app/layout] loadEntitlements failed; falling back to Starter', { err });
		entitlements = snapshotFor({ tier: 'starter', subscription: null });
	}

	return { session, user, entitlements };
};
```

Two layered failure modes:

1. **`tierForUser` fails closed inside itself** (Lesson 7.4) —
   unknown lookup_key, unknown status, or DB error all return
   `'starter'`. So even when Stripe and Supabase are healthy but
   the local mirror is stale, the gate behaves as if the user is on
   Starter. Right default for billing.

2. **The whole `loadEntitlements` call may still throw** (e.g.
   timeout, network error). The layout catches it and falls back to
   the Starter snapshot. The user still sees the app shell — they
   just see Starter limits applied for the duration of the outage.
   A 500 on every authenticated page during a transient Supabase
   blip would be a much worse UX.

## The badge

```svelte
<PlanBadge entitlements={data.entitlements} size="sm" />
```

Pure presentation. `entitlements.badgeLabel` and `badgeTone` already
encode every decision; the component just maps tone → Tailwind
classes. Four tones:

- **Starter** — neutral grey. Doesn't shout at users who are happy
  on the free tier.
- **Paid** — solid brand fill. The healthy state.
- **Trial** — outlined brand-color, signals "paid but conditional."
- **Past due** — amber. Action required. Stripe is retrying the
  charge; the user keeps the paid tier (we don't gate UX during
  retries — Stripe is the boss) but they should fix payment before
  grace expires.

The badge wraps a link to `/account` so a user who notices a "Past
due" or "Trial" suffix can act on it in one click. Same hit target
as the email link next to it; the nav has exactly one
account/billing entry point.

## Why pre-resolve in the layout, not in each page?

The badge needs entitlements on EVERY authenticated screen. If we
had each page do the resolution itself, navigating across N pages
would do N redundant calls. Doing it in the layout collapses this
into one call per request, and any child page that needs richer
data (`/account` showing `currentPeriodEnd`, `/contacts/new`
checking the cap) reads it from `parent()` — no extra query.

This pattern matches how the (app) layout already resolves
`session` + `user` once and exposes them to children.

## What's NOT in this lesson

- **No `/account` plan card.** That's Lesson 8.4. The snapshot is
  already exposed; 8.4 just reads it and renders.
- **No actual gate enforcement.** The badge is informational
  only. Lesson 8.5 wires the snapshot into a server-side guard on
  `/contacts/new` so a Starter user trying to exceed 25 contacts is
  refused at the action, not just hidden in the UI.
- **No "upgrade" CTA** in the badge. The badge link goes to
  `/account` because that's where the upgrade flow will live in
  Lesson 8.4.

## Next

Lesson 8.4: render the entitlement snapshot on `/account` as a
"Plan" card — current tier, status, period end, cancel-at-period
state, and an "Upgrade" CTA pointing at `/pricing`. Once Module 9
ships Checkout, the same card grows a "Manage billing" button
pointing at the Stripe Billing Portal.
