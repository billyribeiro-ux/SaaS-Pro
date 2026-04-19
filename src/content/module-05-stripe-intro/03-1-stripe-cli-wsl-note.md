---
title: '5.3.1 - Stripe CLI WSL Note'
module: 5
lesson: 3
moduleSlug: 'module-05-stripe-intro'
lessonSlug: '03-1-stripe-cli-wsl-note'
description: 'Windows Subsystem for Linux users: how to get Stripe CLI webhook forwarding working correctly.'
duration: 3
preview: false
---

## Overview

This is a short, targeted lesson for readers developing on **Windows Subsystem for Linux (WSL)**. macOS and native Linux developers can skip it — your `localhost` Just Works with the Stripe CLI. WSL users, read on: there's exactly one networking boundary that can make `stripe listen --forward-to localhost:5173/...` silently fail, and exactly two ways to fix it.

The lesson is short, but the concept (how `localhost` behaves across the WSL2 hypervisor boundary) is worth internalizing — it explains why a lot of other "it works on my Mac" issues show up in WSL too.

## Prerequisites

- Lesson 5.3 read (you understand what `stripe listen` does).
- You are running WSL2 (not WSL1) — check with `wsl --version` in PowerShell. WSL1 has different networking semantics and isn't covered here; if you're on WSL1, upgrade to WSL2 first.
- The Stripe CLI is installed **inside** your WSL distribution (Homebrew-on-Linux, the `.deb` package, or the static binary).

## What You'll Build

- A working `stripe listen` forwarder that reaches your SvelteKit dev server regardless of which side (Windows vs. WSL) the dev server is running on.
- A clear mental model of the WSL2 networking boundary.

---

## Step 1: Why `localhost` Is the Problem

WSL2 runs your Linux distribution inside a lightweight Hyper-V virtual machine. That VM has **its own network interface** — a virtual NIC bridged to Windows via a hypervisor-managed subnet (typically in the `172.x.x.x` range).

That means "localhost" is ambiguous:

- **Inside WSL**, `localhost` (127.0.0.1) is the loopback interface of the **Linux VM**.
- **Inside Windows**, `localhost` is the loopback interface of the **Windows host**.

They are **not the same network interface**.

Windows 11 and newer Windows 10 versions include a feature called **localhost forwarding** that papers over this gap for most tools — Windows automatically forwards `127.0.0.1:X` on the host side to the WSL VM for ports bound by Linux processes. This is why, for a lot of dev work, it just works.

But the Stripe CLI's `--forward-to localhost:5173` isn't trying to _receive_ on localhost — it's trying to _send_ to localhost. The direction matters:

- If `stripe listen` is running **inside WSL** and your SvelteKit dev server is **also inside WSL**: works fine. Both processes share the Linux VM's loopback.
- If `stripe listen` is running **inside WSL** and your SvelteKit dev server is running **on Windows**: `localhost` from inside WSL points at the Linux VM, not at Windows. The forwarder sends to port 5173 on the Linux VM — nothing is listening there — and you get connection-refused errors.
- If `stripe listen` is running **on Windows** and your dev server is **anywhere reachable from Windows**: works fine.

The bug class is always the same: **the CLI's `localhost` resolves differently than the browser's `localhost`**.

---

## Step 2: Diagnose Your Setup

Run this command in your WSL shell:

```bash
pnpm dev
```

(Assuming Contactly is set up — if not, any quick `node -e "require('http').createServer().listen(5173)"` works for testing.)

Open a browser on Windows and go to `http://localhost:5173`. If the page loads, great — Windows' localhost forwarding is working for inbound (browser → dev server). But that doesn't tell us if the CLI's outbound forwarding works.

Now start the CLI in the WSL shell:

```bash
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

In a second WSL shell, run:

```bash
stripe trigger checkout.session.completed
```

Watch the `stripe listen` terminal. If you see `<-- [404]` or `<-- [200]`, you're fine — the CLI is reaching your dev server. If you see `<-- [failed to POST]` or connection errors, the `localhost` boundary is biting you.

If it works, move on. If it doesn't, apply one of the two fixes below.

---

## Step 3: Fix A — Use the Windows Host IP

The Windows host's IP, as seen from inside WSL, is available via `/etc/resolv.conf`. Extract it:

```bash
cat /etc/resolv.conf | grep nameserver | awk '{print $2}'
```

You'll see an address like `172.28.80.1` (the exact value varies by machine and sometimes between reboots). Point the CLI at it:

```bash
stripe listen --forward-to 172.28.80.1:5173/api/webhooks/stripe
```

Replace `172.28.80.1` with whatever your `resolv.conf` line printed. This tells the CLI to deliver events to the **Windows host's** port 5173 — which, if SvelteKit is running on Windows, is where the dev server is actually listening.

### Scripting it

Because the IP can change between reboots, hardcoding it in a script is brittle. A one-liner that resolves it on the fly:

```bash
stripe listen --forward-to "$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}'):5173/api/webhooks/stripe"
```

Save that as an alias or a `package.json` script:

```json
{
	"scripts": {
		"stripe:listen:wsl": "stripe listen --forward-to \"$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}'):5173/api/webhooks/stripe\""
	}
}
```

Then `pnpm stripe:listen:wsl` Just Works every time.

### Caveat: WSL2 networking modes

In newer WSL2 versions (Windows 11 24H2+) with the **mirrored networking mode** enabled (`.wslconfig` → `[wsl2]` → `networkingMode=mirrored`), the Linux and Windows loopbacks are unified and `localhost` works across the boundary in both directions. If you're on mirrored networking, the `/etc/resolv.conf` trick isn't needed — `--forward-to localhost:5173` works directly.

You can check the mode with:

```bash
wsl --status
```

If in doubt, try `--forward-to localhost:5173/...` first; if it fails, fall back to the resolv.conf approach.

---

## Step 4: Fix B — Run the CLI on Windows, Not Inside WSL

The other solution is to move the CLI to the side where your dev server is. If SvelteKit runs on Windows, install and run the Stripe CLI on Windows too.

Open PowerShell (not WSL):

```powershell
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
stripe login
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

