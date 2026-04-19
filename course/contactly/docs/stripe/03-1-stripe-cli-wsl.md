# Lesson 5.3.1 — Stripe CLI on WSL

This is a footnote to Lesson 5.3 for developers on **Windows + WSL 2**.
If you're on macOS or native Linux, skip it — everything there "just
works."

## Install inside WSL, not Windows

Two places you might be tempted to install the CLI:

| Where                                  | Works? | Verdict                                                                                                                           |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Windows (Scoop / MSI installer)        | Yes    | But `stripe listen` can't forward to a WSL `localhost:5173` cleanly because Windows and WSL2 do not share `localhost` by default. |
| Inside your WSL distro (Debian/Ubuntu) | Yes    | **Use this.** WSL2's port forwarding makes `localhost:5173` resolve the same for the CLI and `pnpm run dev`.                      |

Inside your WSL shell:

```bash
# Debian / Ubuntu
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public \
  | sudo gpg --dearmor -o /usr/share/keyrings/stripe.gpg
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" \
  | sudo tee -a /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install -y stripe
```

Verify:

```bash
stripe --version
```

## Running on `localhost:5173` under WSL 2

WSL 2 exposes a lightweight VM; the dev server listens inside the VM
on `0.0.0.0:5173` and Windows forwards `localhost:5173` through
`wslhost.exe` for you. Two knobs to check:

1. **`pnpm run dev` must bind to all interfaces**, not just `127.0.0.1`.
   Vite defaults to `localhost` which _does_ get forwarded — but if
   you've customized it, set `server.host = '0.0.0.0'` in
   `vite.config.ts`.
2. **Windows Defender Firewall** occasionally blocks `wslhost.exe` on
   first run. Allow it when prompted. Check
   `netsh interface portproxy show all` from PowerShell to confirm the
   proxy exists.

Then, in two WSL panes:

```bash
# Pane 1
pnpm run dev
# Pane 2
pnpm run stripe:listen
```

…and `stripe listen` will reach `localhost:5173` exactly the same as on
macOS.

## `stripe login` browser handoff

`stripe login` opens a browser to complete the OAuth handshake. Under
WSL, it prints the URL and attempts `wslview` (or `xdg-open`) to open
it in your Windows browser. If neither is available:

```text
> Your pairing code is: ...
> To authenticate with Stripe, please go to:
>   https://dashboard.stripe.com/stripecli/confirm_auth?t=...
```

Copy the URL into a Windows browser manually; the handshake completes
on either side.

## Known gotcha: stale webhook secret across reboots

Because `stripe listen` generates a **fresh** webhook signing secret
every session, rebooting WSL (or closing the pane) invalidates the
`STRIPE_WEBHOOK_SECRET` in your `.env`. Re-copy it on each fresh
listener start during development.

This is the same gotcha on every platform — it's just more visible in
WSL because people reboot the distro more often than their Mac.

## Everything else applies

The rest of Lesson 5.3 — `stripe trigger`, `stripe logs tail`,
`stripe events resend`, and the Lesson 5.5 fixtures workflow — is
identical on WSL.
