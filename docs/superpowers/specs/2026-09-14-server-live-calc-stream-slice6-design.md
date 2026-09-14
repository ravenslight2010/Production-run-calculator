# Server Live-Calc Streaming — Slice 6: Display Strips Adopt the Server Model

## Context

Slice 5 made `LiveRunContext` the owner of the line-phase model: the server
streams `linePhases` in `OperationalProjection`, the client adopts confirmed
projection phases with countdown extrapolation, and the local derivation is
kept as an exact offline/lag fallback.

The visible 3-phase strips in `home.tsx` were explicitly left deriving locally
(slice-5 "out of scope"). That left the app's most-visible phase UI running the
client derivation on every render, duplicating what the context now owns.

## Goal

Remove the remaining direct `computeLinePhases` derivations from the Live and
Packaging tabs so all phase display flows through the server-adopted context
model (`useLiveRun().linePhases`), which internally falls back locally when
offline/lagging — never blank.

## Changes

Three call sites in `artifacts/run-calculator/src/pages/home.tsx` are displaced:

1. **Ended-run compact badge** (`LiveRunTabContent`): when the ended run is the
   current run (`lastEndedRun?.id === currentRun?.id`), use the context
   `linePhases`; the legacy `computeEndedRunElapsedSec` + `computeLinePhases`
   derivation stays only as a defensive fallback for a mismatched ended run.

2. **3-phase line status strip** (`LiveRunTabContent`, running/paused):
   `const phases = linePhases;` — the strip's visibility guards
   (`freezerMin <= 0`, `calc.ppm <= 0`) are unchanged.

3. **Line-stage section** (`LivePackagingTabContent`, filling and draining
   panels): `const phases = linePhases;` — the context model covers the current
   run in every lifecycle state (running / paused / ended), so both the
   showFilling and showEmptying paths read the same source.

Unused local pause parsing and the `pauseStopsTunnel` import are removed.

## Safety

- The context model is authoritative when a fresh confirmed projection exists;
  otherwise `LiveRunContext` falls back to the same local `computeLinePhases`
  with the same day-state inputs the strips used before (identical math).
- `packagingDrainActive` / auto-track gating already consumed the context model
  (slice 5); this slice only changes what the strips display.
- End-of-run wall-clock drain remains derived from `endedAt` in the shared
  model, so the "Freeze Tunnel Draining · Prior Run" behavior is unchanged.

## Tests

- Typecheck (`tsc -p tsconfig.json --noEmit`) — clean.
- Focused regressions: `linePhases.test.ts`, `LiveRunContext.linePhases`,
  `LiveRunContext.calcTick`, `operationalState`, `autoTrackFreezerDrain`,
  `autoTrackTraysBatches` — 104/104 pass.
- Browser/e2e phase-strip checks run in CI (no local browser harness).

## Out of scope

- Mobile parity.
- Setup-form server calcs / ingredient math (separate migration items).

## Rollback

Reverting the three site edits returns the strips to their previous local
derivations; the context model remains authoritative for auto-track gating
from slice 5. All changes are display-only.
