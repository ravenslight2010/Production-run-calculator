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

## 3. NEW (2026-09-05 update): pure calc engine extracted + server-side calc

Codex pushed Steps 2–3 of the server-side refactor on branch
`refactor/extract-screen-mode-view` (PR pending). The core production calc is
NOW SHARED — do not re-create inline math:

- **`lib/live-calc/`** — new workspace package. `computeCalc(input)` is the pure
  math engine (ppm, cases, batches, sauce/app/pep quantities, pace, timing).
  `computeEffectiveLineSpeed()` moved here (web `lineSpeed.ts` is now a thin
  re-export). `computeServerCalc(payload, defaultPepTypes)` computes calc from a
  SyncPayload-shaped object.
- **`artifacts/run-calculator/src/contexts/LiveRunContext.tsx`** — the old ~220
  line inline useMemo calc is replaced by the shared `computeCalc()` call.
- **`artifacts/api-server/src/routes/sync.ts`** — SSE `broadcast()` now attaches
  `serverCalc` (current run's calc computed server-side) to every frame.
- **`home.tsx`** — SSE handler stores `serverCalc` in `serverCalcRef`.

Rules: change a formula ONCE in `lib/live-calc`; never re-add inline calc to
either app or the server. `DEFAULT_PEP_TYPES` is injected as a param (same
pattern as inventory-math). If you touch `home.tsx`, keep the `serverCalcRef`
SSE wiring and the `computeCalc` call in LiveRunContext intact.
