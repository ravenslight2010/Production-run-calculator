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

- **The import is per-mix confirmation-based, not all-or-nothing.** The review dialog/modal
  MUST list every parsed mix (matched product, batch size, ingredient count, days-early note,
  new/update badge) with an include/exclude toggle, and commit only the selected ids.
  **Why:** an aggregate "N new / M updated" summary alone was rejected in review — a bulk
  operation that overwrites existing master-data needs candidate-level sign-off.
  **How to apply:** keep `buildPremixCandidates` (lib) feeding the prepared result and pass the
  selected ids into `commitPremixImport(prepared, selectedIds)` on both platforms.

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
