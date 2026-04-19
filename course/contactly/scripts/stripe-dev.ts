#!/usr/bin/env tsx
/**
 * `pnpm run stripe:dev` — single-command dev runner.
 *
 * Spawns SvelteKit's dev server and the Stripe CLI listener as
 * sibling child processes, merges their output with `[app] ` /
 * `[stripe] ` prefixes, intercepts the listener's startup banner to
 * surface the per-session `whsec_...` signing secret prominently,
 * and forwards SIGINT so Ctrl-C tears both down cleanly.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two-pane dev (one terminal for `pnpm dev`, one for `pnpm
 * stripe:listen`) is fine, but on a fresh machine the listener's
 * `whsec_...` secret rotates every session. The pattern we want a
 * student to fall into is:
 *
 *   1. Run `pnpm run stripe:dev`
 *   2. Copy the `STRIPE_WEBHOOK_SECRET=...` line it prints into `.env`
 *   3. Restart only when that line changes (it won't until you reboot
 *      or run `stripe login` again — the listener-binding secret is
 *      stable for the duration of a CLI session).
 *
 * Putting the secret in front of the developer's eyes the moment the
 * stack boots eliminates the most common dev-mode 400.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *  - Mutate `.env`. The CLI prints, the developer pastes. We do not
 *    silently rewrite secrets — files in `.env` are sacred.
 *  - Replace `pnpm run stripe:listen` for production-shape testing.
 *    If you want to test against a public URL (smee/ngrok), run the
 *    listener manually with `--forward-to https://...`.
 *  - Rebuild on dependency change. `pnpm run dev` already handles HMR.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const APP_PORT = Number(process.env.PORT ?? 5173);
const FORWARD_URL = `http://localhost:${APP_PORT}/api/webhooks/stripe`;

function paint(prefix: string, color: '36' | '35' | '33' | '90') {
	return (line: string) => `\x1b[${color}m[${prefix}]\x1b[0m ${line}`;
}

function pipe(child: ChildProcess, format: (line: string) => string) {
	const handler = (chunk: Buffer | string) => {
		const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
		for (const line of text.split('\n')) {
			if (line.length > 0) process.stdout.write(format(line) + '\n');
		}
	};
	child.stdout?.on('data', handler);
	child.stderr?.on('data', handler);
}

function ensureStripeCliPresent() {
	try {
		execFileSync('stripe', ['--version'], { stdio: 'ignore' });
	} catch {
		console.error(
			paint(
				'stripe',
				'33'
			)(
				'`stripe` CLI not found on PATH. Install via `brew install stripe/stripe-cli/stripe` (macOS) ' +
					'or follow https://docs.stripe.com/stripe-cli (other platforms), then `stripe login`.'
			)
		);
		process.exit(1);
	}
}

function highlightSecret(line: string): string | null {
	// The Stripe CLI banner looks like:
	//   "Ready! You are using Stripe API Version [2026-03-25.dahlia].
	//    Your webhook signing secret is whsec_xxx (^C to quit)"
	const match = line.match(/whsec_[A-Za-z0-9]{20,}/);
	return match ? match[0] : null;
}

function main() {
	ensureStripeCliPresent();

	console.info(
		paint(
			'dev',
			'90'
		)(
			`Spawning SvelteKit (PORT=${APP_PORT}) and \`stripe listen\` (forward-to=${FORWARD_URL}). ` +
				'Ctrl-C to shut both down.'
		)
	);

	const app = spawn('pnpm', ['run', 'dev'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env
	});
	const listener = spawn('stripe', ['listen', '--forward-to', FORWARD_URL], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env
	});

	pipe(app, paint('app', '36'));

	let secretAnnounced = false;
	const stripeFormat = paint('stripe', '35');
	const announceFormat = paint('stripe-secret', '33');
	listener.stdout?.on('data', (chunk: Buffer) => {
		const text = chunk.toString('utf-8');
		for (const line of text.split('\n')) {
			if (line.length === 0) continue;
			process.stdout.write(stripeFormat(line) + '\n');
			const secret = highlightSecret(line);
			if (secret && !secretAnnounced) {
				secretAnnounced = true;
				process.stdout.write(
					announceFormat(
						`Copy this into course/contactly/.env then restart \`pnpm run dev\`:\n` +
							`               STRIPE_WEBHOOK_SECRET="${secret}"`
					) + '\n'
				);
			}
		}
	});
	listener.stderr?.on('data', (chunk: Buffer) => {
		const text = chunk.toString('utf-8');
		for (const line of text.split('\n')) {
			if (line.length > 0) process.stdout.write(stripeFormat(line) + '\n');
		}
	});

	const shutdown = (signal: NodeJS.Signals) => {
		console.info(paint('dev', '90')(`Caught ${signal}, shutting down…`));
		app.kill('SIGINT');
		listener.kill('SIGINT');
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	let exited = 0;
	const checkExit = (name: string, code: number | null) => {
		exited += 1;
		console.info(paint('dev', '90')(`${name} exited (code=${code ?? 'null'})`));
		if (exited === 1) {
			// One sibling died — kill the other so the dev pair is
			// always all-or-nothing. Otherwise a crashed listener can
			// silently turn into "webhooks aren't being delivered" and
			// the dev wonders why their checkout doesn't update state.
			if (!app.killed) app.kill('SIGINT');
			if (!listener.killed) listener.kill('SIGINT');
		}
		if (exited === 2) {
			process.exit(code ?? 1);
		}
	};
	app.on('exit', (code) => checkExit('app', code));
	listener.on('exit', (code) => checkExit('listener', code));
}

main();
