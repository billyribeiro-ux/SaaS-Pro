/**
 * Cassette format for replaying Stripe webhook scenarios.
 *
 * A "cassette" is a JSON file that captures the ordered sequence of
 * Stripe webhook events that would arrive during a real flow —
 * subscribe, trial, first payment, cancel, recover-from-decline.
 * Replay it through `+server.ts` (in-process) and assert what the
 * dispatcher / store / entitlement snapshot did. No network, no
 * test-mode Stripe account, no flake.
 *
 * The format is an explicit V1 contract — `version: 1` — so future
 * format evolutions are migration-shaped, not "the loader breaks
 * one day." The loader rejects unknown versions loudly.
 *
 * WHAT'S CAPTURED
 * ---------------
 *
 *   - **Metadata**: name, description, recorded-at, the Stripe API
 *     version that produced these payloads. The API version is
 *     informational — Stripe only honours it on outbound API calls;
 *     webhook payload shape is account-pinned. We surface it so a
 *     future "the cassette was recorded against an old API version"
 *     check has a place to live.
 *
 *   - **Events**: an ordered list of `{ offsetMs, event }`. The
 *     offset is from the cassette's `recordedAt`; the driver in
 *     Lesson 12.3 can choose to honour it (realistic-ish playback)
 *     or zero it out (back-to-back, fast). The `event` is the full
 *     `Stripe.Event` payload — same shape `constructEventAsync`
 *     returns. We deliberately store the whole thing rather than a
 *     summary so a cassette is self-contained: open the JSON, see
 *     exactly what the receiver got.
 *
 * WHAT'S NOT CAPTURED (BY DESIGN)
 * -------------------------------
 *
 *   - **API call recordings.** Module 12 tests the *receiver* —
 *     what happens when an event arrives. The Stripe API surface
 *     (Checkout sessions, Subscriptions GET, etc.) is covered by
 *     unit-level mocks in Modules 7–9 already. Capturing both
 *     would double the cassette surface area and tempt people to
 *     write tests that depend on byte-exact API request payloads,
 *     which is a notorious flake source ("we changed a header,
 *     1000 cassettes broke").
 *
 *   - **Server clock.** The `recordedAt` is metadata; we don't try
 *     to advance a fake clock during playback. Handlers that
 *     compute `Date.now()` use it for `processed_at` stamps and
 *     log fields — neither participates in the assertions in
 *     Lesson 12.4.
 *
 *   - **Stripe-Signature header.** Lesson 12.3 will sign each
 *     event at playback time with our test webhook secret, NOT
 *     the production one. Storing pre-signed payloads would tie
 *     every cassette to a specific signing-secret value, which is
 *     a CI ergonomics nightmare.
 */
import { z } from 'zod';

/** The current cassette format version. Bump when the schema changes. */
export const CASSETTE_VERSION = 1 as const;

/**
 * Minimal shape of a Stripe webhook event payload, validated at the
 * envelope level only.
 *
 * We don't validate `data.object` — there are 250+ event types and
 * each has its own schema; embedding all of them would couple
 * cassette validation to the Stripe SDK type system in a way that
 * makes upgrading Stripe SDK versions painful. The dispatcher and
 * handlers are typed by the SDK already; the cassette loader's job
 * is to verify "this looks like a Stripe event," not "this is a
 * fully-typed Stripe.Event of the variant we expect."
 */
const stripeEventEnvelopeSchema = z.object({
	id: z.string().regex(/^evt_/, { message: 'Stripe event ids must start with `evt_`' }),
	object: z.literal('event'),
	type: z.string().min(1),
	api_version: z.string().nullable(),
	created: z.number().int().nonnegative(),
	livemode: z.boolean(),
	pending_webhooks: z.number().int().nonnegative(),
	request: z
		.object({
			id: z.string().nullable(),
			idempotency_key: z.string().nullable()
		})
		.nullable(),
	data: z.object({
		object: z.record(z.string(), z.unknown())
	})
});

