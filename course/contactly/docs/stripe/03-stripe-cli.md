# Lesson 5.3 — Setup the Stripe CLI

The Stripe CLI is the developer-side counterpart to the Dashboard. We
use it for four jobs:

1. **Authenticating** the CLI against your test-mode Stripe account
   (`stripe login`).
2. **Forwarding webhooks** from Stripe to `localhost`, so events fire
   in development without a public URL (`stripe listen`).
3. **Triggering events** to exercise webhook code paths
   (`stripe trigger`).
4. **Seeding products and prices** from a JSON fixture file
   (`stripe fixtures` — Lesson 5.5).

You'll spend more time with `stripe listen` than with any other CLI
tool over Modules 6–10, so let's wire it into the project now.

## Install

| Platform         | Command                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| macOS (Homebrew) | `brew install stripe/stripe-cli/stripe`                                                          |
| Linux (apt/dnf)  | See <https://docs.stripe.com/stripe-cli> for repo setup                                          |
| Windows (Scoop)  | `scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git && scoop install stripe` |
| Windows (WSL)    | Read **Lesson 5.3.1** before installing                                                          |
| Docker           | `docker run -it --rm stripe/stripe-cli` (no persistent auth)                                     |

Verify the install:

```bash
stripe --version
```

You should see `stripe version 1.x.y`. The course is tested against
1.40+; older versions miss the JSON-fixtures format we use in 5.5.

## Authenticate

```bash
stripe login
```

This opens a browser, asks you to authorize the CLI against your
Stripe account, and writes a per-machine API key into
`~/.config/stripe/config.toml` (macOS/Linux) or `%APPDATA%\stripe`
(Windows). The CLI uses this key for every subsequent command, scoped
to your **test mode** by default. Live mode requires an explicit
`--live` flag on every command — there is no global "switch to live"
command, by design.

> **The CLI's stored key is not the same as the Restricted API Key
> your application code will use.** The CLI key is a personal,
> account-scoped secret that lets you do anything you can do in the
> Dashboard. Your application code uses a separate Restricted API Key
> (`rk_test_...`) with only the permissions Contactly needs. We
> create that RAK in Lesson 6.1, when we install the Node SDK.

## Forward webhooks to your local app

Once the app exposes `/api/webhooks/stripe` (Lesson 6.3), this command
keeps a long-lived connection to Stripe and POSTs every test-mode
event to your local server:

```bash
pnpm run stripe:listen
```

which runs:

```bash
stripe listen --forward-to http://localhost:5173/api/webhooks/stripe
```

On startup, the CLI prints a webhook signing secret like:

```text
> Ready! Your webhook signing secret is whsec_abc123... (^C to quit)
```

**Copy that secret into `.env` as `STRIPE_WEBHOOK_SECRET`.** It's
unique per `stripe listen` session in test mode; the CLI rotates it
every time you start a new listener. (In production, the signing
secret is permanent and shown in the Dashboard — see Lesson 12.5.)

Run `pnpm run stripe:listen` in a terminal alongside `pnpm run dev`
during all of Modules 6–10. Every Checkout completion, subscription
renewal, and invoice payment in test mode will deliver to your local
endpoint.

## Trigger events on demand

Don't wait for a real customer flow to test a webhook handler. Force
the event:

```bash
pnpm run stripe:trigger checkout.session.completed
pnpm run stripe:trigger customer.subscription.updated
pnpm run stripe:trigger invoice.payment_failed
```

`stripe trigger <event>` builds a realistic-shaped payload server-side
in your Stripe test account, which then fires the webhook through your
running `stripe listen`. Module 6 adds an integration-test recipe that
chains a trigger with a Playwright assertion against the DB.

## Useful CLI subcommands

| Command                                         | What it does                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `stripe logs tail`                              | Live tail of the API request log, filterable by status / path / RAK |
| `stripe events resend <event_id>`               | Replay a past event to your active listener                         |
| `stripe customers list --limit 5`               | Inline shell access to read API resources                           |
| `stripe products create --name foo`             | Create resources from the shell, useful for one-offs                |
| `stripe fixtures stripe/fixtures/products.json` | Seed all our products + prices from JSON (Lesson 5.5)               |
| `stripe completion`                             | Print a shell-completion script — pipe into your shell config       |

## A typical Module-6+ workstation

Three terminal panes, all in `course/contactly/`:

```text
┌─────────────────────────────┬─────────────────────────────┐
│ pnpm run dev                │ pnpm run stripe:listen       │
│ (SvelteKit + Vite)          │ (forwards webhooks to :5173)│
├─────────────────────────────┴─────────────────────────────┤
│ pnpm run stripe:trigger ... / git / etc.                   │
└────────────────────────────────────────────────────────────┘
```

A fourth pane running `pnpm run db:start` (Supabase) is a one-time
boot, then `db:status` confirms it's still up. With those four
processes alive, the entire Stripe + Supabase development loop is
fully self-contained on `localhost`.
