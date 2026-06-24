---
name: Premix sheet import
description: In-app premix .xlsx import in the Mixes section (web+mobile) — deterministic parse lib, AI name-only matcher, per-mix review, and contract/parity gotchas.
---

# Premix sheet import

Managers upload premix `.xlsx` workbooks in the **Mixes** section on BOTH apps. Each
product tab/block → a Mix (name, AI-matched brand+flavor, `batchSize` = the block
"Total"/"Per Batch" lbs, `components[{ingredient, perPizza}]`, `daysEarly` + raw
"Pull N Days Early" note). Re-import upserts by deterministic id (no dupes). Quantities
are parsed DETERMINISTICALLY in the shared lib; AI ONLY disambiguates product names.

## Decisions / gotchas

- **The import is per-mix confirmation-based AND per-mix re-matchable, not all-or-nothing.** The
  review dialog/modal MUST list every parsed mix (matched product, batch size, ingredient count,
  days-early note, new/update badge) with an include/exclude toggle AND brand/flavor re-match
  pickers so a manager can correct a wrong AI/auto product match before applying.
  **Why:** an aggregate "N new / M updated" summary alone was rejected — a bulk operation that
  overwrites existing master-data needs candidate-level sign-off; and a wrong product match must
  be fixable in the same pass rather than re-importing.
  **How to apply:** `buildPremixCandidates` (lib) feeds the prepared result; re-match goes through
  the pure `rematchPremixCandidate(candidate, brand, flavor, exists)` (rebuilds the mix id via
  `premixId`, recomputes new/update). `commitPremixImport(prepared, mixesToApply: Mix[])` now takes
  the FINAL reviewed `Mix[]` (NOT selected ids) so edited matches are carried through. Selection
  state in the UI MUST be keyed by the ORIGINAL parsed mix.id (a stable key), because re-match
  changes the candidate's own id. Changing brand resets flavor (`rematch(key, newBrand, "")`).

- **Match-premix request body field is `unmatchedNames`, NOT `names`.** The server contract
  requires `unmatchedNames`. The client glue uses a hand-written local request type + raw
  `fetch`, so a wrong field name TYPECHECKS CLEAN but every call 400s and silently falls back
  to deterministic-only grounding (AI never runs). If AI matching "does nothing", check this
  field first. **Why:** the local types aren't anchored to the generated schema (same pattern
  as the existing import matcher) — drift is invisible to tsc.

- **Import action is gated on `isManager`** (inside the `canManageInventory` Mixes section) on
  BOTH apps. **Why:** parity — web chose manager-only for the import action; mobile must match.

- AI is advisory/fail-safe: any failure (not a manager, AI down, sync disabled) is caught and
  the import proceeds with deterministic grounding. Writes go ONLY through the existing
  manager-gated `saveMixes` path. Mixes are master-data — NOT in `/sync`.

- Reuses learned spec-import alias memory and mirrors new brand/flavor mappings into the
  factory-wide AI corrections pool (both best-effort).
