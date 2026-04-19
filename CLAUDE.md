# CLAUDE.md

> Claude Code reads this file. The actual rules live in
> [`AGENTS.md`](./AGENTS.md) — that is the canonical, tool-agnostic
> source of truth for every AI agent working in this repo.
>
> _Last revised: 2026-04-19_

**Read [`AGENTS.md`](./AGENTS.md) before doing anything.**

---

## Why two files?

Different AI tools default to different filenames (`CLAUDE.md` for
Claude Code, `AGENTS.md` for the cross-tool convention used by Cursor,
Junie, Windsurf, OpenAI Codex, and others). Maintaining one canonical
file (`AGENTS.md`) and one pointer (this file) avoids the
two-sources-of-truth problem.

If you're updating agent rules, edit [`AGENTS.md`](./AGENTS.md) — never
this file.

---

## Tool fan-out

Tool-specific skill folders are all symlinks pointing at one source:

```
.agents/skills/      ← canonical Stripe agent skills (real files)
.claude/skills/      ← symlinks → ../../.agents/skills/*
.junie/skills/       ← symlinks → ../../.agents/skills/*
.windsurf/skills/    ← symlinks → ../../.agents/skills/*
```

Add or update a skill in `.agents/skills/` only. The other tools pick it
up automatically.
