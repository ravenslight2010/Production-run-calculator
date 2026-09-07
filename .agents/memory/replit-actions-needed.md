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

## 4. NEW (2026-09-07 update): Replit merge completed

Codex merged `origin/Replit` (163 commits, 766 files) into `main` via PR #39
(`merge/replit-sync-2026-09-07` branch). Conflict resolution favored Replit's
versions throughout because Replit's branch absorbed our feature branch
pre-squash and evolved further.

**Key changes absorbed from Replit:**
- Import review hardening on short phone layouts
- Paused run weight/recipe snapshot preservation
- Protected GET routes with explicit authorization registration
- Master-data refresh push to open stations
- Full-screen overlay navigation interception guards
- Operational dialog viewport layout fixes
- Case-based Frontline quantity guards
- PWA handoff recovery
- Browser QA regressions (batch weights, recipe units, source-library)

**Merge fixes applied:**
- Removed stale `lib/live-calc` test files (superseded by Replit's `liveCalc.test.ts`)
- Fixed `liveCalc.test.ts` type assertion (`CalcRunMeta` cast for test fixture)
- Restored `autoTrackCoordinationClient.ts` to Replit's clean version (duplicate export from auto-merge)
- Removed orphaned `wallClockSkip.test.tsx` and `sauceBarrel` test append blocks
- Regenerated OpenAPI client code (`OperationalRunView` type sync)

**Open CI failures on Replit branch (pre-existing, NOT caused by this merge):**
- Release gates: source-library reconciliation fails on fresh Postgres
- Schema-safe rollback rehearsal: schema snapshot out of date
- Desktop/phone department journey: API 503 during browser run

**For Replit:** Your `origin/Replit` branch was the conflict-winner. After this
merge lands, you can fast-forward to main and start pushing on a clean base.
All your 163 commits are preserved. Your `useAutoTrack.ts`, `home.tsx`, and
`sync.ts` are now the authoritative versions on main.

## 5. CODE: forward plan — the "hard work" for Replit Agent (2026-09-07)

Codex owns the architectural refactor; you own feature + QA velocity. These are
the next items, listed in priority order. All are green-lit; do them once, well,
on a clean base AFTER PR #39 (merge/replit-sync-2026-09-07 → main) lands.

### 5.1 Fix the 3 red CI workflows (highest priority — blocks every deploy)

These pre-date PR #39 and are NOT caused by the merge. They fail on the Replit
branch today and will fail on main until resolved:
1. **Release gates / retained standard evidence** (`release-check.yml`) —
   `source-library reconciliation verification` fails on a fresh Postgres
   because it expects production data history (pools/aliases/stubs from the
   2026-08-26 audit). Decide how CI should handle a missing production snapshot
   (skip-with-cause vs. synthetic fixture).
2. **Schema-safe application rollback rehearsal** (`ci.yml`) —
   `check:schema-safe-rollback` fails "public schema changed during runtime
   replacement" — the recorded/expected schema snapshot is stale vs. current
   schema. Regenerate the snapshot.
3. **Desktop + phone department journey** (`department-navigation.yml`) — the
   browser journey gets an API 503 during the run. Investigate the 503 (likely
   cold-start / schema-boot race on a disposable e2e DB; see `replit.md`
   `prepare:e2e:department`).

### 5.2 Server-side wall-clock auto-track claim EXECUTION (completes Step 7)

Step 7a/7b shipped the FOUNDATION (pure `wallClockEngine.ts`, server
`autoTrackServerTicks.ts` bootstrap, client skip-latch). What remains is the
actual server-side EXECUTION of wall-clock claims for live runs:
- In `artifacts/api-server/src/lib/autoTrackServerTicks.ts`, wire
  `tickWallClock` (from `lib/live-calc/src/wallClockEngine.ts`) into a run loop
  analogous to how net-second claims already run, for fresh live runs < 6h.
- Route the resulting `WallClockMutation`s through the SAME
  parse/apply/row-lock transaction path the net-second claims use (do NOT add a
  parallel write path).
- Persist history ONLY if replay divergence for mid-run-mount devices becomes a
  real issue; the claim protocol re-aligns canonical nextDueAt after the first
  claim, so prefer not re-persisting until proven necessary.
- Run `sync-invariant-check` + `state-accuracy-check` skills before/after.

### 5.3 Client skip of redundant wall-clock ticks (mirror Task 1 latch)

The net-second skip-latch lives in `artifacts/run-calculator/src/hooks/useAutoTrack.ts`
(lines ~442/450/523/596 — `serverScheduleAtRef`, 30s freshness). Mirror the same
latch for the WALL-CLOCK channels (case, tray-consume, tray-produce,
batch-consume, batch-produce, hopper): when the server wall-clock verdict is
fresh and says "not due", the client must not fire its own wall-clock claim;
when the verdict goes stale/offline, restore the local fallback exactly as the
net-second version does. Keep the canonical-echo path unchanged (canonical echo
still resumes local execution).

### 5.4 AI/assistant subsystem — close the coverage gap

Neither side touched this critically since the route reorg. After 5.1-5.3:
- Add integration tests for the consolidated AI routes (route reorg deleted
  several `ai*` route tests with no replacements — `ai.ts` is the big
  consolidated router). Priorities: `aiParseSpecSheet`, `aiMatchImport`,
  `aiMemory`, `aiMixReconcile`, `aiSummary`.
- Wire `aiCostLimit` charges into the new consolidated router if not already
  done (it was gated per-route before the reorg).
- Keep changes formula-once in `lib/*`; never re-add inline AI/calc to the app.

### Working agreement (unchanged)
- Formula/math changes happen ONCE in `lib/live-calc` (or the relevant `lib/*`).
- Use a feature branch + PR; never force-push `main` (branch protection).
- Update `.agents/memory/codex-fixes.md` (or a memory file) after each fix.
- Run the relevant skill (`verify-before-commit`, `sync-invariant-check`,
  `state-accuracy-check`, `release-checklist`, `production-go`) before claiming done.
