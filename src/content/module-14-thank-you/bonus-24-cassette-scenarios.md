---
title: 'Bonus: Authoring Webhook Scenarios'
module: 14
lesson: 24
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-24-cassette-scenarios'
description: 'Author four canonical cassettes (subscribe, cancel, fail, recover) and wire them through the production receiver with surgical mocks. Plus the vi.hoisted gotcha that quietly destroyed weeks of test runs.'
duration: 20
preview: false
---

# Bonus: Authoring webhook scenarios

You have the format (Bonus 21), the signing helper (Bonus 22), and the driver (Bonus 23). Now you need actual scenarios — the cassettes that capture the four end-to-end stories your receiver has to handle correctly.

This lesson authors four cassettes covering the full subscription lifecycle and wires them through the real `POST /api/webhooks/stripe` handler with surgical mocks on the dispatch table and storage layer. You'll also meet the `vi.hoisted` gotcha that quietly destroys weeks of test runs.

By the end of this lesson you will:

- Author four canonical cassettes: subscribe, cancel, fail, recover.
- Use **hand-authored** ids (not real Stripe ids) so cassettes don't drift between developer machines.
- Wire surgical mocks on `dispatchStripeEvent` and the storage layer using `vi.hoisted` to avoid the closure-over-`undefined` trap.
- Adapt SvelteKit's `error()`-throwing handlers into a `Response`-returning transport for the cassette driver.
- Test the three cross-cassette behaviours: idempotency on duplicate delivery, storage failure, and dispatcher partial failure.

## 1. The four cassettes

| Cassette                        | Events | Story                                              |
| ------------------------------- | ------ | -------------------------------------------------- |
| `subscribe-pro-monthly-keep`    | 5      | Happy path: signup → trial → first invoice         |
| `cancel-pro-monthly-immediate`  | 2      | `updated`(`cancel_at_period_end=true`) → `deleted` |
| `payment-failed-pro-monthly`    | 3      | `finalized` → `payment_failed` → `past_due`        |
| `recover-after-payment-failure` | 2      | `invoice.paid` → sub flips back to `active`        |

The four cover **subscribe, cancel, fail, recover** — the closed loop of involuntary churn. The fail and recover cassettes share customer + subscription + invoice ids so they can be played back-to-back to test the dunning recovery path.

## 2. Authoring conventions

Hand-author cassettes; don't record them from real Stripe:

- Real recordings carry test-account ids that drift between developer machines. Hand-authored ids (`cus_test_cancel`, `sub_test_fail`) are stable forever.
- Real recordings carry secret-shaped fields (api versions, request ids, livemode flags) that need diff-review before commit. Hand-authored events skip the laundering step.
- A future recorder mode can produce authoring-grade cassettes; until then, hand-authoring is faster for the ~4 scenarios you actually need.

Skeleton for a cassette event:

```json
{
	"offsetMs": 250,
	"event": {
		"id": "evt_test_cancel_initiated",
		"object": "event",
		"type": "customer.subscription.updated",
		"created": 1745077200,
		"livemode": false,
		"data": {
			"object": {
				"id": "sub_test_cancel",
				"object": "subscription",
				"customer": "cus_test_cancel",
				"status": "active",
				"cancel_at_period_end": true,
				"current_period_end": 1747669200,
				"items": {
					"data": [{ "price": { "id": "price_pro_monthly", "lookup_key": "pro_monthly" } }]
				}
			}
		}
	}
}
```

Keep `data.object` minimal — only the fields your handlers actually read. Bloat makes cassettes hard to diff in code review.

## 3. The scenario test file

Three concerns, in order:

1. **Surgical mocks** — what to mock and what to keep real.
2. **Spies via `vi.hoisted`** — the only safe way to share spy references between mock factories and test bodies.
3. **`HttpError` adaptation** — turning SvelteKit's `error()` throws into `Response` objects the driver can read.

### 3a. Surgical mocks

Mock exactly two modules:

- **`$lib/server/stripe-events`** — the dispatch table. Replace with a `vi.fn()` that records every call. The receiver's HTTP layer (signature verification, body reading, idempotency arbitration, response shape) runs FOR REAL.
- **`$lib/server/stripe-events-store`** — the idempotency layer. Default: every event is `'fresh'`. Per-test overrides simulate `'already-processed'` and `'failed'`.

Why two and not zero?

- **Speed.** Mocking the storage + dispatch layer keeps scenario tests at ~5–10 ms each.
- **Decoupling.** The handlers behind the dispatch table are tested in `src/lib/server/billing/*.test.ts` with full DB-call coverage. The scenario test asserts on **what the receiver does with the event**, not on what each handler does. Asserting both here would duplicate the per-handler tests.

A future "full-integration" mode could load the same cassettes, unmock the storage layer, and assert against a real Supabase test schema. The cassette JSON is reusable — the test driver isn't opinionated about how the dispatched events are absorbed.

### 3b. Spies via `vi.hoisted`

`vi.mock` factory bodies are hoisted above any `const` declarations, so the naive shape:

```ts
// ❌ BROKEN — spy is undefined when the factory runs
const dispatchSpy = vi.fn();
vi.mock('$lib/server/stripe-events', () => ({
	dispatchStripeEvent: dispatchSpy
}));
```

…closes over `undefined` in the factory at hoisting time. Use `vi.hoisted` to share spy references between the factories and the test bodies:

