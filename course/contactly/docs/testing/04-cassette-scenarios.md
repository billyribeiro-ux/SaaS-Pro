# 12.4 — End-to-end cassette scenarios

> **Module 12 — Recorded-cassette test harness for end-to-end Stripe scenarios.**
>
> Lesson 4 of 5. Three new cassettes covering the full subscription
> lifecycle (cancel, fail, recover) and a scenario test file that
> drives every cassette through the production receiver, asserting on
> end-to-end behaviour the unit-level receiver tests cannot reach.

## What we built

```
src/lib/testing/
├── cassettes/
│   ├── subscribe-pro-monthly-keep.cassette.json    (existed — 12.1)
│   ├── cancel-pro-monthly-immediate.cassette.json  (NEW)
│   ├── payment-failed-pro-monthly.cassette.json    (NEW)
│   └── recover-after-payment-failure.cassette.json (NEW)
└── cassette-scenarios.test.ts                       (NEW — 12 cases)
```

The scenario test file plays each cassette against the real
`POST /api/webhooks/stripe` handler, with surgical mocks on the
dispatch table and storage layer.

## The four cassettes (cumulative)

| Cassette                        | Events | Story                                              |
| ------------------------------- | ------ | -------------------------------------------------- |
| `subscribe-pro-monthly-keep`    | 5      | Happy path: signup → trial → first invoice         |
| `cancel-pro-monthly-immediate`  | 2      | `updated`(`cancel_at_period_end=true`) → `deleted` |
| `payment-failed-pro-monthly`    | 3      | `finalized` → `payment_failed` → `past_due`        |
| `recover-after-payment-failure` | 2      | `invoice.paid` → sub flips back to `active`        |

The four cassettes cover **subscribe, cancel, fail, recover** —
the closed loop of involuntary churn. The fail and recover
cassettes share customer + subscription + invoice ids so they can
be played back-to-back to test the dunning recovery path.

### Why hand-authored cassettes vs. real-Stripe recordings

The seed cassette in 12.1 explained the rationale; the same logic
applies to the new three:

- Real Stripe recordings carry test-account ids that drift between
  developer machines. Hand-authored ids (`cus_test_cancel`,
  `sub_test_fail`) are stable forever.
- Real recordings carry secret-shaped fields (api versions, request
  ids, livemode flags) that need to be diff-reviewed before they're
  committed. Hand-authored events skip the laundering step.
- A future recorder mode (out of scope for Module 12) can produce
  authoring-grade cassettes; until then, hand-authoring is faster
  for the four scenarios we need.

## The scenario test file

The full surface lives in `cassette-scenarios.test.ts`. The shape
worth highlighting:

### Surgical mocks, not full integration

We mock exactly two modules:

- `$lib/server/stripe-events` — the dispatch table. Replaced with a
  `vi.fn()` that records every call. The receiver's HTTP layer
  (signature verification, body reading, idempotency arbitration,
  response shape) runs FOR REAL.
- `$lib/server/stripe-events-store` — the idempotency layer.
  Default: every event is `'fresh'`. Per-test overrides (via
  `mockResolvedValue`) simulate `'already-processed'` and
  `'failed'`.

Why two and not zero? Two reasons:

- **Speed.** The unit-level receiver test (`server.test.ts`) runs
  in ~5 ms because it doesn't touch the DB. The scenario test
  inherits that property by mocking the storage + dispatch layer.
  Twelve scenario cases run in ~40 ms total.
- **Decoupling.** The handlers behind the dispatch table are tested
  in `src/lib/server/billing/*.test.ts`, with full DB-call coverage.
  The scenario test asserts on **what the receiver does with the
  event**, not on what each handler does. Asserting both here would
  duplicate the per-handler tests.

A future "full-integration" mode could load the same cassettes,
unmock the storage layer, and assert against a real Supabase test
schema. The cassette JSON is reusable — the test driver isn't
opinionated about how the dispatched events are absorbed.

### Spies via `vi.hoisted`

`vi.mock` factory bodies are hoisted above any `const` declarations,
so the naive shape:

