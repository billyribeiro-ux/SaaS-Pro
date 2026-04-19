---
title: 'Bonus: Cassette Format — Deterministic Stripe Tests'
module: 14
lesson: 21
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-21-cassette-format'
description: 'Define a versioned JSON cassette format that captures Stripe webhook scenarios. Pure schema (Zod), Node loader, validation rules that fail loudly on common recording bugs.'
duration: 24
preview: false
---

# Bonus: Cassette format — deterministic Stripe tests

End-to-end testing a Stripe integration with live API calls is a tax: every PR pays for `customer.create`, `subscription.create`, `checkout.session.create`, and the long tail of webhook deliveries that follow. Even with Stripe's test mode, you're paying in slow tests, flaky CI, and developers learning to dread the test suite.

The pattern that fixes it is **recorded cassettes**: capture a real webhook scenario (a sequence of events from a real Stripe interaction) once, store it as JSON, and replay it deterministically on every test run. Same input every time → same assertions → no live calls in CI.

This lesson defines the cassette _format_. Bonuses 22–25 build the signing layer, the replay driver, the scenario authoring workflow, and CI integration.

By the end of this lesson you will:

- Define a versioned JSON schema for cassettes (Zod).
- Validate cassettes with rules that fail loudly on the common recording bugs (out-of-order events, duplicate ids, missing envelope fields).
- Split the schema (pure, environment-agnostic) from the loader (Node `fs`).
- Understand what the cassette _doesn't_ capture (server clock, signatures, API call recordings) and why.
- Ship the canonical happy-path cassette: `subscribe-pro-monthly-keep`.

## 1. Why cassettes (not VCR-style HTTP recording)

You'll see two patterns in this space:

- **HTTP-level recording** (VCR, Polly.js): record every outbound API call's request and response, replay on disk. Captures everything; very brittle to byte-exact request shape.
- **Event-level cassettes** (this lesson): capture only the inbound webhook events from Stripe. The outbound API calls are still mocked at the unit level. Two surfaces, two tools, neither overlaps.

You want event-level cassettes for webhook testing because:

- Stripe is the source of truth for what happened. Your job is to make sure your handlers do the right thing when they hear the news. Replaying real events is the most fidelity you can get without a live network.
- Outbound API calls (Checkout creation, Subscription GETs) are tested separately at the unit level (Modules 7–9 in the main course). Doubling up makes tests fragile to byte-exact request payloads — a famous flake source.

## 2. The schema

```json
{
	"version": 1,
	"name": "subscribe-pro-monthly-keep",
	"description": "Happy-path Pro-monthly subscription with 14-day trial then first paid invoice.",
	"recordedAt": "2026-04-19T18:00:00.000Z",
	"stripeApiVersion": "2026-03-25.dahlia",
	"events": [
		{
			"offsetMs": 0,
			"event": {
				"id": "evt_1Nxy...",
				"object": "event",
				"type": "checkout.session.completed",
				"created": 1745077200,
				"livemode": false,
				"data": {
					"object": {
						/* the Checkout session payload */
					}
				}
			}
		}
	]
}
```

Field-by-field:

| Field              | Why it exists                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`          | Format gate. Loader rejects unknown versions explicitly — no silent "best effort" parsing.                                                                         |
| `name`             | Stable identifier. The loader reads cassettes by bare name (`'subscribe-pro-monthly-keep'`), not by relative path.                                                 |
| `description`      | Human-targeted. Required, may be short. "Why does this cassette exist" — the answer should fit in one sentence.                                                    |
| `recordedAt`       | ISO-8601 with offset. Combined with per-event `offsetMs`, lets a future driver replay with realistic timing.                                                       |
| `stripeApiVersion` | Informational. Webhook payload shape is account-pinned, not API-version pinned, but a future "your cassette is N major versions behind" check has a place to live. |
| `events`           | Ordered list. Required to be non-empty AND non-decreasing in `offsetMs` AND unique by `event.id`.                                                                  |

## 3. The Zod schema

`src/lib/testing/cassette.ts`:

```ts
import { z } from 'zod';

export const CASSETTE_VERSION = 1 as const;

