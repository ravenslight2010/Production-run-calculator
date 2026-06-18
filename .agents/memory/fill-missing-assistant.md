---
name: Fill-missing run-setup assistant
description: How the "Fill in missing data" run-setup assistant detects/proposes/commits values, and its parity + no-auto-apply invariants.
---

# Fill-missing run-setup assistant

A run-setup panel that lists every field a valid run needs that is blank/zero/incomplete,
proposes a value per field, and writes ONLY on explicit per-field confirm.

## Source priority (per field)
profile → spec sheet → documented default → AI → none. The first non-blank wins; the
chosen source is shown as a labeled badge on each row.

## Invariants (do not break)
- **Never auto-apply.** Values are only written when the user taps/clicks Apply on that row.
  Each Apply commits a single field through the EXISTING update path — no new write path:
  - web: `form.setValue(key, val, {shouldDirty:true})` → the `[v]` autosave effect persists
    run values + profile. Do not add a separate save call.
  - mobile: `updateSettings({ [key]: value })` (current-run partial updater).
- **AI is read-only.** `/ai/fill-missing` returns value+rationale, NEVER writes. AI only fills
  rows whose known-source is `none` and that are `fillable`. AI button is manager-gated
  (`useMe().isManager`) on both apps; edit is gated by web `isSupervisor` / mobile PIN unlock.
- **Web+mobile parity.** Detect/propose logic lives in a mirrored shared module
  (`run-calculator/src/fillMissing.ts` and `run-calculator-mobile/context/fillMissing.ts`) —
  identical types/logic. The two panel components mirror each other's flow (scan → AI → apply/skip).
  `FillMissingInput` type is defined LOCALLY in each module (neither app depends on @workspace/api-zod,
  only @workspace/api-client-react).

## Drift / scope decisions
- **Recipes are intentionally excluded** from required-field detection: a run is computable from
  flat batch-lbs/oz scalars, so recipe rows are not treated as "missing required fields" here.
- `brand`/`flavor` are marked `fillable:false` (run identity, set on the run itself, not committable
  from this panel). `dieType` IS fillable + AI-eligible.
- Documented defaults = web formSchema `.default()` values (NOT the all-zero DEFAULT_VALUES/DEFAULT_SETTINGS
  "blank run" baseline — don't confuse the two).
