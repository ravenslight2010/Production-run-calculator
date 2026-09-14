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

## 6. CODE: battery, server-side, and app quality improvements (2026-09-07)

Codex's analysis of the current codebase. Items grouped by category, ordered
by priority within each group. Each item includes exact file pointers, the
current behavior, and the target behavior. All are green-lit; do them on a
feature branch after Section 5 items land.

---

### 6A. Improve Battery Life

**Current battery profile (good news):**
- `useClock` (`hooks/useClock.ts`) already pauses when `document.hidden` is true ✅
- Auto-track has server-side ownership for both net-second and wall-clock channels ✅
- SSE (EventSource) reconnects automatically ✅

**What still drains battery when the user walks away:**

#### 6A-1. Pause `schedulePush` when hidden [HIGH — easiest win]
- **File:** `artifacts/run-calculator/src/pages/home.tsx` ~line 9261
- **Current:** `setInterval(() => schedulePush(...), 30_000)` fires every 30s
  whether the tab is visible or not. When the user walks away, the browser
  wakes up every 30s to push unchanged state to the server.
- **Fix:** Guard with `if (!document.hidden)` before calling `schedulePush`.
  On `visibilitychange → visible`, fire an immediate push to reconcile.
  The SSE connection already handles reconciliation on wake, so the 30s
  timer is only needed while the user is active.

#### 6A-2. Consolidate 3× 60s timers into one scheduler [MEDIUM]
- **File:** `home.tsx` — three separate `setInterval(..., 60_000)`:
  - ~line 4125: `recordMemorySample("home:interval")` (telemetry)
  - ~line 8808: `pass()` (profile name-link reconcile, fetches + writes
    localStorage)
  - ~line 9493: `checkDateRollover` (midnight detection + archive)
- **Fix:** Merge all three into a single 60s interval. One wake-up per
  minute instead of three. Each function is already independent and
  stateless — just call them sequentially inside one interval callback.

#### 6A-3. Skip non-essential timers when hidden [MEDIUM]
- **Files:** same three 60s timers above, plus `reconcileForeground`
  (line ~5526, interval 30s).
- **Current:** all fire regardless of visibility.
- **Fix:** each timer callback checks `document.hidden` at entry and
  returns early if true. On `visibilitychange → visible`, run them
  once immediately. This means zero timer wake-ups when the user walks
  away (only the SSE EventSource stays alive for incoming pushes).

#### 6A-4. Debounce localStorage writes [LOW]
- **File:** `home.tsx` — 44 `localStorage.setItem` call sites; some fire
  on every keystroke (autosave).
- **Fix:** wrap the heavy write paths (profile saves, marker writes,
  pending saves) in a 300–500ms debounce. Use a shared `debouncedWrite`
  helper so all sites share one timer per key.

#### 6A-5. Button long-press repeat uses 80ms setInterval [LOW]
- **File:** `home.tsx` ~line 2424–2429 (`repeatRef`).
- **Current:** `setTimeout(400ms) → setInterval(80ms)` for numeric field
  repeat on long-press. The interval auto-cleans on mouseup/blur.
- **Fix:** Replace with CSS `animation-iteration-count: infinite` on a
  `:active` pseudo-class, or use `requestAnimationFrame` with elapsed
  tracking. Lower CPU wake frequency.

---

### 6B. Send to Server Side

#### 6B-1. Push profile/config changes via SSE (eliminate 2+ polling timers) [HIGH]
- **Current:** profiles, ingredient filters, die types, and PINs are stored
  in localStorage and polled every 60s via `reconcileForeground` (line
  ~5526) and `pass()` (line ~8808). Each poll fetches from the server,
  diffs against localStorage, and writes if changed.
- **Fix:** server already has the SSE infrastructure. When a profile,
  filter list, or PIN changes on any device, the server broadcasts the
  change to all connected clients via the existing SSE frame. Clients
  adopt on receive. This turns 7+ separate localStorage sync loops into
  one SSE subscription. Eliminates the `reconcileForeground` 30s timer
  AND the `pass()` 60s timer entirely.
- **Server files:** `artifacts/api-server/src/routes/sync.ts` (add config
  change broadcast), new `configSync` broadcast type.
- **Client files:** `home.tsx` SSE handler (add config change adoption),
  `storage.ts` (remove polling-based sync helpers).

#### 6B-2. Server-side date rollover (eliminate `checkDateRollover` timer) [HIGH]
- **Current:** client checks for midnight every 60s (line ~9493), runs
  `archiveCurrentDay + endActiveRuns + startNewDay`.
- **Fix:** server detects midnight (it knows UTC). Broadcasts a `reset`
  event via SSE. Clients apply it on next frame. The server already has
  `POST /api/sync/reset` — add a server-side cron/timer that fires at
  midnight UTC and broadcasts the reset. Eliminates the `checkDateRollover`
  timer entirely.
- **Server file:** new `dailyResetCron.ts` or add to `sync.ts` startup.

#### 6B-3. Merged-away tombstone refresh via SSE [MEDIUM]
- **Current:** `fetchMergedAwayNames()` runs on mount, hits the DB, and
  refreshes localStorage (line ~9205 area).
- **Fix:** server pushes tombstone changes through SSE. Clients adopt on
  receive. Remove the on-mount fetch.

#### 6B-4. Server-side profile reconciliation [MEDIUM]
- **Current:** `pass()` (line ~8808, 60s interval) does profile name-link
  reconciliation — fetches profiles from server, diffs against localStorage,
  writes changes. Also writes `dieTypes` from profiles.
