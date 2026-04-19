---
title: 'Bonus: Observability & Tracing'
module: 14
lesson: 10
moduleSlug: 'module-14-thank-you'
lessonSlug: 'bonus-10-observability-tracing'
description: 'Turn on SvelteKit 2.31 OpenTelemetry tracing, ship spans to a free backend, and stop guessing why the dashboard is slow for one user.'
duration: 25
preview: false
---

# Bonus: Observability — trace every request

You have shipped Contactly. It works on your machine. It works in staging. It works for most users most of the time. And then one Tuesday, someone on Slack says:

> "The dashboard takes 12 seconds to load for me."

You open Chrome DevTools, navigate to the dashboard, and it loads in 800 ms. You check your logs. Nothing abnormal. You check the database — no slow query alerts. You ask the user what browser they are using, what region, whether they are on wifi, whether they have a lot of contacts. You still cannot reproduce.

This is the problem observability solves.

Observability is the practice of asking arbitrary questions about your running system without knowing the questions in advance. "Why was this one request slow?" "What did this particular user's session spend time on?" "Which part of the Stripe checkout flow is the p95 latency sitting in?" With good logs alone, you cannot answer these questions — logs tell you _what_ happened, not _where time went_. Metrics tell you aggregates — p50 latency is 200ms — but cannot pinpoint individual slow users. **Traces** are what you need, and as of SvelteKit 2.31 (shipped October 2025) you can turn on distributed tracing with a single flag.

This lesson walks you through enabling OpenTelemetry tracing in Contactly, wiring it to a free backend (Honeycomb or Grafana Cloud), adding custom spans for Supabase queries, and reading a trace to find a real bottleneck.

By the end of this lesson you will:

- Understand the three pillars of observability (logs, metrics, traces) and when to reach for each.
- Enable SvelteKit's built-in tracing via the `experimental.tracing.server` flag.
- Install the OpenTelemetry SDK and configure `instrumentation.server.ts`.
- Export traces to Honeycomb, Grafana Cloud, or Jaeger.
- Annotate spans with custom attributes (user IDs, feature flags, tenant IDs).
- Read a waterfall trace to identify "the 800ms was spent in the count-contacts query."
- Set sampling policies for production cost control.

## 1. The three pillars

A one-paragraph primer so we have shared vocabulary:

**Logs** are discrete events: "user 123 logged in at 14:02". They are great for audit trails, debugging specific outcomes, and post-mortem reconstruction. They are bad for understanding _where time goes_ — a 2-second request produces no logs by default, and adding `console.log('step 1', Date.now())` everywhere is not a scalable strategy.

**Metrics** are aggregate numeric values over time: "p95 dashboard latency = 1.2s", "error rate = 0.3%". They are great for dashboards and alerts. They are bad for explaining why _one specific_ request was slow — you cannot drill in to see what that one request was doing.

**Traces** are time-stamped nested spans that represent one request's full journey: "handle hook took 10ms → load function took 180ms (of which 150ms was the Supabase query and 30ms was the Stripe lookup) → render took 20ms". Each span has a name, a duration, attributes (userId, tenantId), and parent-child relationships. They answer: "where did the 12 seconds go for this one user?"

For "the dashboard is slow for one user," traces are the only pillar that helps. Logs give you "the dashboard rendered" (useless). Metrics give you "the average is 800ms" (does not help the one 12-second user). Traces give you "for user 123, the count-contacts query took 11 seconds because they have 500,000 contacts and the query is not indexed."

## 2. What SvelteKit traces for you

When you flip the flag, SvelteKit automatically emits spans for:

- The `handle` hook (root span of every request).
- Each `handle` function in a `sequence()` chain (child spans of `handle`).
- Server `load` functions (`+page.server.ts`, `+layout.server.ts`).
- Universal `load` functions when they run on the server.
- Form actions.
- Remote functions (query, form, command, prerender).
- Endpoint handlers (`+server.ts` GET/POST/etc.).

You get this tree of spans for free, named consistently, with request URLs and route IDs as attributes. That alone is usually enough to find the bottleneck in a slow page. You can then add custom spans for your own expensive work (Supabase queries, Stripe API calls, third-party HTTP requests).

## 3. Turning it on

### `svelte.config.js`

```js
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		experimental: {
			remoteFunctions: true,
			tracing: {
				server: true
			},
			instrumentation: {
				server: true
			}
		}
	},
	compilerOptions: {
		experimental: {
			async: true
		}
	}
};

export default config;
```