const cassetteEventSchema = z.object({
	/**
	 * Offset from the cassette's `recordedAt`, in milliseconds.
	 * `0` means "delivered at the start of the scenario." Driver
	 * implementations decide whether to honour the offset (sleep)
	 * or replay back-to-back; the field is metadata either way.
	 */
	offsetMs: z.number().int().nonnegative(),
	event: stripeEventEnvelopeSchema
});

const cassetteSchema = z
	.object({
		version: z.literal(CASSETTE_VERSION),
		name: z.string().min(1),
		description: z.string(),
		recordedAt: z.iso.datetime({ offset: true }),
		stripeApiVersion: z.string().min(1),
		events: z.array(cassetteEventSchema).min(1, {
			message: 'A cassette must contain at least one event'
		})
	})
	.superRefine((cassette, ctx) => {
		// Events must be in non-decreasing offset order. Replay drivers
		// rely on this — sorting at load time would silently mask a
		// recording bug, so we fail loudly instead.
		for (let i = 1; i < cassette.events.length; i++) {
			const prev = cassette.events[i - 1];
			const curr = cassette.events[i];
			if (prev !== undefined && curr !== undefined && curr.offsetMs < prev.offsetMs) {
				ctx.addIssue({
					code: 'custom',
					path: ['events', i, 'offsetMs'],
					message:
						`events[${i}].offsetMs (${curr.offsetMs}) precedes ` +
						`events[${i - 1}].offsetMs (${prev.offsetMs}); ` +
						'cassettes must be ordered'
				});
			}
		}

		// Event ids must be unique within a cassette. The receiver's
		// idempotency layer will treat duplicates as already-processed
		// on the second arrival, which is correct behaviour but almost
		// certainly NOT what the cassette author wanted.
		const seenIds = new Set<string>();
		for (let i = 0; i < cassette.events.length; i++) {
			const entry = cassette.events[i];
			if (entry === undefined) continue;
			const id = entry.event.id;
			if (seenIds.has(id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['events', i, 'event', 'id'],
					message:
						`Duplicate event id "${id}" at events[${i}]. ` +
						'Use distinct evt_… ids within a cassette.'
				});
			}
			seenIds.add(id);
		}
	});

/**
 * The structured shape of a parsed cassette. Inferred from the Zod
 * schema so the schema is the single source of truth.
 */
export type Cassette = z.infer<typeof cassetteSchema>;
export type CassetteEvent = Cassette['events'][number];

export type ParseCassetteOk = { ok: true; cassette: Cassette };
export type ParseCassetteErr = { ok: false; issues: string[] };
export type ParseCassetteResult = ParseCassetteOk | ParseCassetteErr;

/**
 * Parse a cassette from raw JSON text or an already-parsed JS value.
 *
 * Returns a discriminated result rather than throwing — callers
 * (the loader, ad-hoc test scaffolding) want to surface the
 * specific Zod issue paths in their failure messages, not catch
 * exceptions and re-throw.
 *
 * Issues are flattened to a `string[]` with `path: message` shape
 * so they can be logged or asserted on directly. The full Zod
 * issue tree is not exposed: keeping the public API string-shaped
 * lets us swap validators later without breaking callers.
 */
export function parseCassette(input: unknown): ParseCassetteResult {
	const parsed = cassetteSchema.safeParse(input);
	if (parsed.success) return { ok: true, cassette: parsed.data };
	const issues = parsed.error.issues.map((issue) => {
		const path = issue.path.length === 0 ? '(root)' : issue.path.join('.');
		return `${path}: ${issue.message}`;
	});
	return { ok: false, issues };
}

/**
 * Same as `parseCassette` but throws on failure. Use in test
 * scaffolding where a cassette failing to parse is a developer
 * error and the stack trace is the diagnostic.
 *
 * The thrown error includes the full issue list as a single
 * newline-joined string — Vitest's failure output renders that
 * cleanly.
 */
export function parseCassetteOrThrow(input: unknown): Cassette {
	const result = parseCassette(input);
	if (result.ok) return result.cassette;
	throw new Error(`Invalid cassette:\n  - ${result.issues.join('\n  - ')}`);
}
