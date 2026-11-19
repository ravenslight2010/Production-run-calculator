---
name: multi-version-work
description: Use when the coding assistant is working across v1, v2, and possible future versions of the production assistant. Guides context switching, shared skills, and safe multi-repo changes.
---

# Multi-Version Work Skill

## Purpose
Make the local coding assistant effective when it is asked to work on v1, v2, a future v3, or all of them in the same session.

## When to use
- Any request that mentions v1, v2, v3, or “both versions”
- Switching between Production-run-calculator and Lucias-production-assistant-v2
- Creating skills or patterns that should apply to all versions

## Core rules
1. Prefer global skills (`~/.config/opencode/skills/`) so they are available in every repo.
2. Keep version-specific conventions in each repo’s AGENTS.md or local `.opencode/skills/`.
3. Always state which version(s) you are operating on before making changes.
4. Do not assume file paths or models are the same across versions.

## Workflow
1. Confirm the current working directory and which version it belongs to.
2. If the request spans versions, plan the work in version-specific slices.
3. Use the version-diff skill when behavior differs.
4. After changes, note which version was modified and whether the other version needs a corresponding update.

## Output
- Clear version scope statement
- Per-version change list
- Recommendation on whether a shared skill or project-local note is better
