---
name: Packaging settings & warehouse needs
description: How the 5 packaging single-select fields and their warehouse roll-up work across web+mobile.
---

# Packaging settings

Six single-select packaging config fields live on each run: `cartoned`, `circles`,
`shipper`, `skidStacking`, `gripSheets`, `slipSheets`, PLUS one numeric field
`cartonsPerCase` (and, web-only, `labelPosition`). Defaults are chosen so
existing/blank runs contribute **zero** to warehouse needs EXCEPT the cartoned gate
defaults to "counts". **Web default is now `cartoned:"cartoned"`** (was `"yes"`;
mobile still defaults `"yes"`). Others: `cartonsPerCase:0`, `circles:"none"`,
`shipper:""`, `skidStacking:""`, `gripSheets:"none"`, `slipSheets:"no"`. See the
"cartoned gate" section below for the full web 3-way rework.

The single-select field config is duplicated as a `PACKAGING_FIELDS` array in BOTH
apps (web `types.ts`, mobile `RunContext.tsx`) — keep options/labels in lockstep.
`cartonsPerCase` is NOT in PACKAGING_FIELDS (it's numeric) — it's a standalone
NumField (web Setup → Packaging Settings) / NumericField (mobile configure.tsx,
needs FormState + settingsToForm + save wiring).

## cartoned gate — WEB reworked to 3-way "Packaging Type", MOBILE still yes/no
`cartoned` is the master toggle for whether a run counts toward packaging needs.
- **Mobile (unchanged):** still stores `"yes"`/`"no"`, badge "Cartoned"/"Labeled".
- **Web (reworked):** the field is relabeled **"Packaging Type"** with 3 values
  `cartoned` / `labeled` / `n-a` (display Cartoned / Labeled / N/A). Legacy `"yes"`
  migrates to `cartoned`, `"no"` to `labeled` (in `normalizePackagingFields` inside
  `storage.ts`). Only `cartoned` counts toward warehouse needs.
- **Shared gate helper** `isCartonedValue()` (web `types.ts`) returns true for
  `"cartoned" || "yes"` — use it everywhere web checks the cartoned gate, never a
  raw `=== "yes"`. The shared libs must stay mobile-safe: `inventory-math` accepts
  `"cartoned"||"yes"`; `fill-missing` treats cartons as N/A for `"no"||"labeled"||"n-a"`.
**Why:** web needed a distinct N/A state and label-position tracking; mobile parity
is paused for this task so its yes/no model is deliberately left in place — do NOT
assume both apps share the same cartoned value set.

### labelPosition (web-only, this task)
New per-run `labelPosition` (`top`/`bottom`/`both`) shown only when Packaging Type
is `labeled`. Packaging tab badge becomes "Labeled · <pos>" via `labelPositionLabel()`.

### Editable packaging master lists (web-only, this task)
`circles` / `shipper` / `skidStacking` / `gripSheets` are now user-editable master
lists (inline add/remove, synced, deletion tombstones) mirroring the die-type
pattern — `healPackagingFromProfiles()` in `storage.ts` seeds+heals them; sync uses
`mergeList` with `applyMergedAway=false`. `slipSheets` and Packaging Type / label
position stay FIXED (not editable). The Setup editor's chip UI is factored into
reusable `EditableChipList` (add-only or add+remove) and `FixedChipSelect`
components in `SetupProfileEditor.tsx`; die-type add uses the inline input (no more
`window.prompt`) and the Die Type picker is hidden entirely in Crust line mode.

Both surfaces render the packaging fields: the run **Setup tab** (home.tsx) and the
standalone **Setup Profiles editor** (SetupProfileEditor.tsx). The run Setup tab
selects circles/shipper/skidStacking/gripSheets from the SAME live editable state
arrays (so options added in the profile editor show up there too) and has its own
labelPosition selector under the Packaging Type chips. Add/remove editing of those
lists lives in the profile editor; the run Setup tab is select-only for them (its
die-type "+" still routes to the supervisor manage dialog, unchanged).
**Why:** master lists must be app-wide to mirror the die-type pattern, or added
options are orphaned; labelPosition is per-run so it must be settable on runs not
built from a profile.

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