const CassetteEvent = z.object({
	offsetMs: z.number().int().nonnegative(),
	event: z.object({
		id: z.string().regex(/^evt_/),
		object: z.literal('event'),
		type: z.string().min(1),
		created: z.number().int().nonnegative(),
		livemode: z.boolean(),
		data: z.object({ object: z.unknown() })
	})
});

export const CassetteSchema = z
	.object({
		version: z.literal(CASSETTE_VERSION),
		name: z.string().min(1),
		description: z.string().min(1),
		recordedAt: z.string().datetime({ offset: true }),
		stripeApiVersion: z.string().min(1),
		events: z.array(CassetteEvent).min(1)
	})
	.superRefine((cassette, ctx) => {
		const seenIds = new Set<string>();
		let lastOffset = -1;
		cassette.events.forEach((e, i) => {
			if (e.offsetMs < lastOffset) {
				ctx.addIssue({
					code: 'custom',
					path: ['events', i, 'offsetMs'],
					message: `event ${i} has offsetMs=${e.offsetMs} < previous ${lastOffset}; events must be non-decreasing`
				});
			}
			lastOffset = e.offsetMs;
			if (seenIds.has(e.event.id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['events', i, 'event', 'id'],
					message: `duplicate event id ${e.event.id}`
				});
			}
			seenIds.add(e.event.id);
		});
	});

export type Cassette = z.infer<typeof CassetteSchema>;
export type CassetteEvent = z.infer<typeof CassetteEvent>;

export type ParseCassetteResult =
	| { ok: true; cassette: Cassette }
	| { ok: false; issues: z.ZodIssue[] };

export function parseCassette(input: unknown): ParseCassetteResult {
	const result = CassetteSchema.safeParse(input);
	return result.success
		? { ok: true, cassette: result.data }
		: { ok: false, issues: result.error.issues };
}

export function parseCassetteOrThrow(input: unknown): Cassette {
	const result = parseCassette(input);
	if (!result.ok) {
		const lines = result.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
		throw new Error(`Invalid cassette:\n${lines}`);
	}
	return result.cassette;
}
```

## 4. Validation rules (enforced by the schema)

1. **`version === 1`**. Rejecting `999` with a clear `"Invalid input"` message means a stale cassette can't accidentally be parsed under a future schema.
2. **`events.length >= 1`**. An empty cassette is always a recording bug — there is no "test that nothing happens" use case.
3. **Each `event.id` matches `/^evt_/`**. Stripe event ids are namespaced; a `sub_…` value here is a copy/paste error.
4. **Each `event.object === 'event'`**. Distinguishes event payloads from accidentally-pasted resource payloads.
5. **`recordedAt` is a parseable ISO-8601 with an explicit offset.**
6. **`offsetMs` is a non-negative integer per event.**
7. **Events are in non-decreasing offset order.** Enforced via `superRefine` so the issue points at the offending index. Sorting at load time would silently mask a recording bug.
8. **Event ids are unique within a cassette.** The receiver's idempotency layer would treat duplicates as already-processed on the second arrival, which is correct production behaviour but almost certainly not what the cassette author wanted.

Each rule is a Zod refine + a unit test. The pattern is "fail loud, fail close to the source."

## 5. The Node loader

`src/lib/testing/cassette-loader.ts`:

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCassetteOrThrow, type Cassette } from './cassette';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CASSETTES_DIR = join(__dirname, 'cassettes');

export function listCassettes(): string[] {
	return readdirSync(CASSETTES_DIR)
		.filter((f) => f.endsWith('.cassette.json'))
		.map((f) => f.replace(/\.cassette\.json$/, ''))
		.sort();
}

export function loadCassette(name: string): Cassette {
	const path = join(CASSETTES_DIR, `${name}.cassette.json`);
	if (!existsSync(path)) {
		throw new Error(
			`Cassette "${name}" not found. Available: ${listCassettes().join(', ') || '(none)'}`
		);
	}
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	return parseCassetteOrThrow(raw);
}
```

The loader is a separate module so the schema parser stays environment-agnostic. A future browser-side cassette inspector (a `/admin/cassettes` page that shows what each scenario does) can import `parseCassette` without dragging `node:fs` into the bundle.

`loadCassette('foo')` resolves `<dir>/foo.cassette.json`. Missing files throw with a helpful list of available cassette names — discovery via the error message rather than a separate lookup tool.

