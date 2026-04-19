/**
 * Cassette playback driver.
 *
 * Walks a cassette's events in order, signs each one with the
 * configured webhook secret, hands the resulting Request to the
 * caller's transport (typically the SvelteKit `POST` handler under
 * test), and collects per-event outcomes.
 *
 * The driver is **transport-agnostic** by design — it accepts any
 * `(Request) => Response` shape. That lets the same driver:
 *
 *   - Drive the production receiver (`+server.ts`'s `POST`) for
 *     end-to-end scenario tests, with `vi.mock`'d storage.
 *   - Drive a recording stub that captures requests for later
 *     assertion (useful in 12.5's CI wrap).
 *   - Drive a no-op stub during cassette authoring to verify the
 *     event sequence parses + signs cleanly without firing handlers.
 *
 * The driver does NOT advance a clock or sleep between events. The
 * `offsetMs` field on each cassette event is metadata describing
 * the original recording's gaps; replay is back-to-back so the
 * test suite stays fast. A future "realistic playback" mode for
 * timing-sensitive integration tests can layer on top by reading
 * the offsets — Lesson 12.4's scenarios don't need it.
 *
 * Failure handling: by default an unexpected status (something
 * other than 200) is recorded and playback continues, so the
 * caller can assert "event 3 returned 500 because the dispatcher
 * threw, but events 4 + 5 still landed." Set `stopOnError: true`
 * to short-circuit at the first non-200 — useful when a test
 * wants to assert a specific failure point.
 */
import type { Cassette, CassetteEvent } from './cassette';
import { buildSignedWebhookRequest } from './webhook-signing';

/**
 * Anything that consumes a `Request` and returns a `Response`. The
 * SvelteKit `POST` handler matches this once you pass `event.locals`
 * and `event.request` correctly — there's a thin adapter for that
 * in the scenario tests.
 */
export type CassetteTransport = (request: Request) => Promise<Response> | Response;

/**
 * Per-event outcome captured during playback. The shape is shallow
 * (status + parsed JSON body) because deep assertions belong in the
 * scenario test, not in the driver.
 *
 * `event` is a small projection of the cassette event for grep-
 * friendly test failure messages — `outcomes[2].event.type` is
 * easier to read than `outcomes[2].event.event.type`.
 */
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

export type PlayCassetteOptions = {
	/** Transport that consumes the signed Request. */
	transport: CassetteTransport;
	/**
	 * Webhook signing secret. Always the **test** secret; never the
	 * production `whsec_…`. The driver does not enforce this — the
	 * receiver's signature verification will simply reject a real
	 * Stripe payload signed with a fake secret, which is the right
	 * runtime check.
	 */
	secret: string;
	/**
	 * If `true`, the driver throws a `CassettePlaybackError` on the
	 * first non-200 response, with the partial outcome list attached
	 * so the test can still inspect what happened. Defaults to
	 * `false`: collect every outcome and let the caller assert on
	 * the full result.
	 */
	stopOnError?: boolean;
	/**
	 * Override the timestamp embedded in the signed `t=` component.
	 * Useful for "stale timestamp" failure-mode tests. By default
	 * each event is signed with the current wall clock at play time,
	 * which is also what production behaviour would be.
	 */
	timestampSeconds?: number;
};

/**
 * Thrown when `stopOnError` is `true` and an event's response was
 * not a 2xx. Exposes the outcomes collected up to and including the
 * failure so the caller's `try/catch` can still assert on them.
 */
export class CassettePlaybackError extends Error {
	constructor(
		message: string,
		readonly result: PlaybackResult
	) {
		super(message);
		this.name = 'CassettePlaybackError';
	}
}

/**
 * Drive a cassette through `options.transport`. Returns the full
 * outcome list keyed by event index — same length as
 * `cassette.events`, in the same order, even when `stopOnError` is
 * `false` (failed events are recorded and playback continues).
 */
export async function playCassette(
	cassette: Cassette,
	options: PlayCassetteOptions
): Promise<PlaybackResult> {
	const outcomes: CassetteOutcome[] = [];
	for (let index = 0; index < cassette.events.length; index++) {
		const entry = cassette.events[index];
		// `cassette.events` is non-empty per schema, but indexed access
		// returns `T | undefined` under noUncheckedIndexedAccess. Narrow
		// once at the loop boundary so the rest of the body is total.
		if (entry === undefined) continue;
		const outcome = await playSingleEvent(entry, index, options);
		outcomes.push(outcome);
		if (options.stopOnError && (outcome.status < 200 || outcome.status >= 300)) {
			throw new CassettePlaybackError(
				`Cassette "${cassette.name}" failed at event ${index} ` +
					`(${outcome.event.id} ${outcome.event.type}): status=${outcome.status}`,
				{ cassette, outcomes }
			);
		}
	}
	return { cassette, outcomes };
}

async function playSingleEvent(
	entry: CassetteEvent,
	index: number,
	options: PlayCassetteOptions
): Promise<CassetteOutcome> {
	const request = buildSignedWebhookRequest(entry.event, options.secret, {
		timestampSeconds: options.timestampSeconds
	});
	const response = await options.transport(request);
	// Parse JSON best-effort — the receiver always returns JSON on
	// success, but error paths use SvelteKit's `error()` helper which
	// produces a different content-type. Treat unparseable bodies as
	// `null` rather than throwing; the status is the primary signal.
	const text = await response.text();
	let body: unknown = null;
	if (text.length > 0) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	return {
		index,
		event: { id: entry.event.id, type: entry.event.type },
		status: response.status,
		body
	};
}

/**
 * Filter helper: pick the outcomes whose event type matches a
 * predicate. Used in scenario tests to assert "every
 * `customer.subscription.*` event returned 200" without manually
 * indexing.
 */
export function outcomesOfType(
	result: PlaybackResult,
	typeOrPredicate: string | ((type: string) => boolean)
): CassetteOutcome[] {
	const matches =
		typeof typeOrPredicate === 'function' ? typeOrPredicate : (t: string) => t === typeOrPredicate;
	return result.outcomes.filter((o) => matches(o.event.type));
}