```ts
const dispatchSpy = vi.fn();
vi.mock('$lib/server/stripe-events', () => ({
	dispatchStripeEvent: dispatchSpy
}));
```

…closes over `undefined` in the factory at hoisting time. We use
`vi.hoisted` to share spy references between the factories and the
test bodies:

```ts
const spies = vi.hoisted(() => ({
	dispatch: vi.fn(),
	record: vi.fn(),
	mark: vi.fn()
}));
vi.mock('$lib/server/stripe-events', () => ({
	dispatchStripeEvent: spies.dispatch
}));
```

`beforeEach` resets each spy and re-installs the default
implementation. Per-test scenarios (the dispatcher throws, storage
reports `'failed'`) override via `mockImplementation` /
`mockResolvedValue` and rely on the next `beforeEach` to wipe.

Earlier, this test used `vi.doMock` per-test instead. That worked
for the first override but persisted into all subsequent tests'
modules — a classic Vitest gotcha that's effectively impossible to
diagnose without re-discovering it. Using `vi.hoisted` + spy
overrides on the SAME mock instance avoids the trap entirely.

### `HttpError` adaptation in the test transport

The receiver uses SvelteKit's `error(status, message)` helper for
all non-200 paths; `error()` THROWS rather than returning a
`Response`. In production, SvelteKit's router catches the throw
and emits the HTTP response. Our test transport mimics that:

```ts
return async (request) => {
	try {
		return await post({ request, locals: { logger: silentLogger } });
	} catch (err) {
		if (typeof err === 'object' && 'status' in err) {
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

Without this, the cassette driver's transport invocation rejects
on the first 5xx and `playCassette` short-circuits before any
non-2xx outcome lands. The adaptation belongs at the transport
layer, not in the driver — different transports (a `fetch`-based
HTTP transport, a Node http server transport) have different error
shapes; the driver stays transport-agnostic.

## What's tested (12 cases)

Per cassette: a "drives every event with 200" test + a
"dispatches in canonical order" test.

Two cross-cassette behaviours, run against the seed cassette:

- **Idempotency on duplicate delivery.** When storage reports
  `'already-processed'`, every event 200s with `duplicate: true`
  AND the dispatcher is NEVER called. This is the defining
  contract of the storage idempotency layer — Stripe retries past
  events at 1m/10m/1h/3h/6h/24h cadence and we MUST de-dupe.
- **Storage-layer transient failure.** When `recordStripeEvent`
  returns `'failed'`, every event 500s and the dispatcher is NEVER
  called. Stripe retries; the next attempt is the recovery path.

One end-to-end resilience case on the failure cassette:

- **The dispatcher throws partway through.** Override the second
  event to throw; assert that the first and third events still 200
  and the second 500s. Crucial production invariant: a transient
  failure on event N does NOT block events N+1, N+2 — Stripe
  pipelines them.

## What's deliberately out of scope (this lesson)

- **Real DB writes.** Per-handler tests under
  `src/lib/server/billing/*.test.ts` have full coverage. Mocking
  the dispatch table here keeps the suite fast and DB-independent.
- **`offsetMs`-aware playback.** The driver fires events
  back-to-back. Production Stripe spaces them by ~milliseconds;
  the spacing doesn't change receiver behaviour. A future
  timing-sensitive test (e.g. "events delivered with a stale
  timestamp are rejected") would set per-call `timestampSeconds`
  on the driver — the cassette JSON already carries the offsets to
  drive that.
- **Cassette recorder mode.** Generating cassettes from real
  test-mode Stripe activity. Useful for new event types we haven't
  yet hand-authored. Lands when a real need surfaces.

## Tests added (12.4)

| Suite                        | Cases | Notes                                      |
| ---------------------------- | ----- | ------------------------------------------ |
| `cassette-scenarios.test.ts` | 12    | 4 cassettes × 2 + cross-cassette + failure |

Suite total: **272 tests, 26 files, ~430 ms**. Lesson 12.5 wires
the suite into CI and wraps Module 12.

## What's next

→ [12.5 — CI wiring + Module 12 wrap](./05-ci-and-wrap.md)