Now the CLI and the dev server share the Windows host's loopback, no cross-VM plumbing needed.

### Pros and cons

| Approach                       | Pros                                                                              | Cons                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CLI in WSL + Windows IP        | Everything in one terminal environment; works regardless of where dev server runs | IP changes across reboots; requires the resolv.conf trick                                                            |
| CLI on Windows                 | Truly local loopback; no hypervisor concerns                                      | Requires managing two environments (Windows for CLI, WSL for everything else); two terminal windows for Stripe stuff |
| CLI in WSL + dev server in WSL | Cleanest; both on Linux loopback                                                  | Requires running SvelteKit from WSL (but that's what most WSL users do anyway)                                       |

**Recommendation:** if your dev server runs in WSL (which is the idiomatic WSL workflow), keep the CLI in WSL and use `localhost:5173` — there's no boundary to cross. Fix A or B are only needed when your dev server is on Windows and your CLI is in WSL, which is a less common but real configuration.

---

## Step 5: Verify

Whichever fix you chose, verify the same way:

```bash
stripe trigger checkout.session.completed
```

In the `stripe listen` terminal, look for `<-- [404]` (route not built yet) or `<-- [200]` (route handled it). Either proves the tunnel is reaching your dev server. Connection errors mean the localhost boundary is still biting and you need to revisit Fix A or B.

---

## Common Mistakes

### Mistake 1: Not checking WSL version

WSL1 uses the Windows network stack directly and doesn't have the VM-loopback issue. If you're on WSL1, none of this lesson applies — but WSL1 has other issues (slower filesystem, no systemd, older kernel) and you should upgrade anyway. `wsl --set-version <distro> 2`.

### Mistake 2: Hardcoding the resolv.conf IP

WSL2 can assign a different host IP after certain Windows updates or reboots. If you paste `172.28.80.1` into a script and Windows later moves it to `172.19.16.1`, every webhook attempt will connection-refuse. Resolve it at runtime (the shell snippet above) or use Fix B.

### Mistake 3: Using `127.0.0.1` instead of `localhost`

On some WSL2 setups, `127.0.0.1` inside WSL is **strictly** the Linux VM's loopback — no Windows forwarding. `localhost` sometimes behaves slightly differently because of hostname resolution. Tiny gotcha, occasionally relevant. If one fails, try the other before giving up.

### Mistake 4: Running two `stripe listen` sessions concurrently

Each session gets its own `whsec_...` secret. If you have one in WSL and one on Windows both forwarding to the same port, events might be delivered twice, and your webhook route will see two different secrets in the `Stripe-Signature` headers. Pick one. Kill the other.

---

## Principal Engineer Notes

### Networking boundaries are the number one source of "works on my machine"

Everyone talks about dependency hell and version drift, but in modern dev the #1 cause of "works on my machine" is networking assumptions. localhost/127.0.0.1/::1, container networks, VPN splits, corporate proxy MITM, DNS caches that hold a stale entry for five hours — these are not exotic; they're Tuesday.

WSL2's loopback-across-hypervisor is a microcosm. Once you've debugged one VM-networking issue, you've essentially debugged them all. Read `ip addr`, read `/etc/resolv.conf`, read the process's effective network namespace. Networks are physical, even when they're virtual.

### Hypervisor-layer localhost is a leaky abstraction

Windows' localhost forwarding (inbound) is a genuinely impressive piece of engineering — it makes most day-to-day dev work feel native. But like all abstractions, it leaks. You hit this leak the moment you go from "browser connects to localhost in WSL" (which it papers over) to "process in WSL connects to localhost on Windows" (which it doesn't).

Mirrored networking mode closes most of that gap but at some cost (it changes some other behaviors — multicast, some VPN tools). Microsoft is continually improving this; by the time you read this, the gap may have closed further. Check the WSL docs when in doubt.

### The cost of abstractions is discoverability

A senior engineer's trick: when something "just works" mysteriously, poke at it. Understand what layer is making it work. When that layer fails (eventually, it will), you know where to look. When `stripe listen` fails on WSL, the reflex "localhost is ambiguous in a virtualized boundary" comes from having poked at how localhost forwarding was implemented. Muscle memory, earned.

### The WSL-specific fix is also an example of _documented escape hatches_

Notice the approach here: the CLI doesn't try to auto-detect whether you're in WSL and do the right thing. It respects the user's explicit `--forward-to` argument, and the user has the tools (`/etc/resolv.conf`, Windows IP) to pick the right target.

That's good tool design. The opposite — "the CLI heroically tries to guess what you want" — is usually worse; it succeeds 80% of the time and bizarrely fails 20%. Explicit inputs with good documentation beat implicit magic.

---

## Summary

- WSL2 runs Linux in a hypervisor-managed VM; `localhost` inside WSL is the Linux loopback, not the Windows loopback.
- If your dev server is on Windows but your Stripe CLI is in WSL, you need to target the Windows host IP (`/etc/resolv.conf`) or run the CLI on Windows.
- Either fix works — pick the one that keeps your mental model clean.
- Verify with `stripe trigger checkout.session.completed` and look for a delivery attempt in the `stripe listen` output.

## What's Next

Whichever fix you applied, your CLI now forwards events to `localhost:5173/api/webhooks/stripe`. Back to the main track: Lesson 5.4 dives into **Stripe's Products and Prices data model** — the abstraction that lets Contactly sell a single product at three different prices without writing any extra code.