- **Fix:** move this to server push (see 6B-1). When a profile changes on
  any device, the server broadcasts the new name map. All clients adopt.
  The `pass()` function and its 60s timer are eliminated entirely.

#### 6B-5. Client auto-track becomes passive (server-only claims) [MEDIUM]
- **Current:** server sends claims via SSE; client applies them to form
  values. Client still owns the claim-apply path and can independently
  write counter increments if the server claim is delayed.
- **Fix:** server directly mutates the DB row values via the claim write
  path (the parse/apply/row-lock transaction already exists in
  `autoTrackCoordination.ts`). Client becomes a pure display layer for
  auto-track — it reads the authoritative values from the SSE stream and
  never writes counter increments itself. Battery cost of auto-track drops
  to zero on the client; correctness improves because there's one writer.
- **Key files:** `autoTrackServerTicks.ts` (already runs tickWallClock),
  `autoTrackCoordination.ts` (claim apply), `useAutoTrack.ts` (client
  side — becomes read-only).

---

### 6C. Make the App Better

#### 6C-1. Break up `home.tsx` further (24,687 lines → target < 10,000) [HIGH]
- **Current:** `home.tsx` is 24,687 lines. Our earlier extractions
  (ScreenModeView, tab contexts) reduced it from ~31K but it's still
  unmanageable. Replit absorbed those extractions; this is the next round.
- **Next extraction candidates** (follow the established pattern: narrow
  per-concern context + dep registry + Suite 4 freeze-guard test):

  a. **Sync engine → `syncManager.ts`** (~2K lines)
     SSE connection, push logic, recovery, reconciliation, baseline gate,
     push timing. Lines ~8800–9500 area.

  b. **Dialog management → `dialogManager.ts`** (~1.5K lines)
     Import review dialog, stop dialog, merge dialogs, confirm-delete,
     floor mode toggle. Multiple dialog states + their open/close/focus
     handlers.

  c. **Packaging logic → `packagingEngine.ts`** (~800 lines)
     Skid/case/layer tracking, packaging speed nudge, press-done
     switchover, cases-in-freezer increments.

  d. **Run lifecycle → `runLifecycle.ts`** (~600 lines)
     Start/end/pause/resume, daily reset, date rollover, run identity
     management.

  Each extraction: create narrow context → extract component → add dep
  registry (`xxxCtxDeps.ts`) → add freeze-guard test → PR → merge.

#### 6C-2. Virtualize long lists [MEDIUM]
- **Impact:** ingredient lists, recipe rows, and the schedule editor can
  render 50–200 items. Low-end devices struggle.
- **Fix:** use `react-window` or Intersection Observer for any list >
  30 items. Priority: ingredient pickers, recipe row lists, schedule
  editor day rows.

#### 6C-3. Lazy-load inactive tab content [MEDIUM]
- **Current:** tab content components are imported eagerly at the top of
  `home.tsx`. Even with context extractions, the JS for all tabs is in
  the initial bundle.
- **Fix:** use `React.lazy()` for each tab's content component. The
  active tab loads synchronously; others load on first switch. This
  reduces initial bundle size and startup time, especially on slow
  connections (factory Wi-Fi).

#### 6C-4. Optimistic writes with rollback [MEDIUM]
- **Current:** most writes (run values, profile saves, packaging)
  wait for the server response before updating local state. The user
  sees a delay on each save.
- **Fix:** write to local state immediately (optimistic), push to server
  async. On SSE echo, reconcile (the echo is the authoritative state).
  On failure, rollback local state to the last known-good. The SSE echo
  already provides the "truth" — the client just needs to handle the
  failure case.

#### 6C-5. Profile caching (one-time load, not 60s poll) [HIGH]
- **Current:** profiles are stored in localStorage, synced via the 60s
  `reconcileForeground` timer. Each device maintains its own localStorage
  copy and polls for changes.
- **Fix:** load profiles from server on login. Cache in memory (React
  context or zustand store). Push updates via SSE. This eliminates the
  7 localStorage profile sync loops AND the `reconcileForeground` timer.
  Single biggest code simplification (see also 6B-1).
- **Files:** new `ProfileCache` context or zustand store, `storage.ts`
  profile helpers (mark as legacy), SSE handler addition.

---

### Working agreement (unchanged from Section 5)
- Formula/math changes happen ONCE in `lib/live-calc` (or the relevant `lib/*`).
- Use a feature branch + PR; never force-push `main` (branch protection).
- Update `.agents/memory/codex-fixes.md` (or a memory file) after each fix.
- Run the relevant skill (`verify-before-commit`, `sync-invariant-check`,
  `state-accuracy-check`, `release-checklist`, `production-go`) before
  claiming done.

### Priority order for Section 6 items
1. **6A-1 + 6A-2 + 6A-3** (battery quick wins — all in `home.tsx`, low risk)
2. **6B-1 + 6B-2 + 6B-5** (server-side profile/rollover/auto-track — biggest
   architectural win, eliminates 3+ timers, makes client passive)
3. **6C-1** (break up home.tsx — harder but highest long-term code quality win)
4. **6C-5** (profile caching — complements 6B-1, completes the SSE migration)
5. **6C-2 + 6C-3** (virtualize + lazy-load — performance on low-end devices)
6. **6C-4** (optimistic writes — UX polish after the architecture is clean)
