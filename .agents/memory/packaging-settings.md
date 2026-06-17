---
name: Packaging settings & warehouse needs
description: How the 5 packaging single-select fields and their warehouse roll-up work across web+mobile.
---

# Packaging settings

Six single-select packaging config fields live on each run: `cartoned`, `circles`,
`shipper`, `skidStacking`, `gripSheets`, `slipSheets`, PLUS one numeric field
`cartonsPerCase`. Defaults are chosen so existing/blank runs contribute **zero**
to warehouse needs EXCEPT `cartoned` defaults to `"yes"` (per user request):
`cartoned:"yes"`, `cartonsPerCase:0`, `circles:"none"`, `shipper:""`,
`skidStacking:""`, `gripSheets:"none"`, `slipSheets:"no"`.

The single-select field config is duplicated as a `PACKAGING_FIELDS` array in BOTH
apps (web `types.ts`, mobile `RunContext.tsx`) — keep options/labels in lockstep.
`cartonsPerCase` is NOT in PACKAGING_FIELDS (it's numeric) — it's a standalone
NumField (web Setup → Packaging Settings) / NumericField (mobile configure.tsx,
needs FormState + settingsToForm + save wiring).

## cartoned (yes/no) gate
`cartoned` is the master toggle for whether a run counts toward packaging needs.
In the Packaging tab it renders as a status badge — "Cartoned" (yes) or "Labeled"
(no) — and is filtered OUT of the generic field-row list (shown as badge only).
The warehouse roll-up **skips any run where `cartoned !== "yes"`** entirely.
**Why:** labeled (non-cartoned) runs don't consume circles/shippers.

## Warehouse "Packaging Needs — All Runs"
Across active (non-ended) runs that are cartoned, grouped by the selected type
value, skipping `none`/empty:
- **circles = 1 per pizza** → `totalPizzas = casesNeeded * pizzasPerCase`
- **shippers = 1 per case** → `totalCases = casesNeeded`
- **cartons (cases)** → `sum(totalPizzas / cartonsPerCase)` across cartoned runs,
  guarded for `cartonsPerCase > 0`, displayed once as `Math.ceil(total)` (whole
  cases). Each pizza needs one carton; cartons ship by the case.

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
