---
title: 'Bonus: Cassette Driver & Replay Engine'
module: 14
lesson: 23
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-23-cassette-driver'
description: 'A transport-agnostic playback driver that walks a cassette, signs each event, hands it to a caller-supplied transport, and collects per-event outcomes. The piece every scenario test sits on top of.'
duration: 22
preview: false
---

# Bonus: Cassette driver & replay engine

You have a cassette format (Bonus 21) and a signing helper (Bonus 22). The driver is the thing that actually feeds events through your receiver and tells you what happened.

The driver is intentionally tiny — it walks the cassette, calls a caller-supplied transport function for each event, and collects outcomes. The transport can be the real `+server.ts` `POST` handler (for end-to-end scenarios), a recording stub (for inspection), or a no-op (for cassette authoring sanity checks). Same driver, three jobs, no coupling.

By the end of this lesson you will:

- Build `playCassette(cassette, { transport, secret, ... })` that returns a `PlaybackResult` with per-event outcomes.
- Adapt SvelteKit's `RequestHandler` shape into a `(Request) => Response | Promise<Response>` transport with a one-liner.
- Choose between `stopOnError: false` (collect every outcome — production-shaped) and `stopOnError: true` (short-circuit at the first failure).
- Handle JSON, plain-text, and empty-body responses uniformly.
- Filter outcomes by event type for assertions (`outcomesOfType(result, 'invoice.paid')`).

## 1. The public surface

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

playCassette(
	cassette,
	{ transport, secret, stopOnError?, timestampSeconds? }
): Promise<PlaybackResult>;

outcomesOfType(result, 'invoice.paid' | (type) => boolean): CassetteOutcome[];

class CassettePlaybackError extends Error {
	readonly result: PlaybackResult;
}
```

## 2. Implementation

```ts
// src/lib/testing/cassette-driver.ts
import type { Cassette } from './cassette';
import { buildSignedWebhookRequest } from './webhook-signing';

export type CassetteTransport = (request: Request) => Response | Promise<Response>;

export type CassetteOutcome = {
	index: number;
	event: { id: string; type: string };
	status: number;
	body: unknown;
};

export type PlaybackResult = {
	cassette: Cassette;
	outcomes: CassetteOutcome[];
};

export type PlaybackOptions = {
	transport: CassetteTransport;
	secret: string;
	stopOnError?: boolean;
	timestampSeconds?: number;
	url?: string;
};

export class CassettePlaybackError extends Error {
	readonly result: PlaybackResult;
	constructor(message: string, result: PlaybackResult) {
		super(message);
		this.name = 'CassettePlaybackError';
		this.result = result;
	}
}

async function readBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text.length) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export async function playCassette(
	cassette: Cassette,
	opts: PlaybackOptions
): Promise<PlaybackResult> {
	const result: PlaybackResult = { cassette, outcomes: [] };

	for (let i = 0; i < cassette.events.length; i++) {
		const { event } = cassette.events[i];
		const request = buildSignedWebhookRequest(event, opts.secret, {
			timestampSeconds: opts.timestampSeconds,
			url: opts.url
		});
		const response = await opts.transport(request);
		const body = await readBody(response);

		const outcome: CassetteOutcome = {
			index: i,
			event: { id: event.id, type: event.type },
			status: response.status,
			body
		};
		result.outcomes.push(outcome);

		if (opts.stopOnError && (response.status < 200 || response.status >= 300)) {
			throw new CassettePlaybackError(
				`Cassette ${cassette.name} stopped at index ${i} (status ${response.status})`,
				result
			);
		}
	}

	return result;
}

export function outcomesOfType(
	result: PlaybackResult,
	matcher: string | ((type: string) => boolean)
): CassetteOutcome[] {
	const fn = typeof matcher === 'string' ? (t: string) => t === matcher : matcher;
	return result.outcomes.filter((o) => fn(o.event.type));
}
```

## 3. Why transport-agnostic

`playCassette` accepts any `(Request) => Response` shape. That's deliberate — the same driver can:

- Drive the production receiver (`+server.ts`'s `POST`) for end-to-end scenario tests, with `vi.mock`'d storage.
- Drive a recording stub that captures requests for later assertion (useful in CI integration).
- Drive a no-op stub during cassette authoring to verify the event sequence parses + signs cleanly without firing handlers.

Adapting the SvelteKit `RequestHandler` shape into the driver's `(Request) => Response` shape is a one-liner:

```ts
import { POST } from '../../routes/api/webhooks/stripe/+server';

const transport: CassetteTransport = (req) =>
	POST({
		request: req,
		locals: { logger: silentLogger, supabase: mockSb }
	} as unknown as RequestEvent);
