---
name: Replit actions needed
description: Explicit handoff for Replit Agent — absorb Codex's 2026-09-05 fixes and fix the red CI workflows on the Replit branch.
---

# For Replit Agent — actions needed (2026-09-05)

Codex merged the `Replit` branch into `main` (PR #17, merge commit `afd37dba`).
To keep the two agents' work compatible, do the following on your next push.

## 1. Absorb these Codex fixes (already on main; do not re-apply differently)

Full entries are in `.agents/memory/codex-fixes.md` (2026-09-05). The key points:

- **Skill catalog (`production-go/SKILL.md`)** — references to `.local/.../SKILL.md`
  files fail GitHub CI because `.local/*` is platform-injected and absent in
  GitHub checkouts. Use directory-form references (`.local/skills/security-scan`)
  as other skills already do.
- **`sourceLibraryReconciliationPlan.generated.ts` is stale** — regenerate with
  `pnpm --filter @workspace/scripts run audit:source-heal-plan` before pushing.
- **`observability.ts` telemetry race** — `recordCacheMaintenance` is
  fire-and-forget on the cache path; `clearCacheMaintenanceDiagnosticsForTests()`
  now awaits tracked in-flight writes before deleting the events table. Keep
  this so the AI-cache integration tests are deterministic.

## 2. Fix these CI workflows that are red on the Replit branch

These checks are NOT required for merging (branch protection only needs the 6
core checks), but they fail on every PR and should be fixed on the Replit side:

- **Release gates and retained standard evidence** (`release-check.yml`) —
  `source-library reconciliation verification` fails on a fresh Postgres because
  it expects production data history (pools/aliases/stubs from the 2026-08-26
  audit). Decide how CI should handle a missing production snapshot, and check
  the `release-stopped-summary.sh` artifact-link verification (the artifact URL
  does not resolve in the current config).
- **Schema-safe application rollback rehearsal** (`ci.yml`) —
  `check:schema-safe-rollback` fails with "public schema changed during runtime
  replacement" — the recorded/expected schema snapshot is out of date with the
  current schema.
- **Desktop and phone department journey** (`department-navigation.yml`) —
  the browser journey gets an API 503 during the run.

## 3. Merge path

- Keep pushing to the `Replit` branch (do not push directly to `main`).
- Never force-push `main`; branch protection is enabled.
- If your branch and `main` diverge again, Codex will re-merge with conflict
  resolution favoring the Replit branch, then restore any deploy-critical
  changes — but see the fixes above first so CI can go green on the first try.
