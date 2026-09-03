# AGENTS.md — Shared instructions for all coding agents

This repository is worked on by **multiple coding agents** (Codex, Replit Agent, and others). To avoid duplicate work and conflicting fixes, follow these rules.

## Before making any change

1. **Check `.agents/memory/codex-fixes.md`** — this file logs every fix Codex has made. If a fix is already documented there, do NOT re-apply it.
2. **Check `.agents/memory/`** — other memory files contain design decisions, patterns, and gotchas. Read them before modifying code.
3. **Never force-push to `main`** — always use a feature branch + PR. Branch protection is enabled.

## After making a fix

1. **Update `.agents/memory/codex-fixes.md`** (or create your own equivalent) with:
   - File path(s) changed
   - What was wrong (the bug/issue)
   - What the fix was (the change)
   - Why it was needed (context)
2. **Push to a feature branch** and open a PR.
3. **CI must pass** before merging.

## Shared knowledge files

- `.agents/memory/codex-fixes.md` — running log of Codex fixes
- `.agents/memory/*.md` — design decisions, patterns, gotchas (200+ files)
- `AGENTS.md` — this file (shared instructions)

## Key facts

- **Render deploy**: serves both API and web UI from a single service. Static file serving is in `app.ts` (guarded to `NODE_ENV=production`).
- **Schema at boot**: `applyDatabaseSchema()` in `index.ts` runs `drizzle push-force` at startup.
- **Branch protection**: `main` is protected — no force pushes, PRs required, CI must pass.
- **Replit pushes to branches**, not directly to `main`.
