# Content Contract

This directory is the single source of truth for lesson content on SaaS-Pro.
It is not a user-facing README. It documents the rules the content reader
(`src/lib/server/content.service.ts`) enforces when parsing lesson files.

If you are authoring a new lesson, read this entire file first. Deviating from
the schema will break the build.

## Directory layout

Every lesson lives at:

```
src/content/module-XX-slug/NN-lesson-slug.md
```

- `module-XX-slug/` — one directory per module. `XX` is a zero-padded module
  number (`00`..`14`). `slug` is a kebab-case description of the module.
- `NN-lesson-slug.md` — one markdown file per lesson. `NN` is a zero-padded
  lesson index within the module (starting at `00`). `lesson-slug` is
  kebab-case.

Empty modules hold a `.gitkeep` so the directory is tracked before any
lessons land.

## Frontmatter schema

Every lesson file MUST begin with a YAML frontmatter block matching this
schema exactly. No extra keys, no missing keys, no blank lines inside the
fences.

```
---
title: "1.1 - SvelteKit Project Setup"
module: 1
lesson: 1
moduleSlug: "module-01-project-setup"
lessonSlug: "01-sveltekit-project-setup"
description: "One-sentence lesson description."
duration: 12
preview: false
---
```

A single blank line MUST follow the closing `---`, then the markdown body.

### Fields

| Key           | Type    | Description                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------- |
| `title`       | string  | Human-readable lesson title. Quoted with double quotes.                         |
| `module`      | number  | Integer module index (`0`..`14`). Unquoted.                                     |
| `lesson`      | number  | Integer lesson index within the module (starts at `0`). Unquoted.               |
| `moduleSlug`  | string  | Kebab-case module directory name. MUST match the parent directory name.        |
| `lessonSlug`  | string  | Kebab-case lesson slug. MUST match the filename without the `.md` extension.   |
| `description` | string  | One-sentence summary shown in the course sidebar and in SEO metadata.           |
| `duration`    | number  | Estimated minutes to complete. Integer. Unquoted.                               |
| `preview`     | boolean | `true` means free/public, `false` means gated behind an active subscription.    |

### Formatting rules

- String values: always wrapped in double quotes.
- Numbers: unquoted.
- Booleans: lowercase `true` / `false`.
- No comments, no anchors, no additional YAML features.
- No blank lines inside the `---` fences.

## How the reader consumes these files

`content.service.ts` is the only module allowed to touch this directory at
runtime. Its contract:

1. Scans `src/content/*/` at build time to enumerate modules.
2. For each module directory, reads every `*.md` file in sorted order.
3. Parses the frontmatter with a strict schema validator. Unknown keys,
   missing keys, or type mismatches throw a build error.
4. Verifies `moduleSlug` matches the parent directory name exactly.
5. Verifies `lessonSlug` matches the filename (minus `.md`) exactly.
6. Sorts lessons by `lesson` ascending within each module, and modules by
   `module` ascending overall.
7. Renders the markdown body with `mdsvex` and exposes the result to route
   loaders.

Any mismatch between the frontmatter and the path is a fatal error. This is
intentional — it prevents silent drift between the content tree and the
rendered course structure.

## The `preview` flag

`preview` gates access:

- `preview: true` — lesson is free. Any visitor can read it. Use sparingly,
  typically for the introduction module and the first lesson of early
  modules.
- `preview: false` — lesson is gated. The route loader checks for an active
  subscription (any tier) before serving the body. Unsubscribed users see
  the paywall component instead.

The flag is read at request time, not baked into the static output, so
toggling it does not require a redeploy once the subscription check lives
server-side.

## Slug ↔ path invariant

This is the single rule most often broken by new authors:

- `moduleSlug` in the frontmatter MUST equal the parent directory name.
- `lessonSlug` in the frontmatter MUST equal the filename without `.md`.

Example — file at `src/content/module-03-user-auth/02-sign-in-flow.md`:

```
---
title: "3.2 - Sign-in Flow"
module: 3
lesson: 2
moduleSlug: "module-03-user-auth"
lessonSlug: "02-sign-in-flow"
description: "Wiring up Supabase sign-in with server actions."
duration: 14
preview: false
---
```

If you rename a file, update its frontmatter. If you move a file to a new
module directory, update both `module` and `moduleSlug`. The build will
refuse to start otherwise.
