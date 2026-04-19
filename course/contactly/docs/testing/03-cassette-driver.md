# 12.3 — Cassette playback driver

> **Module 12 — Recorded-cassette test harness for end-to-end Stripe scenarios.**
>
> Lesson 3 of 5. Adds the playback driver that walks a cassette,
> signs each event, hands it to a caller-supplied transport, and
> collects per-event outcomes. The piece every scenario test in
> Lesson 12.4 will sit on top of.

## What we built

```
src/lib/testing/
├── cassette-driver.ts            (driver + outcome filter)
└── cassette-driver.test.ts       (13 cases)
```

The public surface is small:

```ts
type CassetteTransport = (request: Request) => Response | Promise<Response>;

type CassetteOutcome = {
	index: number;
	event: { id: string; type: string };
	status: number;
	body: unknown;
};

type PlaybackResult = {
	cassette: Cassette;
	outcomes: CassetteOutcome[];
};

playCassette(cassette, { transport, secret, stopOnError?, timestampSeconds? }): Promise<PlaybackResult>;

outcomesOfType(result, 'invoice.paid' | (type) => boolean): CassetteOutcome[];

class CassettePlaybackError extends Error {
	readonly result: PlaybackResult;
}
```

## Design choices

### Transport-agnostic

`playCassette` accepts any `(Request) => Response` shape. That's
deliberate — the same driver can:

- Drive the production receiver (`+server.ts`'s `POST`) for
  end-to-end scenario tests, with `vi.mock`'d storage.
- Drive a recording stub that captures requests for later assertion
  (useful in 12.5's CI wrap).
- Drive a no-op stub during cassette authoring to verify the event
  sequence parses + signs cleanly without firing handlers.

The receiver test in Lesson 12.4 will adapt the SvelteKit
`RequestHandler` (`POST({ request, locals })`) into this shape with
a one-liner:

```ts
const transport: CassetteTransport = (req) =>
	(POST as unknown as (e: { request: Request; locals: { logger: any } }) => Promise<Response>)({
		request: req,
		locals: { logger: silentLogger }
	});
```

### Back-to-back replay (no clock advance)

The driver does not honour `offsetMs` between events. Each event
fires immediately after the previous one's outcome lands. This:

- Keeps the suite fast (5-event cassettes complete in <5 ms).
- Keeps the assertions deterministic (no flake from timing).
- Doesn't matter for the receiver — the receiver dispatches each
  event independently and is idempotent across delivery attempts.

A future timing-sensitive test (e.g. "events delivered within
N seconds tolerance succeed; events at +30 minutes are rejected as
stale") can layer on top by reading the cassette's `offsetMs` and
threading a custom `timestampSeconds` per event. Lesson 12.4's
scenarios don't need it.

### `stopOnError: false` by default

Production reality: when one webhook fails, Stripe retries it but
keeps delivering newer events in parallel. The driver's default
mirror that — collect every outcome, let the test assert on the
full picture ("event 3 was 500 because we mocked the dispatcher
to throw, but events 4 and 5 still landed").

`stopOnError: true` is the explicit knob for tests that want to
short-circuit at a specific failure point. The thrown
`CassettePlaybackError` carries the partial outcomes so the
catching test can still inspect what happened.

### Empty-body and non-JSON tolerance

The receiver's success path returns JSON. SvelteKit's `error()`
helper produces a different content-type. `204 No Content` returns
no body at all. The driver handles all three:

- Non-empty + parses as JSON → `outcome.body` is the parsed object.
- Non-empty + non-JSON → `outcome.body` is the raw text.
- Empty → `outcome.body` is `null`.

The status code is the primary signal; the body is optional context
for assertions.

## What's tested

Thirteen cases across the driver:

- Drives every event in cassette order, preserving ids.
- Each request's `stripe-signature` matches a byte-for-byte
  recomputation by the helper from Lesson 12.2.
- Default mode (`stopOnError: false`) collects every outcome
  including failures.
- `stopOnError: true` throws `CassettePlaybackError` at the first
  non-2xx, with the partial outcomes attached.
- JSON / text / empty body responses are all parsed correctly.
- Async transports are awaited.
- `outcomesOfType` filters by exact type or predicate.

The cassette under test for every case is the seed
`subscribe-pro-monthly-keep` from Lesson 12.1 — keeping the
fixture surface small means a future cassette schema change
doesn't ripple into driver tests.

## What we **didn't** build

- **`stripeApiVersion` checks.** The cassette carries the API
  version it was recorded against; a future "your cassette is
  N major versions behind" check has a place to live but no
  consumer yet. Will land naturally in Lesson 12.5's CI wrap if
  the cassettes age past a real version bump.
- **A request-recording mode.** "Replace the live transport with a
  recorder, capture exchanges, write them out as a fresh cassette"
  is the inverse of playback. Would let us record cassettes from
  a real test-mode Stripe account. Not in scope for Module 12 —
  hand-authored cassettes are sufficient for the four scenarios in
  Lesson 12.4.
- **Per-event sleep.** See "Back-to-back replay" above.

## Tests added (12.3)

| Suite                     | Cases | Notes                                       |
| ------------------------- | ----- | ------------------------------------------- |
| `cassette-driver.test.ts` | 13    | Order, signature, error modes, body parsing |

Suite total: **260 tests, 25 files, ~410 ms**. Lesson 12.4
will start firing the driver against the real receiver and
asserting on storage / dispatch side effects.

## What's next

→ [12.4 — End-to-end scenario tests](./04-cassette-scenarios.md)
