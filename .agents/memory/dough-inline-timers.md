---
name: Dough inline timers & measured machine times
description: Web Dough tab live countdowns, machine-time pacing of auto-track, and the tickDueRefs anchoring contract
---

# Dough inline timers (web-only, graduated from canvas mockup 2026-07-08)

- Three form fields `mixerLowSec`/`mixerHighSec`/`hopperSec` (0 = not measured) are run-value config, deliberately NOT in PROGRESS_FIELDS. They flow through the normal form persistence/sync paths like any other run value.
- `useAutoTrack` accepts optional `machine: {spinSec, hopperSec}`:
  - `spinSec > 0` → the "+1 batch produced" tick period becomes the measured spin time instead of line-speed batch time.
  - batch drain period = `max(hopperMs, lineBatchMs)`, quarter-ticks, consumption scaled to that effective period. Everything falls back to old line-speed behavior at 0.
- **Countdown anchoring rule:** any UI countdown for an auto counter must anchor to the hook's exposed `tickDueRefs` (next-due timestamps per counter), never re-derive its own schedule — otherwise display and counter drift apart.
- **Why:** the hook re-arms/clamps its own schedule (suppression, resume, run switches); a parallel UI timer cannot stay in sync.
- **Gotcha (caught in review):** `fireAutoTrackNow()` ("Resume now") must reset ALL due refs including the production ones (`trayProd`, `batchProd`), or resume looks broken for the production countdowns.
- Packaging quick-check card encodes skids+cases as one packed total (`floor/mod` by casesPerSkid) and must keep the old steppers' upper clamp (total ≤ casesNeeded). Crust mode and casesPerSkid ≤ 0 keep the plain steppers.
- Dev note: editing home.tsx always triggers a full Fast Refresh invalidate (`useDropdownScrollKeeper` export) — a one-off "Invalid hook call in <Home>" in the console right after HMR is that known artifact, not a code bug; fresh loads are clean.
