---
title: '5.3 - Setup Stripe CLI'
module: 5
lesson: 3
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '03-setup-stripe-cli'
description: 'Install and configure the Stripe CLI for local webhook testing and event simulation.'
duration: 10
preview: false
---

## Overview

Stripe's webhooks are how Stripe's servers notify your server when something happens — a subscription is created, an invoice is paid, a charge is disputed. In production your server is publicly reachable at some URL like `https://contactly.com/api/webhooks/stripe`, and Stripe can hit that URL directly. In development your server is at `http://localhost:5173`, which is not reachable from the internet. Stripe can't send a webhook to `localhost`. That's a fundamental limitation of, you know, the internet.

The **Stripe CLI** solves this. Installed on your laptop, it opens an outbound WebSocket to Stripe's cloud; Stripe pushes events down the WebSocket; the CLI re-emits them as HTTP POSTs against your local URL. It's an elegant NAT-piercing trick that makes local webhook development **as easy as local API development**. Without it, you'd either run a tunnel like ngrok (more setup, less Stripe-specific) or not test webhooks locally at all (recipe for production surprises).

This lesson installs the CLI, logs into your Stripe account, starts the forwarder, and triggers test events — all without writing any app code. Module 6 will wire up the actual `/api/webhooks/stripe` route; for now we're preparing the plumbing.

## Prerequisites

