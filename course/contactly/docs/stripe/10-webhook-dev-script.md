# Lesson 6.3.1 — Webhook Dev Script

Two terminals, one command. `pnpm run stripe:dev` boots SvelteKit's
dev server _and_ the Stripe CLI listener in the same process group,
prefixes their output, and surfaces the per-session
`STRIPE_WEBHOOK_SECRET` as a copy-pasteable line so the most common
"signature verification failed" gotcha disappears.

## Why a wrapper, not just two `pnpm` scripts

The two-pane pattern (`pnpm run dev` left, `pnpm run stripe:listen`
right) works fine. But it has three failure modes a wrapper makes
either impossible or visible:

1. **Stale `whsec_...`.** Every time `stripe listen` boots, it mints
   a new signing secret. If `.env` still has yesterday's value, every
   forwarded event 400s on the receiver. The wrapper prints the new
   value with a yellow `[stripe-secret]` prefix the moment the listener
   logs it.
2. **Half-up stack.** If the listener crashes (auth lapsed, network
   blip), the dev server keeps running and silently accepts no webhook
   traffic for as long as the developer doesn't notice. The wrapper
   treats one sibling exit as "shut both down" — loud failure beats
   quiet one.
3. **Mixed-prefix output.** Without prefixes, `[vite]`, `[svelte]`,
   `stripe`'s own logs, and any `console.info` from your handler all
   blur together. The wrapper paints `[app]` cyan, `[stripe]` magenta,
   `[stripe-secret]` yellow, `[dev]` grey — useful when grepping a
   long session.

## Usage

```bash
pnpm run stripe:dev
```

Expected output the first time:

```text
[dev] Spawning SvelteKit (PORT=5173) and `stripe listen` (forward-to=http://localhost:5173/api/webhooks/stripe). Ctrl-C to shut both down.
[stripe] > Ready! You are using Stripe API Version [2026-03-25.dahlia]. Your webhook signing secret is whsec_lk3D…hYz2 (^C to quit)
[stripe-secret] Copy this into course/contactly/.env then restart `pnpm run dev`:
               STRIPE_WEBHOOK_SECRET="whsec_lk3D…hYz2"
[app]   VITE v8.0.8  ready in 412 ms
[app]   ➜  Local:   http://localhost:5173/
```

Paste the `STRIPE_WEBHOOK_SECRET` line into `.env` once per CLI
session (e.g. once per laptop reboot). The `[app]` process needs to
restart to pick up the new env value — Ctrl-C and rerun
`pnpm run stripe:dev`.

## What it does NOT do

- **Mutate `.env`.** The script never writes to your filesystem.
  Files in `.env` are sacred — silently rewriting them would be the
  exact kind of "magic" that bites in CI a week later. The CLI
  prints; you paste.
- **Replace `pnpm run stripe:listen` for non-localhost URLs.** If
  you're testing against a public ngrok/smee tunnel, run the listener
  manually with `--forward-to https://...`. The wrapper hard-codes
  `http://localhost:5173/api/webhooks/stripe` because that's the
  90%-case for course work.
- **Run in CI.** The `[stripe]` half needs an interactive `stripe
login` to have happened; CI uses signed fixtures + the `vitest`
  webhook handler test (see Lesson 6.3) instead.

## Triggering events

In a _third_ terminal — once the dev pair is up — fire any of the
Stripe-curated test events:

```bash
pnpm run stripe:trigger checkout.session.completed
pnpm run stripe:trigger customer.subscription.created
pnpm run stripe:trigger invoice.payment_failed
```

The `[stripe]` pane shows the dispatch (`<- POST /api/webhooks/stripe
[200 OK]`); the `[app]` pane shows the handler's `console.info` line.
That round-trip is the "smoke test" for the entire integration —
green from end to end before you move on to Module 6.4 (storage
idempotency) or Module 7 (linking customers to users).

## Failure modes you'll see and fix

| Symptom in `[stripe]`                                      | Cause                                                                          | Fix                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `<- POST /api/webhooks/stripe [400 Bad Request]`           | `STRIPE_WEBHOOK_SECRET` in `.env` doesn't match the listener's current secret. | Copy the `[stripe-secret]` line, paste into `.env`, Ctrl-C and rerun.                 |
| `<- POST /api/webhooks/stripe [500 Internal Server Error]` | Handler threw. Check `[app]` for the stack trace.                              | Fix the handler; Stripe will retry the event for ~3 days, see Lesson 6.2 retry table. |
| `Could not connect to host stripe.com`                     | No internet, or `stripe login` token expired.                                  | Re-auth: `stripe login` (separate terminal) then rerun `stripe:dev`.                  |
| `EADDRINUSE: ::: 5173`                                     | A previous dev server didn't shut down.                                        | `lsof -ti:5173 \| xargs kill -9` and rerun.                                           |

## Implementation notes

The script is `scripts/stripe-dev.ts`, ~120 lines of Node — no extra
dependencies. It uses `child_process.spawn` (not `exec`) to keep
both pipes streaming, parses the listener's stdout for a `whsec_…`
match, and registers a `SIGINT`/`SIGTERM` handler so a single Ctrl-C
takes the whole dev pair down. Reading the source is the fastest way
to understand what'd happen if you wanted to add, say, an
`pnpm run db:start` companion to the same orchestrator (Module 12.7
might).