```

## 4. Why back-to-back replay (no clock advance)

The driver does not honour `offsetMs` between events. Each event fires immediately after the previous one's outcome lands. This:

- Keeps the suite fast (5-event cassettes complete in <5 ms).
- Keeps the assertions deterministic (no flake from timing).
- Doesn't matter for the receiver — the receiver dispatches each event independently and is idempotent across delivery attempts.

A future timing-sensitive test (e.g. "events delivered within N seconds tolerance succeed; events at +30 minutes are rejected as stale") can layer on top by reading the cassette's `offsetMs` and threading a custom `timestampSeconds` per event.

## 5. Why `stopOnError: false` by default

Production reality: when one webhook fails, Stripe retries it but keeps delivering newer events in parallel. The driver's default mirrors that — collect every outcome, let the test assert on the full picture ("event 3 was 500 because we mocked the dispatcher to throw, but events 4 and 5 still landed").

`stopOnError: true` is the explicit knob for tests that want to short-circuit at a specific failure point. The thrown `CassettePlaybackError` carries the partial outcomes so the catching test can still inspect what happened.

## 6. Empty-body and non-JSON tolerance

The receiver's success path returns JSON. SvelteKit's `error()` helper produces a different content-type. `204 No Content` returns no body at all. `readBody` handles all three:

- Non-empty + parses as JSON → `outcome.body` is the parsed object.
- Non-empty + non-JSON → `outcome.body` is the raw text.
- Empty → `outcome.body` is `null`.

The status code is the primary signal; the body is optional context for assertions.

## 7. Testing the driver

Thirteen cases pin every behaviour:

```ts
import { describe, it, expect } from 'vitest';
import { loadCassette } from './cassette-loader';
import { playCassette, outcomesOfType, CassettePlaybackError } from './cassette-driver';
import { signWebhookEvent } from './webhook-signing';

const SECRET = 'whsec_test_secret_for_driver_tests';

describe('playCassette', () => {
	it('drives every event in cassette order', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const calls: string[] = [];
		const transport = async (req: Request) => {
			const body = await req.text();
			calls.push(JSON.parse(body).id);
			return new Response(null, { status: 200 });
		};
		const result = await playCassette(cassette, { transport, secret: SECRET });
		expect(calls).toEqual(cassette.events.map((e) => e.event.id));
		expect(result.outcomes.length).toBe(cassette.events.length);
	});

	it('signature matches a hand-recomputation', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const transport = async (req: Request) => {
			const body = await req.text();
			const sig = req.headers.get('stripe-signature')!;
			const t = Number(sig.match(/t=(\d+)/)![1]);
			const expected = signWebhookEvent(JSON.parse(body), SECRET, { timestampSeconds: t });
			expect(sig).toBe(expected.signature);
			return new Response(null, { status: 200 });
		};
		await playCassette(cassette, { transport, secret: SECRET });
	});

	it('continues past a non-2xx by default', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		let count = 0;
		const transport = async () => {
			count++;
			return new Response('boom', { status: count === 2 ? 500 : 200 });
		};
		const result = await playCassette(cassette, { transport, secret: SECRET });
		expect(result.outcomes.length).toBe(cassette.events.length);
		expect(result.outcomes[1].status).toBe(500);
	});

	it('throws on first non-2xx with stopOnError', async () => {
		const cassette = loadCassette('subscribe-pro-monthly-keep');
		const transport = async () => new Response('boom', { status: 500 });
		await expect(
			playCassette(cassette, { transport, secret: SECRET, stopOnError: true })
		).rejects.toBeInstanceOf(CassettePlaybackError);
	});
});
```

The cassette under test for every case is the seed `subscribe-pro-monthly-keep` — keeping the fixture surface small means a future cassette schema change doesn't ripple into driver tests.

## 8. What we deliberately didn't build

- **`stripeApiVersion` checks.** The cassette carries the API version it was recorded against; a future "your cassette is N major versions behind" check has a place to live but no consumer yet.
- **A request-recording mode.** "Replace the live transport with a recorder, capture exchanges, write them out as a fresh cassette" is the inverse of playback. Would let you record cassettes from a real test-mode Stripe account. Hand-authored cassettes are sufficient for the four scenarios in Bonus 24.
- **Per-event sleep.** See "back-to-back replay" above.

## 9. Acceptance checklist

- [ ] `playCassette` accepts a transport function and walks the cassette in order.
- [ ] Each request carries a `stripe-signature` matching a hand-recomputation with the same secret.
- [ ] `stopOnError: false` is the default and collects every outcome.
- [ ] `stopOnError: true` throws `CassettePlaybackError` with partial outcomes attached.
- [ ] JSON / text / empty bodies are all parsed correctly.
- [ ] `outcomesOfType` filters by exact type string or predicate.
- [ ] Async transports are awaited.

## What's next

Bonus 24 puts the driver to work — authoring four canonical scenarios that exercise the receiver end-to-end, including the recovery arcs (failed payment → retry → success).
