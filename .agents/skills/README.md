# Project Skill Catalog

## Ownership

Skill instructions are loaded from four roots:

| Root | Status | Policy |
|---|---|---|
| `.agents/skills/` | Project-owned | Editable and authoritative for this repository. |
| `.local/custom_skills/` | Project-local custom | Editable, but should compose with project-owned guidance. |
| `.local/secondary_skills/` | Secondary catalog | Read-only for this maintenance work; do not rename, delete, or rewrite. |
| `.local/skills/` | Platform-managed | Read-only; document routing issues instead of editing these files. |

If the same skill name appears in more than one root, use the first matching
root in this precedence order:

1. `.agents/skills/`
2. `.local/custom_skills/`
3. `.local/secondary_skills/`
4. `.local/skills/`

This precedence is scoped to repository maintenance. It does not authorize
changes to secondary or platform-managed content.

## Intentional overlaps

- `skill-creator` in `.agents/skills/` is the repository-maintenance and
  evaluation guide. The same name in `.local/secondary_skills/` is a concise
  generic creation guide. Use the editable project-owned copy for this
  repository; consult the secondary copy only for generic context.
- `schema-change-checklist` in `.agents/skills/` is the canonical detailed
  procedure for adding a field or column to an existing table.
  `db-schema-change` is the concise compatibility router for broader schema
  work and must route field/column changes to that checklist.

## Composition boundaries

- `testing` covers ordinary Playwright browser flows.
  `operational-browser-verification` adds manager, scope, navigation, reload,
  import-review, sync-diagnostics, and startup/log evidence requirements.
- `release-checklist` gathers required release evidence.
  `production-go` composes it and returns the final GO/NO-GO decision.
- `state-accuracy-check` owns live timer/counter/auto-track math.
  `sync-invariant-check` owns persistence, merge, stamp, reset, and wake
  convergence. Read both only when a change crosses that boundary.
- `import-bug-investigation` and `spec-import-guard` diagnose import pipeline
  failures. `data-heal-playbook` is added only after incorrect values are
  confirmed to be persisted.
- `external-skill-import` reviews untrusted archives and GitHub skill sources
  before installation. Accepted content goes only to editable roots and must
  pass an explicit review recommendation and approval gate before files are
  copied.

When maintaining skills, preserve these boundaries and existing safety
requirements. Do not rewrite descriptions based on unavailable model
benchmarks, provider failures, or lexical trigger signals.

External manifests are inventory hints, not implementations. Do not create or
install a skill unless the reviewed source contains its actual `SKILL.md`.