```ts
// ✅ Correct
const spies = vi.hoisted(() => ({
	dispatch: vi.fn(),
	record: vi.fn(),
	mark: vi.fn()
}));

vi.mock('$lib/server/stripe-events', () => ({
	dispatchStripeEvent: spies.dispatch
}));

vi.mock('$lib/server/stripe-events-store', () => ({
	recordStripeEvent: spies.record,
	markStripeEventProcessed: spies.mark
}));

beforeEach(() => {
	spies.dispatch.mockReset().mockResolvedValue('ok');
	spies.record.mockReset().mockResolvedValue('fresh');
	spies.mark.mockReset().mockResolvedValue(undefined);
});
```

Per-test scenarios (the dispatcher throws, storage reports `'failed'`) override via `mockImplementation` / `mockResolvedValue` and rely on the next `beforeEach` to wipe.

A previous version of this test used `vi.doMock` per-test instead. That worked for the first override but persisted into all subsequent tests' modules — a Vitest gotcha that's effectively impossible to diagnose without re-discovering it. Using `vi.hoisted` + spy overrides on the SAME mock instance avoids the trap entirely.

### 3c. `HttpError` adaptation

The receiver uses SvelteKit's `error(status, message)` helper for all non-200 paths; `error()` THROWS rather than returning a `Response`. In production, SvelteKit's router catches the throw and emits the HTTP response. The test transport mimics that:

```ts
const transport: CassetteTransport = async (request) => {
	try {
		return await POST({ request, locals: { logger: silentLogger } } as unknown as RequestEvent);
	} catch (err) {
		if (typeof err === 'object' && err !== null && 'status' in err) {
			const httpErr = err as { status: number; body?: { message?: string } };
			return new Response(JSON.stringify(httpErr.body ?? {}), {
				status: httpErr.status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw err;
	}
};
```

Without this, the cassette driver's transport invocation rejects on the first 5xx and `playCassette` short-circuits before any non-2xx outcome lands. The adaptation belongs at the transport layer, not in the driver — different transports (a `fetch`-based HTTP transport, a Node http server transport) have different error shapes; the driver stays transport-agnostic.

## 4. The 12 cases

Per cassette: a "drives every event with 200" test + a "dispatches in canonical order" test (4 × 2 = 8).

Two cross-cassette behaviours, run against the seed cassette:

- **Idempotency on duplicate delivery.** When storage reports `'already-processed'`, every event 200s with `duplicate: true` AND the dispatcher is NEVER called.
- **Storage-layer transient failure.** When `recordStripeEvent` returns `'failed'`, every event 500s and the dispatcher is NEVER called. Stripe retries; the next attempt is the recovery path.

One end-to-end resilience case on the failure cassette:

- **The dispatcher throws partway through.** Override the second event to throw; assert that the first and third events still 200 and the second 500s. Crucial production invariant: a transient failure on event N does NOT block events N+1, N+2 — Stripe pipelines them.

```ts
it('dispatcher throws on event 2 → 1 & 3 still 200, 2 is 500', async () => {
	const cassette = loadCassette('payment-failed-pro-monthly');
	let n = 0;
	spies.dispatch.mockImplementation(() => {
		n++;
		if (n === 2) throw new Error('boom');
		return 'ok';
	});

	const result = await playCassette(cassette, { transport, secret: SECRET });
	expect(result.outcomes.map((o) => o.status)).toEqual([200, 500, 200]);
});
```

## 5. Why this beats unit tests at the receiver

The unit-level receiver test exercises the `POST` handler with a single hand-built signed request. Useful, but limited:

- It can't see ordering effects across events.
- It can't see the idempotency table behaving correctly under retry.
- It can't see the cumulative state changes across a sequence.

The cassette scenario tests are the next step up — the same code under test, but driven by realistic event sequences. They catch a class of bugs unit tests can't, at a price (~10 ms per test) that's still trivially CI-friendly.

## 6. What's deliberately out of scope

- **Real DB writes.** Per-handler tests under `src/lib/server/billing/*.test.ts` have full coverage. Mocking the dispatch table here keeps the suite fast and DB-independent.
- **`offsetMs`-aware playback.** The driver fires events back-to-back. Production Stripe spaces them by ~milliseconds; the spacing doesn't change receiver behaviour.
- **Cassette recorder mode.** Generating cassettes from real test-mode Stripe activity. Useful for new event types you haven't yet hand-authored. Lands when a real need surfaces.

## 7. Acceptance checklist

- [ ] Four cassettes shipped: `subscribe-pro-monthly-keep`, `cancel-pro-monthly-immediate`, `payment-failed-pro-monthly`, `recover-after-payment-failure`.
- [ ] Cassettes use hand-authored ids (no real Stripe data).
- [ ] Scenario test file uses `vi.hoisted` for spy sharing.
- [ ] Test transport adapts `HttpError` throws into `Response`.
- [ ] Each cassette has a happy-path test + a dispatch-order test.
- [ ] Idempotency-on-duplicate test passes.
- [ ] Storage-failure test passes.
- [ ] Dispatcher-partial-failure test passes.

## What's next

Bonus 25 wires the cassette suite into CI — pre-commit hooks, GitHub Actions workflow, and the runbook entries that make "we have an integration test failure" actionable instead of mysterious.