Two flags:

- **`tracing.server: true`** — tells SvelteKit to emit spans at runtime using `@opentelemetry/api`. Without this, no spans are created; your instrumentation code would have nothing to capture.
- **`instrumentation.server: true`** — tells SvelteKit to look for `src/instrumentation.server.ts` (or `.js`) and execute it before any application code runs. This is the critical bit for tracing to actually work, because OpenTelemetry requires its SDK to be initialized _before_ any module that emits spans is imported.

Without the `instrumentation` flag, your SDK would load too late — after SvelteKit's internal modules, after your route files — and those modules would have already captured a reference to the no-op tracer from `@opentelemetry/api`. No spans would make it to your collector.

### Install the SDK

```bash
pnpm add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-proto import-in-the-middle
```

- `@opentelemetry/sdk-node` — the Node.js SDK. Boots the tracer provider.
- `@opentelemetry/auto-instrumentations-node` — a bundle of instrumentations for common Node APIs (http, fs, pg, etc.). Auto-generates spans for anything it can hook into without you writing code.
- `@opentelemetry/exporter-trace-otlp-proto` — exports spans in the OTLP (OpenTelemetry Protocol) format, which every modern tracing backend accepts. "proto" means binary protobuf (smaller than JSON).
- `import-in-the-middle` — enables OTel to instrument ESM imports. Required in Node 20+ when using ESM modules (which is every modern SvelteKit app).

### `src/instrumentation.server.ts`

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { createAddHookMessageChannel } from 'import-in-the-middle';
import { register } from 'node:module';

const { registerOptions } = createAddHookMessageChannel();
register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: 'contactly',
		[ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? 'dev'
	}),
	traceExporter: new OTLPTraceExporter({
		url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
		headers: {
			'x-honeycomb-team': process.env.HONEYCOMB_API_KEY ?? ''
		}
	}),
	instrumentations: [
		getNodeAutoInstrumentations({
			'@opentelemetry/instrumentation-fs': { enabled: false }
		})
	]
});

sdk.start();

process.on('SIGTERM', () => {
	sdk.shutdown().finally(() => process.exit(0));
});
```

Line-by-line:

**Lines 1–7: imports.**

- `NodeSDK` — the top-level SDK class. One instance per process.
- `getNodeAutoInstrumentations()` — returns an array of pre-configured instrumentations. Covers `http`, `fs`, `pg` (Postgres), `redis`, and many more.
- `OTLPTraceExporter` — sends spans to an OTLP endpoint.
- `resourceFromAttributes` + `ATTR_SERVICE_NAME` / `ATTR_SERVICE_VERSION` — constants from OpenTelemetry's semantic conventions. Using the constants (not string literals) ensures your traces are searchable and grouped correctly in every backend.
- `createAddHookMessageChannel` + `register` — the ESM import hook. This is the voodoo that lets OTel instrument ESM modules without monkey-patching.

**Lines 9–10: hook registration.** Registers the import hook. Must happen before any instrumentations are constructed.

**Lines 12–16: the Resource.** A Resource is the metadata shared by every span from this service. "service.name" and "service.version" are the two most important attributes — they tell the backend "these spans came from the contactly app, version X." Without them, your traces get filed under "unknown_service" in the backend, which is the observability equivalent of a mislabeled parcel.

**Lines 17–22: the exporter.**

- `url` — the OTLP HTTP endpoint of your backend. Read from env var so staging and production can go to different places (or nowhere in dev).
- `headers` — vendor-specific auth. Honeycomb uses `x-honeycomb-team`. Grafana Cloud uses HTTP Basic auth. Jaeger and most other collectors need no headers.

**Lines 23–26: auto-instrumentations.**

- `getNodeAutoInstrumentations()` returns all available instrumentations.
- `'@opentelemetry/instrumentation-fs': { enabled: false }` — disable fs instrumentation. It is extremely noisy (every Vite static asset read generates a span) and usually useless.

**Line 28: start.** Boots the SDK. After this, `@opentelemetry/api` calls made anywhere in your process will produce real spans.

**Lines 30–32: graceful shutdown.** On SIGTERM, flush pending spans to the exporter before exiting. Without this, your final 1–10 seconds of spans can be lost on deploy restarts.

### The `OTEL_EXPORTER_OTLP_ENDPOINT` env var

You need a destination. Three easy options:

**Honeycomb** (recommended for new apps — 20M events/month free):

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
HONEYCOMB_API_KEY=hcxik_xxx
```

