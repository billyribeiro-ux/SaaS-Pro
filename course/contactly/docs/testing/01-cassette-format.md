# 12.1 — Cassette format + loader

> **Module 12 — Recorded-cassette test harness for end-to-end Stripe scenarios.**
>
> Lesson 1 of 5. Defines the JSON contract for capturing Stripe
> webhook scenarios and a Node-side loader that validates them.

## What we built

Two pure modules, one cassette directory, two seed test suites.

```
src/lib/testing/
├── cassette.ts                                 (schema + parser)
├── cassette.test.ts                            (12 cases)
├── cassette-loader.ts                          (Node fs reader)
├── cassette-loader.test.ts                     (6 cases)
└── cassettes/
    └── subscribe-pro-monthly-keep.cassette.json
```

`cassette.ts` is environment-agnostic — it imports only `zod` and
exports the schema, types, and a `parseCassette()` function.
`cassette-loader.ts` adds the `node:fs`-flavoured `loadCassette()`
helper. Splitting them keeps the parser usable from a future
browser-side cassette inspector (think: a `/admin/cassettes` page
that shows what each scenario does) without dragging `node:fs`
into the bundle.

## The cassette schema

Version 1. Bumped only when the schema changes; never edit V1
silently.

```json
{
	"version": 1,
	"name": "subscribe-pro-monthly-keep",
	"description": "Happy-path Pro-monthly subscription...",
	"recordedAt": "2026-04-19T18:00:00.000Z",
	"stripeApiVersion": "2026-03-25.dahlia",
	"events": [
		{
			"offsetMs": 0,
			"event": {
				/* full Stripe.Event payload */
			}
		}
	]
}
```

Field-by-field:

| Field              | Why it exists                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`          | Format gate. Loader rejects unknown versions explicitly — no silent "best effort" parsing.                                                                                                                                |
| `name`             | Stable identifier. The loader reads cassettes by bare name (`'subscribe-pro-monthly-keep'`), not by relative path.                                                                                                        |
| `description`      | Human-targeted. Required, may be short. "Why does this cassette exist" — the answer should fit in one sentence.                                                                                                           |
| `recordedAt`       | ISO-8601 with offset. `recordedAt` plus a per-event `offsetMs` lets a future driver replay with realistic timing (Lesson 12.3 will choose to ignore the offsets and play back-to-back; the field is metadata either way). |
| `stripeApiVersion` | Informational. Webhook payload shape is account-pinned, not API-version pinned, but a future "your cassette is N major versions behind" check has a place to live.                                                        |
| `events`           | Ordered list. Required to be non-empty AND non-decreasing in `offsetMs` AND unique by `event.id`.                                                                                                                         |

The `event` object inside each entry validates **only the
envelope** — `id`, `type`, `object: 'event'`, `created`, `livemode`,
`data.object` exists. The `data.object` shape is NOT validated —
there are 250+ event types and each has its own schema. Embedding
all of them would couple cassette validation to the Stripe SDK
type system in a way that makes upgrading SDK versions painful.
The dispatcher and handlers are typed by the SDK; the cassette
loader's job is "this looks like a Stripe event," not "this is a
fully-typed Stripe.Event of variant X."

## What's NOT captured (by design)

- **API call recordings.** Module 12 tests the receiver — what
  happens when an event arrives. The Stripe API surface (Checkout
  sessions, Subscriptions GET, etc.) is covered by unit-level
  mocks in Modules 7–9. Capturing both would double the cassette
  surface and tempt people to write tests that depend on byte-
  exact API request payloads, which is a famous flake source.
- **Server clock.** `recordedAt` is metadata; we don't try to
  advance a fake clock during playback. Handlers that compute
  `Date.now()` use it for `processed_at` stamps and log fields —
  neither participates in the assertions the scenario tests make.
- **Stripe-Signature header.** Lesson 12.3 signs each event at
  playback time with our test webhook secret, NOT the production
  one. Storing pre-signed payloads would tie every cassette to a
  specific signing-secret value, which is a CI-ergonomics nightmare.

## Validation rules (enforced by the schema)

The Zod schema enforces each rule. Tests pin every one.

1. `version === 1`. Rejecting `999` with a clear `"Invalid input"`
   message means a stale cassette can't accidentally be parsed
   under a future schema.
2. `events.length >= 1`. An empty cassette is always a recording
   bug — there is no "test that nothing happens" use case.
3. Each `event.id` matches `/^evt_/`. Stripe event ids are
   namespaced; a `sub_…` value here is a copy/paste error.
4. Each `event.object === 'event'`. Distinguishes event payloads
   from accidentally-pasted resource payloads.
5. `recordedAt` is a parseable ISO-8601 with an explicit offset.
   The "2026-04-19T18:00:00.000Z" form keeps cassettes
   timezone-unambiguous when read by humans.
6. `offsetMs` is a non-negative integer per event.
7. **Events are in non-decreasing offset order.** Enforced via
   `superRefine` so the issue points at the offending index.
   Sorting at load time would silently mask a recording bug.
8. **Event ids are unique within a cassette.** The receiver's
   idempotency layer would treat duplicates as already-processed
   on the second arrival, which is correct production behaviour
   but almost certainly not what the cassette author wanted.
   Loud failure beats silent dedupe.

## Public API

```ts
// Pure schema — usable from any environment.
export const CASSETTE_VERSION: 1;
export type Cassette;
export type CassetteEvent;
export function parseCassette(input: unknown): ParseCassetteResult;
export function parseCassetteOrThrow(input: unknown): Cassette;

