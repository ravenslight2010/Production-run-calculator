# Auto-Track Engine Decomposition — Design (Step 6b foundation)

## Goal

Decompose the 1,645-line `useAutoTrack.ts` hook by extracting its pure decision
math into a shared, unit-tested engine in `@workspace/live-calc` — the same
package the server already uses for Step 6a. This is the documented
prerequisite for Step 6b (client adopts server tick times as authoritative) and
Step 6c (server-owned tick execution).

## Status

Approved 2026-09-06 by user ("Continue with your recommended way to get to the
ultimate goal").

## Approach (chosen)

Approach 1 from the brainstorming design: **extract a pure auto-track engine**
into `lib/live-calc`, with `useAutoTrack` delegating to it. Zero behavior
change; refs, effects, and effect declaration order stay untouched. Deliver as
small PRs with unit tests + the existing auto-track suites as the safety net.

## Architecture

New file: `lib/live-calc/src/autoTrackEngine.ts` + `autoTrackEngine.test.ts`.

Pure functions (no React imports):

- `clampWebPeriodMs(ms)` — web semantics: invalid/<=0 → 1h; clamp [1000, 3600000].
  **Gotcha:** distinct from `autoTrackSchedule.clampPeriodMs` (server) which
  returns 0 for invalid and clamps [2000, 3600000]. Names stay distinct to
  prevent cross-contamination.
- `getAutoTrackTiming(ppm, pizzasPerCase, perTray, perBatch, machine?)` — moved
  verbatim from the hook (already exported; consumers: home.tsx,
  LiveRunContext.tsx, useAutoTrack internal calls).
- `computeAutoTrackSuggestion(input)` — the `autoTrackSuggestion` memo body,
  pure. Returns `{ skids, casesOnSkid, expectedCases, expectedCasesRaw, trays:
  null, batches: null }` or `null` under the same gates.
- `computeAppSlotInfo({ type, recipe, batchLbs, ozPerPizza, required, ppm })` —
  per-applicator-slot effective batch, cadence, and `validForClaim` gate. Both
  hook effects (anchor-rebase + claim) use the same fields with the same
  semantics; the claim gate (type non-empty, non-mix, positive effective
  batch/oz/required/ppm) is separate from cadence computation.
- `computeNetSecondDue({ currentDue, anchor, cadence })` — `currentDue > 0 ?
  currentDue : anchor + cadence` (sauce/applicator due-at semantics).
- Claim mutation builders: `buildCaseClaimMutations`, `buildSauceClaimMutations`,
  `buildAppSlotClaimMutations` — the exact arrays the claim endpoint validates.

`useAutoTrack.ts` becomes a delegator for these parts (imports from
`@workspace/live-calc`) and re-exports `getAutoTrackTiming`,
`suggestedDoughStaging`, `SuggestedDoughStagingReturn`, `AutoTrackTiming` so
existing consumers (`home.tsx`, `LiveRunContext.tsx`, `__mocks__/useAutoTrack.ts`)
keep working unchanged.

`suggestedDoughStaging` (already pure, exported from the hook) also moves to the
engine; the hook re-exports it.

## Explicitly out of scope for this PR

- Per-tick case/tray/batch delta logic (still entangled with refs +
  `commitAutomatic` seeding) — follow-up engine PR.
- Any change to refs, effect order, coordination/claim plumbing, or the
  server route from Step 6a.

## Testing

- New `lib/live-calc/src/autoTrackEngine.test.ts` covering every function
  including edge cases (invalid timing inputs, mix-type slots, recipe vs
  BatchLbs fallback, clamped expected cases, saturated-expectation delta math).
- Run: `lib/live-calc` vitest (43 existing + new), then the web auto-track
  suites (`hooks/__tests__/useAutoTrack.*`, `autoTrack*`, `LiveTabMemo`,
  `LiveRunContext.*`) and full typecheck.
- CI gates as usual (Typecheck, Unit web+libs, API Postgres, Build, Docker).

## Deliverables

1. `lib/live-calc/src/autoTrackEngine.ts` + tests, with live-calc index
   re-exports.
2. `useAutoTrack.ts` delegation + re-exports; no behavior change.
3. Memory updates in `.agents/memory/codex-fixes.md` and
   `.agents/memory/server-side-refactor-status.md`.
4. PR `refactor/auto-track-engine` → merge after CI passes.

## Follow-on slices (after this lands)

- Engine PR #2: per-tick case/tray/batch delta extraction.
- Step 6b: client adopts server net-second due-times as authoritative.
- Step 6c: server-owned tick execution.
