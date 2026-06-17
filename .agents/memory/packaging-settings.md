---
name: Packaging settings & warehouse needs
description: How the 5 packaging single-select fields and their warehouse roll-up work across web+mobile.
---

# Packaging settings

Five single-select packaging config fields live on each run: `circles`, `shipper`,
`skidStacking`, `gripSheets`, `slipSheets`. Defaults are chosen so existing/blank
runs contribute **zero** to warehouse needs: `circles:"none"`, `shipper:""`,
`skidStacking:""`, `gripSheets:"none"`, `slipSheets:"no"`.

Field config is duplicated as a `PACKAGING_FIELDS` array in BOTH apps (web
`types.ts`, mobile `RunContext.tsx`) — keep options/labels in lockstep.

## Warehouse "Packaging Needs — All Runs"
Across active (non-ended) runs, grouped by the selected type value, skipping
`none`/empty:
- **circles = 1 per pizza** → `totalPizzas = casesNeeded * pizzasPerCase`
- **shippers = 1 per case** → `totalCases = casesNeeded`

Web reads these from `computeSummaryStats` (`totalPizzas`/`totalCases`); mobile
computes them directly from `run.settings` (same formula) since mobile `computeCalc`
exposes only *remaining* counts, not planned totals. **Why:** the roll-up is planned
consumption for the whole run, not what's left.

## Line Settings PIN parity exception
Web shows the Line Settings section always (inner `fieldset disabled={!isSupervisor}`
still gates edits). Mobile gates the ENTIRE configure screen behind the supervisor
PIN (no per-section gate), so it was left unchanged — documented parity exception.

## Chip behavior
Single-select chips are clearable: tapping the active option resets it to `""`.
Intentional and identical on both platforms.
