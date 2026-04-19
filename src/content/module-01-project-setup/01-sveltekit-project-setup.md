---
title: '1.1 - SvelteKit Project Setup'
module: 1
lesson: 1
moduleSlug: 'module-01-project-setup'
lessonSlug: '01-sveltekit-project-setup'
description: 'Scaffold a new SvelteKit project with TypeScript strict mode, ESLint, Prettier, and Playwright using the sv CLI and pnpm.'
duration: 12
preview: true
---

## Overview

In this lesson you will create the project folder for **Contactly** — the contact management SaaS application you'll build over the next thirteen modules. You'll use the official Svelte scaffolding tool to generate a production-grade project skeleton, and you'll walk through every file it creates so that nothing in your project feels like magic.

If you have never coded before, that's fine. The goal of this lesson is not to write any code of your own. It is to set up a clean, professional starting point and understand exactly what each piece is for.

## Prerequisites

Before starting, you need three things installed on your computer. If you're on macOS or Linux the commands below assume a Unix-style terminal; on Windows, use PowerShell or WSL.

- **Node.js 20 or higher.** Node.js is the JavaScript runtime that lets us execute JavaScript code outside a browser — on a server, or in build tools. SvelteKit runs on Node. Check your version:

  ```bash
  node -v
  ```

  If you see `v20.x.x` or higher, you're good. If you don't have Node at all, install it from [nodejs.org](https://nodejs.org) or (better) through a version manager like [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm).

- **pnpm** — pronounced "performant npm". This is our package manager, the tool that downloads and installs the open-source libraries our project depends on. pnpm is a faster, more disk-efficient alternative to `npm` (the default Node package manager) and `yarn`. Install it globally:

  ```bash
  npm install -g pnpm
  ```

  Verify:

  ```bash
  pnpm -v
  ```

- **Visual Studio Code (VSCode).** Any code editor works, but the course assumes VSCode because of its first-class Svelte support. Install the **Svelte for VS Code** extension (search the extension marketplace for "svelte" and install the one by the Svelte team). This gives you syntax highlighting, error underlining, and autocomplete for `.svelte` files.

## What You'll Build

By the end of this lesson, you'll have a folder called `contactly/` on your computer containing a complete SvelteKit project. Running `pnpm dev` inside it will start a local web server on `http://localhost:5173` with a working SvelteKit welcome page. That skeleton is the foundation every later lesson builds on.

---

## What Is SvelteKit, and Why Are We Using It?

A SaaS app has two logical halves: a **frontend** (the part the user sees and clicks) and a **backend** (the server that holds the data and enforces the rules). Traditional web apps split these into two separate codebases. SvelteKit is a **full-stack framework** — meaning frontend and backend live in one codebase, one deployment, one mental model.

Three things make SvelteKit a good fit for Contactly:

1. **Svelte components are fast and small.** Svelte compiles your code at build time rather than shipping a large runtime library to the browser. For a paying customer, this means pages load quickly even on slow networks.
2. **Server-side rendering (SSR) is built in.** The first page the user sees is generated on the server and delivered as HTML. Google can index it. Screen readers can read it. The page is interactive the moment it arrives.
3. **Everything is a file.** Pages, API routes, form handlers, middleware — all of them are files inside a specific folder with a specific name convention. There's no hidden config, no 400-page router manual.

If you've heard of Next.js (React) or Nuxt (Vue), SvelteKit occupies the same category. The decision to use SvelteKit for this course is partly taste, partly pragmatism: Svelte's learning curve is shorter than React's, which matters when we're also teaching Supabase, Stripe, and production deployment.

## Why `pnpm dlx sv create`? (And Why Not `npm create svelte@latest`?)

You may find tutorials on the internet telling you to run `npm create svelte@latest`. That command is **deprecated** — meaning it still works for now, but the Svelte team has officially replaced it with something better: the `sv` CLI.

The `sv` CLI is the new official scaffolding tool. It's more modular (it supports community add-ons like Tailwind, Drizzle, Supabase directly in the wizard), and it's the only path that will keep receiving updates.

We run it with `pnpm dlx` instead of `npx` (the npm equivalent) for three practical reasons:

1. **`dlx` stands for "download and execute".** It fetches the `sv` package into a temporary location, runs it once, and throws it away. Nothing pollutes your global install directory.
2. **pnpm is faster.** It uses a global content-addressable store so each package is downloaded to your disk exactly once across all your projects.
3. **Consistency.** The rest of this course — dependency installs, scripts, deployments — all uses pnpm. Mixing npm and pnpm in the same project can produce conflicting lockfiles and subtle bugs.

A lockfile (`pnpm-lock.yaml`) is a machine-readable record of every exact package version your project uses. It's what makes "it works on my machine but not yours" preventable: when your teammate runs `pnpm install`, pnpm uses the lockfile to install the exact same versions you have. Commit this file to git — always.

---

## Scaffolding the Contactly Project

Open your terminal. Navigate to the folder where you keep your projects — something like `~/code/` or `~/Desktop/`. Do **not** run the scaffolder inside an existing project; we want a fresh folder.

```bash
pnpm dlx sv create contactly
```

`contactly` is the folder name. You can use whatever name you like, but the rest of this course assumes `contactly`.

The wizard will ask several questions. Answer them **exactly** as shown:

```
Which template would you like? › minimal
Add type checking with TypeScript? › Yes, using TypeScript syntax
What would you like to add to your project? › prettier, eslint, playwright
Which package manager do you want to install dependencies with? › pnpm
```

Use the arrow keys to move, the spacebar to toggle a multi-select option, and Enter to confirm. Each choice matters:

| Choice              | Why we pick this                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal` template  | Comes with just a home page — no demo todo app to delete, no opinions we don't want.                                                                                      |
| `TypeScript syntax` | TypeScript catches whole categories of bugs (typos, wrong data shapes, missing function arguments) **before** your code runs. It is non-negotiable for a production SaaS. |
| `prettier`          | An opinionated auto-formatter. It ends every argument about tabs-vs-spaces and line length by running on save.                                                            |
| `eslint`            | Static analysis — catches patterns that are legal but likely buggy (unused variables, forgotten `await`, etc.).                                                           |
| `playwright`        | End-to-end testing. Drives a real browser to verify the full app works. You'll write Playwright tests in Module 11.                                                       |
| `pnpm`              | The wizard runs `pnpm install` at the end to download all the dependencies.                                                                                               |

**What you should see if it worked:** after a minute or two, the wizard prints a summary, finishes installing dependencies, and exits with next-step instructions. If you see red error text, the most likely cause is a stale Node version — run `node -v` and upgrade if you're below 20.

Move into the new folder and open it in VSCode:

```bash
cd contactly
code .
```

The `code .` command (note the space and period) opens the current directory in VSCode. If `code` isn't recognized, open VSCode manually, press `Cmd+Shift+P` (or `Ctrl+Shift+P`), type "shell command", and select "Install 'code' command in PATH".

---

## Walking the Project Structure

Open the Contactly folder in VSCode. You'll see this structure in the sidebar:

```
contactly/
├── src/
│   ├── app.d.ts          ← global TypeScript type declarations
│   ├── app.html          ← the HTML shell that wraps every page
│   └── routes/
│       └── +page.svelte  ← the home page (URL: /)
├── static/               ← static assets served as-is (images, fonts, favicon)
├── .env.example          ← template listing required environment variables
├── .gitignore            ← tells git which files NOT to commit
├── .prettierrc           ← Prettier's formatting rules
├── eslint.config.js      ← ESLint's rule set
├── package.json          ← project metadata + dependency list + scripts
├── playwright.config.ts  ← Playwright test configuration
├── pnpm-lock.yaml        ← EXACT version of every installed package
├── README.md             ← project description (edit for your own use)
├── svelte.config.js      ← SvelteKit configuration (adapter, aliases)
├── tsconfig.json         ← TypeScript compiler configuration
└── vite.config.ts        ← Vite bundler configuration
```

Two things to internalize early:

**The `+` prefix is a signal.** In SvelteKit, a filename starting with `+` is a **route file** — the framework reads it and uses it to build the website's URL structure. `+page.svelte` means "this is a page". `+layout.svelte` means "this wraps pages". `+page.server.ts` means "this runs on the server before the page renders". Regular files without the `+` prefix (like `utils.ts` or `Button.svelte`) are just files you import — not routes.

**The `src/` folder is your code.** Everything you write lives in `src/`. The configuration files at the root are usually written once and left alone.

### What each root file does

- **`package.json`** — The manifest for your project. Lists every dependency (and its allowed version range), plus the scripts you can run with `pnpm run <script-name>`. Open it now. Notice the `scripts` block — that's where `dev`, `build`, and `check` are defined.
- **`pnpm-lock.yaml`** — The lockfile. Machine-generated. Never edit by hand. Always commit.
- **`svelte.config.js`** — SvelteKit's own config: which adapter to use (Vercel, Netlify, Node, etc.), any preprocessors, path aliases like `$components`.
- **`vite.config.ts`** — Vite is the underlying build tool SvelteKit uses. This file tells Vite which plugins to load (SvelteKit is itself a Vite plugin).
- **`tsconfig.json`** — TypeScript's compiler settings. Extends a base config from SvelteKit and can be customized with stricter rules.
- **`.gitignore`** — A list of file patterns git should ignore. By default it excludes `node_modules` (too big, reproducible from `package.json`), `.svelte-kit/` (build output), and `.env` (secrets).
- **`.env.example`** — A template file showing which environment variables the app needs. Safe to commit because it contains no real values — only placeholder names.

---

## Verifying TypeScript Strict Mode

Open `tsconfig.json`. You should see something like:

```json
{
	"extends": "./.svelte-kit/tsconfig.json",
	"compilerOptions": {
		"allowJs": true,
		"checkJs": true,
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"skipLibCheck": true,
		"sourceMap": true,
		"strict": true,
		"moduleResolution": "bundler"
	}
}
```

**Find `"strict": true`.** If it's missing, add it. Strict mode is a single flag that enables a bundle of smaller checks, including:

- `strictNullChecks` — if a value might be `null` or `undefined`, TypeScript forces you to handle that case explicitly before you use it.
- `noImplicitAny` — if you don't give a variable a type, TypeScript complains instead of silently allowing "anything goes".
- `strictFunctionTypes` — function argument types must actually match when passed around.

**Why a Principal Engineer cares:** strict mode is one of the cheapest, highest-leverage decisions in a TypeScript project. Adding it later — to a 50-file codebase full of implicit-any — is a week of work. Adding it on day one is free. We're making that choice now so you never have to pay that cost.

While you're here, also consider adding one more option:

```json
"noUncheckedIndexedAccess": true
```

This makes TypeScript treat `array[0]` as possibly `undefined` (which it is — the array could be empty). It's strict but in a way that catches real bugs before production.

---

## Environment Variables, Explained

An **environment variable** is a named value that lives outside your code. Things like API keys, database connection strings, and deploy URLs belong in environment variables — not hardcoded into files — for two reasons:

1. **Different environments need different values.** Your local development database has a different URL than your production database. Same code; different config.
2. **Secrets must not be committed to git.** If you paste a real Stripe secret key into a file and push it to GitHub, attackers will find it within minutes. GitHub's secret-scanning bots will too, and your key will be rotated for you — loudly.

Create two files in the project root:

**`.env.example`** — Commit this to git. It's a template showing _which_ variables the app needs, with fake values. Teammates clone the repo, copy this file to `.env`, and fill in real values.

```bash
# Supabase (fill in from `pnpm supabase start` output in the next lesson)
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=

# App
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_APP_NAME=Contactly
```

**`.env`** — Never commit this. Ever. It contains real credentials.

```bash
# Supabase
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=will-be-filled-in-next-lesson

# App
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_APP_NAME=Contactly
```

### The `PUBLIC_` prefix rule

SvelteKit enforces a naming convention for environment variables:

- Variables starting with `PUBLIC_` are **safe to expose to the browser**. Use them for things like your Supabase URL (publicly visible in every request anyway) or your app name.
- Variables **without** the `PUBLIC_` prefix are **server-only**. They must never reach the browser. Use them for secrets like `STRIPE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.

SvelteKit enforces this at build time: if you try to import a non-public variable into browser code, the build will fail loudly. This is a feature, not an annoyance. It prevents an entire class of security disasters where a developer accidentally ships a private key to the client.

We'll go deeper on this in lesson 2.1. For now, the rule is: `PUBLIC_` is safe; no prefix is secret.

### Verifying `.env` is ignored by git

Open `.gitignore`. It should already contain:

```
node_modules
.DS_Store
/build
/.svelte-kit
/package
.env
.env.*
!.env.example
```

The last three lines are the important ones:

- `.env` — ignores the file you just created.
- `.env.*` — ignores `.env.local`, `.env.production`, etc.
- `!.env.example` — the exclamation mark _unignores_ the example file so it can be committed.

If any of these are missing, add them. Test it by running:

```bash
git status
```

`.env` should **not** appear in the list. `.env.example` should appear (as untracked). If `.env` appears, your `.gitignore` is wrong — fix it before going further.

---

## Starting the Dev Server

From the project root:

```bash
pnpm dev
```

**What you should see:**

```
  VITE v5.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Open `http://localhost:5173` in your browser. You should see the SvelteKit welcome page.

### What just happened under the hood?

1. **Vite started a local web server** on port 5173. Vite is a build tool that serves your source files with lightning-fast hot module replacement.
2. **SvelteKit read your `src/routes` folder** and built a URL map. `src/routes/+page.svelte` → the URL `/`.
3. **When you opened the browser**, it requested `/`. The dev server responded with HTML generated from `+page.svelte`.
4. **Hot module replacement (HMR)** is now active. If you edit `src/routes/+page.svelte` and save, the browser updates instantly — without a full reload, without losing component state.

Leave the dev server running in one terminal tab. Open a second terminal tab for everything else.

### If it doesn't work

- **"Port 5173 already in use"** — Another process is using that port. Stop the other process, or start SvelteKit on a different port: `pnpm dev --port 5174`.
- **Blank page or "Cannot find module"** — Run `pnpm install` again. Something may not have downloaded cleanly the first time.
- **Browser shows raw code** — You're looking at the wrong URL. The dev server is on `localhost:5173`, not `localhost:3000` or `127.0.0.1`.

---

## The Daily Commands You'll Use

Open `package.json` and find the `scripts` block. These are the commands you'll run dozens of times a day. Learn them:

```bash
pnpm dev          # Start the dev server at localhost:5173 with hot reload.
pnpm build        # Compile the production bundle into .svelte-kit/output/.
pnpm preview      # Serve the production build locally to preview what'll ship.
pnpm check        # Run svelte-check — TypeScript + Svelte type checking.
pnpm lint         # Run ESLint to find suspicious patterns.
pnpm format       # Run Prettier to auto-format every file.
pnpm test:e2e     # Run Playwright end-to-end tests.
```

### Why `pnpm check` matters

`pnpm dev` runs your app but only reports errors at runtime — when something breaks in the browser. `pnpm check` runs the TypeScript compiler across your whole project **without** running anything, catching type errors you might not hit in casual browsing. Make it a habit to run `pnpm check` before every commit.

### Why `pnpm build` matters

`pnpm build` produces the _production_ bundle — the optimized, minified, tree-shaken version of your app that will eventually run on the real internet. It will catch problems `pnpm dev` overlooks: missing environment variables, unused exports, illegal imports from server code into client code.

You do not need to run it yet — but know that "it works in dev" is not "it works in production". Part of this course's Principal Engineer discipline is: run `pnpm build` regularly, and fix any warnings it shouts about, before they calcify into real bugs.

---

## Principal Engineer Notes — What We Chose and Why

1. **One repo, one deploy, one codebase.** Contactly is a monolith — a single SvelteKit project that serves the marketing site, the app, and the API. This is the right default until you have at least five engineers. Microservices and separate-frontend-backend splits add operational cost that a small team cannot afford.

2. **TypeScript strict from day one.** The alternative — "we'll add types later" — means never. The opportunity cost of strict mode at project start is zero. The cost of retrofitting it onto a large JS codebase is measured in engineer-weeks.

3. **Lockfiles are source code.** `pnpm-lock.yaml` is committed because non-determinism in builds is a common source of Sev-2 production incidents. Same lockfile → same install → same behaviour. Always.

4. **`.env` policy is a security boundary.** The rule "never commit secrets" sounds obvious but is violated constantly. The `.env` / `.env.example` / `.gitignore` triangle is the discipline that keeps you honest. Automated secret-scanning (which you'll set up in Module 12's CI pipeline) is your safety net for when the discipline slips.

5. **Prettier and ESLint mean we don't debate style.** A Principal Engineer's time is more valuable than rehashing tab-width debates in PR reviews. Configure the tools, set them to run in CI, and move on.

---

## Summary

- Installed Node 20+, pnpm, and VSCode as the foundation toolchain.
- Scaffolded Contactly with `pnpm dlx sv create contactly` using the official `sv` CLI (replacing the deprecated `npm create svelte@latest`).
- Selected the **minimal** template plus TypeScript, Prettier, ESLint, and Playwright — a production-grade default stack.
- Walked every file the scaffolder produced so nothing in your project is a black box.
- Verified TypeScript **strict mode** is enabled in `tsconfig.json`.
- Created `.env` and `.env.example` and confirmed `.gitignore` prevents `.env` from being committed.
- Internalized SvelteKit's **`PUBLIC_` prefix** rule for environment variables.
- Started the dev server with `pnpm dev` and reached the welcome page at `localhost:5173`.
- Learned the daily command set: `dev`, `build`, `preview`, `check`, `lint`, `format`.

## Next Lesson

In lesson 1.2 you'll install Docker Desktop and spin up a complete local Supabase stack — database, auth, storage, and visual admin UI — with a single command, so you can build Contactly without ever touching a cloud project during development.