**Grafana Cloud** (free tier: 50GB traces/month):

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo-prod-XX-prod-eu-west-0.grafana.net/otlp
```

Plus Basic auth headers; check Grafana's Tempo OTLP setup guide.

**Jaeger** (local dev):

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Open `http://localhost:16686` for the Jaeger UI.

Pick one, set the env var, restart your dev server. Spans should start flowing.

## 4. A first trace

Start the dev server. Hit the dashboard. Open your tracing backend (Honeycomb's query builder, Grafana's Explore, or Jaeger's UI). Look for the service `contactly`.

You should see a root span named something like `GET /dashboard` with a duration. Click into it. A waterfall appears:

```
GET /dashboard                                [350ms]
├── handle                                    [340ms]
│   ├── +layout.server.ts load                [50ms]
│   │   └── supabase.from('profile')          [40ms]
│   ├── +page.server.ts load                  [280ms]
│   │   ├── supabase.from('contacts').count   [250ms]    ←  bottleneck
│   │   └── supabase.from('activities')       [25ms]
│   └── render                                [10ms]
```

The 250ms in the count query is the bottleneck. Without tracing, you would have guessed and added `console.log`s. With tracing, it is visible at a glance.

## 5. Custom spans for Supabase

The auto-instrumentations cover a lot, but Supabase goes through HTTPS, and by default you get one generic `HTTP POST` span per DB call with no details about _which_ query. To fix this, wrap your Supabase calls in custom spans.

### `src/lib/server/tracing.ts`

```ts
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('contactly');

export async function tracedQuery<T>(
	name: string,
	attrs: Record<string, string | number | boolean>,
	fn: (span: Span) => Promise<T>
): Promise<T> {
	return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
		try {
			const result = await fn(span);
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (err) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : 'unknown'
			});
			span.recordException(err instanceof Error ? err : new Error(String(err)));
			throw err;
		} finally {
			span.end();
		}
	});
}
```

Line-by-line:

**Line 1:** import `trace` (the OpenTelemetry API's tracer registry), `SpanStatusCode` (enum for OK/ERROR), and the `Span` type.

**Line 3:** `getTracer('contactly')` — the name identifies this tracer in the SDK. It is the same name you used in the Resource.

**Lines 5–9: `tracedQuery` wrapper.** Takes a span name, static attributes, and an async function. Returns whatever the function returns.

**Line 10:** `startActiveSpan` — starts a new span and makes it the "active" one in the current async context. Child spans created inside the callback automatically become children of this one.

**Lines 11–15:** try/succeed path. Run the function, set status to OK, return the result.

**Lines 16–22:** error path. Set status to ERROR, record the exception on the span (which attaches the stack trace as an event), then re-throw so the caller handles the error normally.

**Lines 23–25:** `span.end()` in `finally`. Critical — a span that never ends leaks memory and never gets exported.

### Using the wrapper in a remote function

```ts
// src/routes/(app)/contacts/contacts.remote.ts
import * as z from 'zod';
import { error } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { tracedQuery } from '$lib/server/tracing';

export const getContacts = query(async () => {
	const { locals } = getRequestEvent();
	const user = await locals.getUser();
	if (!user) error(401, 'Unauthorized');

	return tracedQuery(
		'supabase.contacts.list',
		{ userId: user.id, table: 'contacts' },
		async (span) => {
			const { data, error: dbError } = await locals.supabase
				.from('contacts')
				.select('*')
				.eq('user_id', user.id)
				.order('created_at', { ascending: false });

			if (dbError) error(500, dbError.message);

			span.setAttribute('rowCount', data?.length ?? 0);
			return data;
		}
	);
});
```

Walkthrough:

- `tracedQuery` wraps the Supabase call. The generated span has name `supabase.contacts.list` and starts with the `userId` and `table` attributes.
- Inside the function, we receive the `span` — we can add dynamic attributes like `rowCount` based on the result.
- The wrapper handles OK/ERROR status automatically.

Now your trace waterfall looks like:

```
GET /contacts                                 [350ms]
├── handle                                    [340ms]
│   ├── getContacts (remote query)            [280ms]
│   │   └── supabase.contacts.list            [250ms]    ←  with userId, rowCount
│   └── render                                [10ms]
```

## 6. Augmenting SvelteKit's built-in spans

SvelteKit exposes the current request's root span and current span on `event.tracing`. Use them to annotate the spans SvelteKit is already emitting.

### `src/lib/server/auth.ts`

```ts
import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';

export async function requireAuthenticatedUser() {
	const event = getRequestEvent();
	const user = await event.locals.getUser();
	if (!user) error(401, 'Unauthorized');

	event.tracing.root.setAttribute('userId', user.id);
	event.tracing.root.setAttribute('userPlan', user.plan ?? 'free');

	return user;
}
```

Line-by-line:

**Line 1:** `getRequestEvent` from `$app/server` — works inside remote functions and hooks.

**Lines 4–7:** the auth helper. Standard "get user or 401" pattern.

**Line 9–10:** `event.tracing.root` is SvelteKit's root span for this request (the one named `GET /contacts` or whatever). Setting attributes on it means those attributes appear on _every_ child span (in Honeycomb: the trace list shows userId column; in Jaeger: you can search by userId tag).

`event.tracing.current` is also available — it returns the current span, which could be the handle span, a load function span, or a remote function span depending on where you are in the request lifecycle.

**Practical benefit:** in your backend, you can now filter traces by user. "Show me all traces from user abc-123 that took >500ms." That is the question that catches "dashboard takes 12 seconds for one user."

## 7. Sampling in production

Tracing every request in production is expensive — both in compute (each span adds a few microseconds) and in money (your backend charges per event). For a modest app, always-on tracing is fine. For a high-traffic app, sample.

### Basic head sampling

```ts
// src/instrumentation.server.ts
import { TraceIdRatioBasedSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
	sampler: new ParentBasedSampler({
		root: new TraceIdRatioBasedSampler(0.01)
	})
	// ... rest
});
```

`TraceIdRatioBasedSampler(0.01)` samples 1% of requests. `ParentBasedSampler` wraps it to honor the sampling decision of upstream services: if an upstream service said "this trace is sampled," we also sample it regardless of our ratio. This keeps distributed traces intact across service boundaries.

For a 10,000 req/day app, 1% = 100 traces/day is plenty to catch outliers. For error traces, add tail sampling (sample 100% of traces that contain errors) in your collector — that is a backend concern, not an SDK concern.

### Always sample errors

Tail-sampling requires an OpenTelemetry Collector deployed in front of your backend. Every serious observability setup has one. The collector's tail_sampling_processor can be configured to "sample 100% of traces containing a span with status=ERROR, and 1% of everything else." This ensures you catch every error without paying for every success.

Until you deploy a collector, you can do a crude version in the SDK: force-sample errors in the `handleError` hook by marking the span with a high-priority attribute and configuring your backend to surface it.

## 8. Protecting sensitive data

Spans have attributes. Attributes are text. Text can leak secrets. Defense principles:

- **Never put auth tokens, API keys, passwords, or session IDs in span attributes.** These end up in your backend where they can be queried. If your backend credentials leak, your whole audit trail becomes an attacker's password dictionary.
- **PII (email addresses, names, addresses) should be filtered.** Sending raw emails to Honeycomb may be illegal under GDPR or CCPA depending on your business. Use stable pseudonymized IDs instead — hash the email, store the userId.
- **Request bodies should be redacted.** The default `http` auto-instrumentation does not log request bodies by default. Keep it that way. If you need to know "what was in the POST," rely on your own application-level logs with explicit redaction.

A span attribute redactor (configured in the collector) is the industrial-strength approach. For small apps, discipline at the code level is enough.

## 9. Reading traces — a real investigation

Here is the workflow when a user reports "dashboard is slow":

1. **Find the user's trace.** In your backend, filter by `userId = abc-123`. Sort by duration desc. The slow ones surface at the top.
2. **Open a slow trace.** See the waterfall. The root `GET /dashboard` shows the total time.
3. **Find the longest child span.** In the waterfall, visually inspect which bar is longest. That is the bottleneck.
4. **Drill into its attributes.** A slow `supabase.contacts.list` span might have `rowCount: 500000` — "ah, this user has half a million contacts, that is why the query is slow." You now know: you need to add pagination, or index the column being ordered by.
5. **Compare to a fast user's trace.** Filter `userId = xyz-789` (a fast-loading user). Their waterfall shows `rowCount: 47`. Confirms the hypothesis.

This investigation takes two minutes with tracing. It would take two hours with just logs and metrics — and you would probably guess wrong on the first try.

## 10. Principal Engineer Notes

**Turn tracing on before you need it.** Retrofitting tracing to a production app _after_ an incident is painful. Turn it on while your app is healthy, let the backend accumulate a baseline, and when something breaks you have historical context.

**Traces answer "where did the time go." Logs answer "what happened."** Use both. Log user actions (signed up, created contact). Trace requests. When investigating, start with the trace, then correlate to logs using the `traceId` attribute that OTel auto-attaches to logs (via context propagation).

**Alert on p95, never on averages.** A 200ms average with 1% of requests at 10 seconds tells a user-facing story the average hides. p95 "95% of requests are under X" is the right quantile for user experience. p99 is often too noisy. Some teams track both.

**Distributed tracing across Supabase, Stripe, and your app is possible but requires header propagation.** Your app's outgoing HTTP calls to Stripe should include `traceparent` headers (OTel's http instrumentation does this automatically). Supabase RPC calls do too. If Stripe or Supabase publish their server-side spans, you get end-to-end traces. Most third parties do not publish, so your spans end at your outgoing request, and you see Stripe's latency as "time between send and receive" without knowing what Stripe was doing internally.

**Keep dev noise-free.** In dev, either do not set `OTEL_EXPORTER_OTLP_ENDPOINT` (the SDK becomes a no-op) or point it at a local Jaeger for debugging. Pushing dev traces to your production backend pollutes the signal.

**Cost management.** 20M events/month on Honeycomb sounds like a lot. For a 10k req/day app without sampling, you emit 10k × 30 days × ~10 spans/request = 3M events/month. Comfortable. For a 1M req/day app, unsampled you hit 300M events/month — expensive. Sample to 1% and you are back at 3M. Tune sampling early.

**The experimental flag caveat.** As of SvelteKit 2.57 both `tracing.server` and `instrumentation.server` are behind `experimental`. The API (what `event.tracing` exposes) is stable; what might change is subtle things like span names and built-in attribute keys. Watch the SvelteKit changelog for 3.0; tracing will almost certainly GA in that release.

**Verification steps:**

1. Turn on flags. Restart dev server. Confirm `pnpm dev` starts without errors.
2. Hit any page. Open the tracing backend. See the service `contactly`.
3. Click a trace. See the waterfall with `handle`, load, and (if used) remote function spans.
4. Add a `tracedQuery` wrapper around a Supabase call. See the custom span appear as a child in the waterfall.
5. Add `event.tracing.root.setAttribute('userId', user.id)` to your auth helper. In the backend, filter by userId — the filter should work.
6. Intentionally slow a query (add `await new Promise(r => setTimeout(r, 2000))` to a remote function). Reload. Confirm the trace shows a 2-second-ish span.
7. Throw an error in a remote function. Confirm the span's status is `ERROR` and the exception is attached.
8. Deploy to staging. Confirm traces flow from the real environment.
9. Configure sampling in staging (`TraceIdRatioBasedSampler(0.5)`). Reload 20 times. Confirm only ~10 traces show up.
10. Write a runbook: "when a user reports slowness, filter by userId, find the longest child span, check rowCount / external API duration." Pin it in the team wiki.

## You are done

That is the last bonus. You now have a 2026-state-of-the-art SvelteKit app: type-safe client-server RPC with remote functions, URL-aware modals via shallow routing, composable side effects with attachments, graceful async UI with boundaries, and production-grade observability. Everything in this module is the cutting-edge-but-stable Svelte toolbox — the team has poured three years of iteration into these APIs and they are about as good as web framework ergonomics get.

Two parting thoughts:

**Principal engineering is taste, and taste is earned.** The features in these four lessons are tools. Good engineers pick up tools and immediately apply them everywhere. Great engineers pick up tools and ask "when would I _not_ use this?" Shallow routing is not always right. Remote functions are not always right. A boundary is not always the right unit of error handling. Develop the instinct to ask when _not_ to reach for a pattern. That is the gap between "knowing SvelteKit" and "building a great product with SvelteKit."

**Ship, observe, iterate.** The observability lesson is not last by accident. It is the feedback loop that turns your theoretical knowledge into real-world understanding. You will be wrong about which queries are slow. You will be wrong about which UI flows confuse users. You will be wrong about which code paths produce errors. The only way to find out is to ship it, observe what actually happens, and adjust. Every lesson in this module is a tool for shipping faster and more safely; none of them replace the discipline of measuring what users actually experience.

Good luck with your app.
