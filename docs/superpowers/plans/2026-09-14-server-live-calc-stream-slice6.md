# Server Live-Calc Streaming — Slice 6: Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** All line-phase display in the Live and Packaging tabs reads the server-adopted context model; local derivations remain only as defensive fallbacks.

**Spec:** `docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice6-design.md`

---

## Task 1: Displace the three home.tsx phase call sites

**Files:**
- Modify: `artifacts/run-calculator/src/pages/home.tsx`

**Steps:**
- [x] Add `linePhases` to the `useLiveRun()` destructures in `LiveRunTabContent` (sites 1 + 2) and `LivePackagingTabContent` (site 3).
- [x] Ended-run compact badge: context model when `lastEndedRun?.id === currentRun?.id`; legacy derivation kept as fallback.
- [x] 3-phase line status strip: `phases = linePhases` (guards unchanged).
- [x] Line-stage section: `phases = linePhases` for both filling and emptying paths.
- [x] Remove now-unused local pause parsing and the `pauseStopsTunnel` import.
- [x] `tsc -p tsconfig.json --noEmit` clean.
- [ ] Commit: `feat(web): line-phase strips adopt server model`.

## Task 2: Regression gates + docs + merge

**Steps:**
- [x] Run focused suites (linePhases, LiveRunContext.*, operationalState, autoTrackFreezerDrain, autoTrackTraysBatches) — 104/104.
- [x] Write slice-6 spec + plan; update `docs/idea-backlog.md` §13 and `.agents/memory/codex-fixes.md`.
- [ ] Commit: `docs: mark live server-calc streaming slice 6 done`.
- [ ] Push `feat/line-phase-strips-server-adoption`, open PR → `main`.

## Notes

- Display-only change; auto-track gating already consumed the context model from slice 5.
- Browser/e2e phase-strip verification runs in CI.