// Node-only file IO.
export const CASSETTES_DIR: string;
export function loadCassette(name: string): Cassette;
export function listCassettes(): string[];
```

`parseCassette` returns a discriminated `{ ok: true, cassette } | { ok:
false, issues }` — callers (the loader, ad-hoc test scaffolding) get
the specific issue paths in their failure messages without catching
exceptions. `parseCassetteOrThrow` is the scaffolding-friendly
variant that throws a multi-line error message.

`loadCassette('foo')` resolves
`src/lib/testing/cassettes/foo.cassette.json`. Missing files throw
with a helpful list of available cassette names — discovery via
the error message rather than a separate lookup tool.

## The seed cassette

`subscribe-pro-monthly-keep` captures the canonical happy-path Pro
subscription:

| #   | Offset                  | Event type                      | What it represents                                |
| --- | ----------------------- | ------------------------------- | ------------------------------------------------- |
| 1   | 0 ms                    | `checkout.session.completed`    | User completed Checkout — Stripe confirms payment |
| 2   | 250 ms                  | `customer.created`              | Customer record created                           |
| 3   | 600 ms                  | `customer.subscription.created` | Subscription created in `trialing` status         |
| 4   | 1 209 600 000 ms (14 d) | `customer.subscription.updated` | Trial ends, subscription becomes `active`         |
| 5   | 1 209 602 000 ms        | `invoice.paid`                  | First post-trial invoice paid                     |

Five events — the smallest meaningful end-to-end trace. Lesson 12.4
adds the `subscribe-fail-then-recover` cassette with an
`invoice.payment_failed` → recovery → `invoice.paid` arc.

## Tests added (12.1)

| Suite                     | Cases | Notes                                                       |
| ------------------------- | ----- | ----------------------------------------------------------- |
| `cassette.test.ts`        | 12    | Schema cases — accept/reject matrix, plus round-trip parse  |
| `cassette-loader.test.ts` | 6     | Loader cases incl. "every cassette on disk validates" sweep |

Suite total: **236 tests, 23 files, ~390 ms**. The on-disk sweep
is deliberately cheap — adding a broken cassette to the directory
fails the build even if no individual scenario test references it.

## Decisions worth remembering

- **`.cassette.json` suffix, not bare `.json`.** Disambiguates
  cassettes from any other JSON file that might land in the
  directory (config, schema, etc.). The loader strips the suffix
  so callers say `loadCassette('subscribe-pro-monthly-keep')`.
- **No "cassette discovery" via filesystem walk.** Tests that
  reference cassettes do so by name. The on-disk sweep is the
  only place that walks. Avoids the trap where renaming a
  cassette silently un-runs the test that loaded it.
- **Schema validates the envelope, not the body.** Adding
  per-type body schemas would be a maintenance treadmill (Stripe
  ships new event types every release). The dispatcher's TypeScript
  types are the right place for shape checks; the cassette loader's
  job is to confirm "this is shaped like an event."

## What's next

→ [12.2 — Webhook signing for cassette playback](./02-cassette-signing.md)