- Lesson 5.1 complete (you have a Stripe account and API keys).
- A working package manager: [Homebrew](https://brew.sh) on macOS, [Scoop](https://scoop.sh) on Windows, or a package manager on Linux.
- WSL users: skip this lesson's install step and use the companion **Lesson 5.3.1** for WSL-specific instructions.

## What You'll Build

- The Stripe CLI installed globally.
- A logged-in CLI session linked to your Stripe test-mode account.
- A `stripe listen` process forwarding webhook events to your (soon-to-exist) local webhook endpoint.
- A webhook signing secret (`whsec_...`) captured for use in your `.env`.
- A test event triggered from the CLI to verify the full pipe works.

---

## Step 1: What the Stripe CLI Is (and Isn't)

The Stripe CLI is a single executable — `stripe` — that does four main things:

1. **`stripe login`** — authenticates your laptop against your Stripe account, so subsequent commands can act on your behalf without you pasting the secret key everywhere.
2. **`stripe listen`** — the crown jewel. Opens a tunnel from Stripe's cloud to your local machine so webhooks can reach `localhost`.
3. **`stripe trigger`** — simulates Stripe events (e.g., "pretend a checkout session completed"). Lets you develop against events without doing manual flows for every test.
4. **`stripe`** (everything else) — a command-line interface to every Stripe API endpoint. `stripe customers list`, `stripe subscriptions retrieve sub_xxx`, etc. Handy, but not what we'll use most.

Crucially: the CLI is **development-only**. You never run it in production. Production webhooks go straight from Stripe's servers to your public URL; no tunnel needed, no CLI involved. The CLI exists to bridge the one environment where webhooks are normally impossible: your laptop.

---

## Step 2: Installing the CLI

### macOS (Homebrew)

```bash
brew install stripe/stripe-cli/stripe
```

Homebrew pulls the latest binary from Stripe's official tap. After install, verify:

```bash
stripe --version
```

You should see something like `stripe version 1.21.x` (any 1.x is fine).

### Windows (Scoop)

```bash
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
```

Then:

```bash
stripe --version
```

### Windows (WSL)

**Use Lesson 5.3.1**, which explains the one networking gotcha WSL introduces. The install works the same (Homebrew-on-Linux or the official `.deb`), but `stripe listen` needs an extra flag to reach your Windows-side dev server.

### Linux (other)

Stripe publishes official `.deb`, `.rpm`, and static binaries at [github.com/stripe/stripe-cli/releases](https://github.com/stripe/stripe-cli/releases). Pick the one for your distribution, install, and verify:

```bash
stripe --version
```

### Why a dedicated installer and not just `pnpm add -g stripe-cli`?

The Stripe CLI is written in Go, not Node. It ships as a native binary because (a) it needs to be startable without Node being installed, (b) it needs low-level network APIs for the WebSocket tunnel, and (c) it's fast. Distributing it via OS package managers (brew, scoop, apt) is the right call.

`pnpm add stripe` installs the **Node SDK** — a totally different thing. We'll install that in Module 6 when we start writing server code. CLI and SDK are siblings with the same parent company, not variants of each other.

---

## Step 3: Logging In — `stripe login`

With the CLI installed, link it to your Stripe account:

```bash
stripe login
```

You'll see output like:

```
Your pairing code is: xxxx-yyyy-zzzz
Press Enter to open up the browser (^C to quit)
```

Press Enter. A browser window opens to a Stripe URL showing the same pairing code. **Verify the codes match**, then click **Allow access**. The CLI completes the handshake and prints:

```
> Done! The Stripe CLI is configured for [your account name]...
```

### What `stripe login` actually does

Under the hood:

1. The CLI generates a random pairing code locally.
2. It opens a WebSocket to Stripe's cloud advertising "I am CLI instance X, my pairing code is Y."
3. The browser takes you to Stripe's dashboard, logged in as you, showing code Y and asking for approval.
4. When you click Allow, Stripe's cloud sends the CLI a **restricted API key** tied to your account, scoped appropriately for CLI use.
5. The CLI stores that key in `~/.config/stripe/config.toml` (macOS/Linux) or `%APPDATA%\stripe\config.toml` (Windows).

Subsequent CLI commands use that stored key. You never paste your `sk_test_` or `sk_live_` anywhere; the CLI handles its own credential, and Stripe can revoke it from the dashboard at any time (**Developers → API keys → CLI keys**).

The code-matching step is anti-phishing — it guarantees the CLI on your machine is talking to the same session you just approved, not a malicious CLI on some other machine.

### Verify the login — `stripe whoami`

```bash
stripe whoami
```

Output:

```
Your account name is: [your account]
Your account ID is: acct_xxxxxxxxxxxxxxxxxx
You are logged in as test mode
```

The last line matters. **Make sure it says "test mode."** If it says live mode, run `stripe login --mode test` to switch (or pass `--live` / `--test` to individual commands). We work exclusively in test mode until Module 17.

---

## Step 4: Starting the Webhook Forwarder — `stripe listen`

Now the headline feature. Run:

```bash
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

You'll see:

```
> Ready! You are using Stripe API Version [2026-03-25.dahlia]. Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (^C to quit)
```

**That `whsec_...` string is the critical piece of this whole lesson.** Don't close the terminal window. Copy the `whsec_...` value — we'll paste it into `.env` in a moment.

### What this command does

- **`stripe listen`** — the subcommand that opens a webhook tunnel.
- **`--forward-to localhost:5173/api/webhooks/stripe`** — where to forward events. `localhost:5173` is SvelteKit's default dev port. `/api/webhooks/stripe` is the path our route will live at (we build it in Module 6). The CLI prepends `http://` automatically.
- **No `--events` filter** — by default, `stripe listen` forwards **every event type** Stripe emits. You can filter with `--events customer.subscription.created,invoice.paid` if you want to reduce noise, but in development the firehose is usually what you want.

Once running, the CLI is waiting for events. Any event Stripe generates — from a manual action in the dashboard, from a CLI trigger, from API calls by your dev server — will stream in here and get re-sent as an HTTP POST to `http://localhost:5173/api/webhooks/stripe`.

### Testing the forwarder by hand

Open a second terminal (leave `stripe listen` running in the first). Run:

```bash
stripe trigger checkout.session.completed
```

You should see:

1. In the **trigger terminal**: a sequence of log lines ending with `Trigger succeeded!`.
2. In the **`stripe listen` terminal**: an event like `<-- [200] POST http://localhost:5173/api/webhooks/stripe` (or `404` if your dev server isn't running yet — that's fine for now).

The fact that the CLI is attempting the delivery proves the tunnel works. Whether your route handles the payload is Module 6's problem.

### The `whsec_...` signing secret

Every event Stripe forwards includes a `Stripe-Signature` header — an HMAC-SHA256 signature computed with the webhook's signing secret. Your route will verify that signature against the same secret to confirm the request really came from Stripe (and not a random attacker POSTing fake events). The `whsec_...` string printed by `stripe listen` is that secret.

**Important:** the secret from `stripe listen` **changes every time you run the command**. Each new `stripe listen` session generates a fresh secret. This is a security feature (rotating is fine; compromising a dead session is useless), but it means you have to re-copy it into your `.env` whenever you restart the listener.

Well, almost. There are a few ways to avoid the friction:

- **Keep `stripe listen` running** while you develop. The secret stays the same for the lifetime of the process. This is the norm.
- **Use `stripe listen --print-secret`** as a one-liner to fetch a stable secret for your session without starting a forwarder. Usually you don't need this; just keep the listener running.
- **In production**, use the dashboard's configured webhook endpoint, which has a **permanent** `whsec_...` secret. That secret doesn't rotate unless you explicitly rotate it. We'll wire up the production endpoint in Module 17.

For the whole course up until deployment: run `stripe listen`, copy the `whsec_...` to `.env`, and leave it running. Any time you restart the listener, copy the new secret over.

---

## Step 5: Put the Signing Secret in `.env`

We don't have a `.env` yet with a `STRIPE_WEBHOOK_SECRET` slot (that's Lesson 5.7). For now, just confirm you can find the secret and understand the plan:

```bash
# .env (final shape, not yet filled in — we'll do this in Lesson 5.7)
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_value_from_stripe_listen
```

The `STRIPE_WEBHOOK_SECRET` is what our route will read to verify signatures. Three keys total — publishable, secret, webhook secret.

**Reminder:** `.env` must be in `.gitignore`. We set this up properly in 5.7. Do not accidentally commit it.

---

## Step 6: Triggering Events — `stripe trigger`

The `stripe trigger` command fires off a real event in your Stripe account — you can watch it show up in **Developers → Events** in the dashboard, in your `stripe listen` output, and (once you have a route) in your server logs. It's how you test webhook handlers without manually completing checkouts.

Useful triggers for Contactly:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
```

Each of these creates real Stripe resources in your test account (a test customer, a test subscription, etc.) and emits the event. The CLI output shows the full chain: what was created, what IDs were assigned, and what events fired.

### Listing every supported trigger

```bash
stripe trigger --help
```

Scroll through — there are dozens. Most you'll never need. Contactly uses the six listed above, plus maybe `charge.refunded` for the refund flow.

### Custom payloads with fixture files

For advanced cases — say, triggering `customer.subscription.updated` with a specific status like `past_due` — you can override fields with a fixture JSON file:

```bash
stripe trigger customer.subscription.updated --override subscription:status=past_due
```

We won't use this until Module 8's idempotency testing. For now, the vanilla triggers are enough.

---

## Step 7: End-to-End Smoke Test

Let's confirm the whole chain works before moving on. You don't have a webhook route yet, but the CLI's acknowledgment tells us everything upstream of your route is good.

**Terminal 1:**

```bash
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

Leave this running. Note the `whsec_...`.

**Terminal 2:**

```bash
stripe trigger checkout.session.completed
```

You should see `Trigger succeeded!` at the end of Terminal 2's output.

**Back in Terminal 1**, you should see event delivery attempts like:

```
2026-04-18 10:00:00 --> checkout.session.completed [evt_xxxxx]
2026-04-18 10:00:00 <-- [404] POST http://localhost:5173/api/webhooks/stripe [evt_xxxxx]
```

The `404` is expected — you haven't built the route yet. What matters is that the line exists at all. The tunnel is working.

**Cross-check in the dashboard:**

Go to **Developers → Events**. You should see a new `checkout.session.completed` event with a timestamp matching when you ran `stripe trigger`. That event is real; the `stripe trigger` command didn't simulate an event in memory — it created an actual Stripe resource and emitted an actual event.

---

## Common Mistakes

### Mistake 1: Killing `stripe listen` between tests

You run `stripe listen`, copy the `whsec_...` to `.env`, close the terminal when you go to lunch, reopen it after, get a new `whsec_...`, forget to update `.env`. Now every webhook fails signature verification because your route is checking against the old secret.

**Defense:** keep `stripe listen` running as a long-lived process during development. If you must restart it, `pbcopy < (stripe listen --print-secret)` the new value and update `.env`.

### Mistake 2: Pointing `--forward-to` at the wrong port

SvelteKit defaults to 5173, but some projects use 3000, 8080, or a custom port. Check your `package.json` scripts; if `pnpm dev` starts on a different port, match it in `--forward-to`.

A common typo: `--forward-to https://localhost:5173/...` (with `https://` — SvelteKit dev is HTTP by default). The CLI is lenient, but if you get weird TLS errors, drop the scheme or use `http://`.

### Mistake 3: Running the CLI in live mode without realizing

`stripe login --live` logs you into live mode. Every CLI command after that acts on your live account — including `stripe trigger`, which will create real customers and real subscriptions.

**Defense:** before running anything stateful, `stripe whoami`. If it says live, switch (or prefix commands with `--test`).

### Mistake 4: Sharing a `whsec_...` from your laptop with teammates

Each developer running their own `stripe listen` gets their own secret. You can't meaningfully share them — each secret is bound to one CLI instance and one account. If your teammate's webhook isn't firing, the answer isn't "send me your whsec\_"; it's "run `stripe listen` on your own machine."

### Mistake 5: Forgetting the CLI is dev-only

Some engineers, new to Stripe, try to install the CLI on their production server and run `stripe listen` there. It works — but it's the wrong pattern. In production, webhooks go directly from Stripe's servers to your production URL via a configured webhook endpoint (dashboard → Developers → Webhooks). No CLI, no tunnel, no transient secret. We set this up in Module 17.

### Mistake 6: Assuming `stripe trigger` doesn't touch real resources

It does. `stripe trigger customer.subscription.created` **creates an actual Stripe subscription** in your account (in test mode, so no money moves). After many triggers, your test account has dozens of zombie customers and subscriptions. That's fine — test data is disposable and you can bulk-delete it — but don't be surprised to see clutter accumulating. (We'll do a cleanup pass in Lesson 5.7.)

---

## Principal Engineer Notes

### Why the CLI is better than ngrok/localtunnel for Stripe

Generic tunnel tools (ngrok, localtunnel, cloudflared) work for Stripe webhooks too — just expose your localhost, configure the public URL in the dashboard, and Stripe will POST to it. But the Stripe CLI has four wins:

1. **No public URL.** The tunnel is outbound-only (laptop → Stripe). You're not exposing anything publicly reachable. If your laptop is behind a firewall that blocks inbound, the CLI still works; ngrok doesn't.
2. **Zero dashboard configuration.** You don't add an endpoint to the Webhooks page, don't remember to remove it, don't have stale endpoints listed for coworkers to see.
3. **Built-in signing secret.** The CLI prints a secret scoped to the session. With ngrok, you'd create a webhook endpoint in the dashboard, note its `whsec_`, and juggle the correspondence between the dashboard URL and the tunnel URL.
4. **First-party support.** When the CLI has a bug, Stripe's own engineering team fixes it. When ngrok has a bug, you're one company removed from the fix.

For any non-Stripe webhook development (e.g., GitHub webhooks, Slack event subscriptions), ngrok is still the answer. For Stripe specifically, the CLI is strictly better.

### The tunnel is an outbound WebSocket — why that matters

Most developer tools either need inbound ports (problematic behind corporate NATs) or use a third-party rendezvous server with its own security caveats. Stripe's CLI opens a **WebSocket from your laptop to Stripe**. Stripe's servers can push events down the WebSocket, but there's no inbound port on your laptop and no third-party in the middle.

This model is the same one used by Cloudflare Tunnels, Tailscale relays, and most modern "just works behind a firewall" networking products. It's also the right mental model for **reverse channels** in distributed systems: the client reaches out, the server pushes back. You'll see variations of this pattern everywhere — MQTT, WebRTC data channels, SignalR — once you've internalized it.

### Writing webhook handling from scratch vs. using Stripe's machinery

Could you build this whole pipeline yourself? Yes. You'd:

1. Run an HTTPS server somewhere public.
2. Define your own payload schema.
3. Implement HMAC signature verification.
4. Handle retries, deduplication, replay windows.
5. Build a dashboard to observe events.
6. Build a replay tool.

This is months of work for a team of engineers, and Stripe gives it to you for free. The CLI is the dev-time half of that machinery. Respect the lift that was saved.

The corollary: when designing your own systems, **look for opportunities to do for your users what Stripe did for you**. A good developer platform is often 30% clever protocol design and 70% well-done operational tooling. The CLI is a prime example of the 70%.

### Treat the CLI as a black box you trust

You could, theoretically, reimplement `stripe listen` yourself (it's just a WebSocket subscriber re-emitting HTTP). You shouldn't. The value is that Stripe's team maintains it, keeps it compatible with API changes, and ships improvements (better logging, filtering, multiplexing multiple listens). Adopt first-party tools when they're available and high quality.

### The CLI also runs in CI

Advanced pattern: some teams run `stripe listen` inside their CI pipeline for integration tests. The test spins up the dev server, starts the CLI, triggers a sequence of events, and asserts the server responded correctly. We won't do this in Contactly (our integration story uses the `stripe trigger` payloads directly), but it's a valid pattern once your billing flows get complex.

---

## Summary

- Installed the Stripe CLI (`brew` on macOS, `scoop` on Windows, `.deb`/static binary on Linux).
- Linked the CLI to your account with `stripe login` (verify with `stripe whoami`, confirm test mode).
- Ran `stripe listen --forward-to localhost:5173/api/webhooks/stripe` to start the webhook tunnel.
- Captured the session's `whsec_...` signing secret (we'll paste it into `.env` in Lesson 5.7).
- Tested the tunnel with `stripe trigger checkout.session.completed` and confirmed the delivery attempt (404 is fine — no route yet).
- Understood why the CLI beats ngrok for Stripe work, and internalized that it's a dev-only tool.

## What's Next

Windows developers working inside WSL hit one networking snag the CLI doesn't document loudly — `localhost` inside WSL and `localhost` in your Windows browser aren't quite the same interface. Lesson 5.3.1 is a short, focused fix. Non-WSL readers can skip it and go straight to Lesson 5.4, where we start modeling Stripe's Products and Prices.
