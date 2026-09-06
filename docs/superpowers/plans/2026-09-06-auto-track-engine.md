# Auto-Track Engine Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the pure auto-track decision math out of `useAutoTrack.ts` into `lib/live-calc/src/autoTrackEngine.ts` with unit tests, with the hook delegating (zero behavior change).

**Architecture:** One new pure module in `@workspace/live-calc`; the hook imports from it and re-exports the moved public functions so current consumers are untouched.

**Tech Stack:** TypeScript, pnpm workspace (`lib/live-calc`, `artifacts/run-calculator`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-auto-track-engine-decomposition-design.md`

## Global Constraints

- Zero behavior change: refs, effect declaration order, coordination/claim plumbing untouched.
- Keep web `clampPeriodMs` (1h fallback) semantics distinct from server `autoTrackSchedule.clampPeriodMs` (0 fallback) — name it `clampWebPeriodMs`.
- Re-export moved public symbols from `useAutoTrack.ts` so `home.tsx`, `LiveRunContext.tsx`, and `__mocks__/useAutoTrack.ts` continue to compile.
- AGENTS.md: feature branch + PR (never force-push main), update `.agents/memory/codex-fixes.md` after the fix, don't re-apply documented fixes.
- CI must pass before merge.

---

### Task 1: Engine module + tests

**Files:**
- Create: `lib/live-calc/src/autoTrackEngine.ts`
- Create: `lib/live-calc/src/autoTrackEngine.test.ts`
- Modify: `lib/live-calc/src/index.ts`

**Steps**
- [ ] Copy `clampPeriodMs` (web) as `clampWebPeriodMs`, `getAutoTrackTiming`, `suggestedDoughStaging` from `artifacts/run-calculator/src/hooks/useAutoTrack.ts` verbatim.
- [ ] Add `computeAutoTrackSuggestion` mirroring the hook's `autoTrackSuggestion` memo exactly (gates, `expectedCasesRaw` unclamped, drain path).
- [ ] Add `computeAppSlotInfo` and `computeNetSecondDue` matching both hook effects' semantics.
- [ ] Add `buildCaseClaimMutations`, `buildSauceClaimMutations`, `buildAppSlotClaimMutations`.
- [ ] Write `autoTrackEngine.test.ts` covering every function + edge cases.
- [ ] Re-export engine from `lib/live-calc/src/index.ts`.
- [ ] Run `cd lib/live-calc && pnpm exec tsc -b --force && pnpm exec vitest run` — all green.

### Task 2: Hook delegation

**Files:**
- Modify: `artifacts/run-calculator/src/hooks/useAutoTrack.ts`

**Steps**
- [ ] Import engine functions from `@workspace/live-calc`; delete local `clampPeriodMs`/`getAutoTrackTiming`/`suggestedDoughStaging` bodies (keep re-exports).
- [ ] Replace `autoTrackSuggestion` memo body with `computeAutoTrackSuggestion` call (same deps/inputs).
- [ ] Replace sauce + app-slot due/cadence math and claim-mutation arrays with engine calls (identical values).
- [ ] `cd artifacts/run-calculator && pnpm exec tsc --noEmit -p tsconfig.json`.
- [ ] Run web auto-track suites: `vitest run src/hooks/__tests__/useAutoTrack.sauceBarrel.test.tsx src/hooks/__tests__/useAutoTrack.applicators.test.tsx src/hooks/__tests__/useAutoTrack.pauseResume.test.ts src/hooks/__tests__/useAutoTrack.screenWake.test.ts src/autoTrackFreezerDrain.test.tsx src/autoTrackSuppression.test.tsx src/autoTrackTraysBatches.test.tsx`.
- [ ] Run `LiveTabMemo.snappy.test.tsx` + `LiveRunContext.*`.

### Task 3: Memory + PR

**Steps**
- [ ] Append `.agents/memory/codex-fixes.md` entry (files, problem, fix, context).
- [ ] Update `.agents/memory/server-side-refactor-status.md` (engine PR section).
- [ ] Commit, push branch `refactor/auto-track-engine`, open PR.
- [ ] Verify CI core checks pass; merge `--admin --squash --delete-branch`; sync local main.