## 6. What's NOT captured (by design)

- **API call recordings.** Cassettes test the receiver — what happens when an event arrives. Outbound API calls (Checkout creation, Subscription GET) are tested at the unit level. Capturing both would double the cassette surface and tempt people to write tests that depend on byte-exact request payloads.
- **Server clock.** `recordedAt` is metadata; we don't try to advance a fake clock during playback. Handlers that compute `Date.now()` use it for `processed_at` stamps and log fields — neither participates in the assertions.
- **Stripe-Signature header.** Bonus 22 signs each event at playback time with the test webhook secret, NOT a captured one. Storing pre-signed payloads would tie every cassette to a specific signing-secret value, which is a CI-ergonomics nightmare.

## 7. The seed cassette

`subscribe-pro-monthly-keep` captures the canonical happy-path Pro subscription:

| #   | Offset                  | Event type                      | What it represents                                |
| --- | ----------------------- | ------------------------------- | ------------------------------------------------- |
| 1   | 0 ms                    | `checkout.session.completed`    | User completed Checkout — Stripe confirms payment |
| 2   | 250 ms                  | `customer.created`              | Customer record created                           |
| 3   | 600 ms                  | `customer.subscription.created` | Subscription created in `trialing` status         |
| 4   | 1 209 600 000 ms (14 d) | `customer.subscription.updated` | Trial ends, subscription becomes `active`         |
| 5   | 1 209 602 000 ms        | `invoice.paid`                  | First post-trial invoice paid                     |

Five events — the smallest meaningful end-to-end trace.

## 8. Test the cassette format

```ts
import { describe, it, expect } from 'vitest';
import { parseCassette } from './cassette';
import { listCassettes, loadCassette } from './cassette-loader';

describe('parseCassette', () => {
	it('rejects unknown version', () => {
		const bad = { version: 999, name: 'x', description: 'x', recordedAt: '...', events: [] };
		expect(parseCassette(bad).ok).toBe(false);
	});
	it('rejects empty events', () => {
		const bad = { version: 1, name: 'x', /* … */ events: [] };
		expect(parseCassette(bad).ok).toBe(false);
	});
	it('rejects out-of-order offsets', () => {
		const bad = {
			version: 1,
			/* … */
			events: [
				{
					offsetMs: 100,
					event: {
						/*…*/
					}
				},
				{
					offsetMs: 50,
					event: {
						/*…*/
					}
				}
			]
		};
		expect(parseCassette(bad).ok).toBe(false);
	});
	it('rejects duplicate event ids', () => {
		const bad = {
			version: 1,
			/* … */
			events: [
				{ offsetMs: 0, event: { id: 'evt_1' /*…*/ } },
				{ offsetMs: 1, event: { id: 'evt_1' /*…*/ } }
			]
		};
		expect(parseCassette(bad).ok).toBe(false);
	});
});

describe('on-disk cassette sweep', () => {
	it('every cassette on disk parses', () => {
		for (const name of listCassettes()) {
			expect(() => loadCassette(name)).not.toThrow();
		}
	});
});
```

The on-disk sweep is the load-bearing test: adding a broken cassette to the directory fails the build even if no individual scenario test references it.

## 9. Decisions worth remembering

- **`.cassette.json` suffix, not bare `.json`.** Disambiguates cassettes from any other JSON file that might land in the directory.
- **No "cassette discovery" via filesystem walk in tests.** Tests reference cassettes by name. The on-disk sweep is the only place that walks. Avoids the trap where renaming a cassette silently un-runs the test that loaded it.
- **Schema validates the envelope, not the body.** Adding per-type body schemas would be a maintenance treadmill (Stripe ships new event types every release). The dispatcher's TypeScript types are the right place for shape checks; the cassette loader's job is to confirm "this is shaped like an event."

## 10. Acceptance checklist

- [ ] Schema (Zod) defined in pure module with no `node:` imports.
- [ ] Node loader in a separate file.
- [ ] All 8 validation rules pinned by unit tests.
- [ ] On-disk sweep test loads every cassette.
- [ ] At least one canonical cassette shipped.

## What's next

Bonus 22 wires the **signing layer** so cassette events can be replayed through your real webhook receiver — including signature verification — without ever mixing test signatures with production secrets.
