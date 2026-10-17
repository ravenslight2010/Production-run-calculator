# Allergen Tracking — Plan

**Status:** Ingredient mappings, incomplete-safe run footprint, advisory QC checklist, and independent cleaning verification are implemented; blocking gates, declarations, and reporting remain deferred
**Updated:** 2026-10-09
**Dependencies:** ingredient identity and durable QC ownership support the current advisory checklist; production-blocking cleaning controls and label claims remain deferred pending separate approval. See the [QC plan](qc-department-plan.md) and [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md).

## Current State

| Feature | File | What It Does |
|---------|------|-------------|
| Allergen per run | `types.ts:108` | Single `allergen` field per run (none/egg/soy/custom) |
| Allergen normalization | `lib/allergen/src/index.ts` | Normalizes free-form allergen strings, color codes |
| Sequence warnings | `lib/allergen/src/index.ts:169` | Warns if allergen → non-allergen transition needs cleaning |
| Custom allergens | `lib/allergen/src/index.ts:30` | Supports custom allergens from spec sheets (milk, wheat, etc.) |
| Allergen badge | UI components | Visual allergen badge on run cards |
| Ingredient allergen mapping | Ingredient master data | Managers and `qc-manager` can maintain the nine tracked allergens; an explicit reviewed flag distinguishes reviewed-empty from unknown |
| Derived run footprint | Live run view | Read-only footprint uses recipe ingredients, active day substitutions, and selected pepperoni types; missing or unreviewed mappings remain visibly incomplete |

### What's Missing or Deferred
- No reviewed audit history for edits to ingredient allergen mappings
- No allergen declaration on shipping labels; no regulatory or food-safety label claims
- No cross-contact risk assessment or analytics
- No allergen report for a production day
- No production or shipping block based on checklist or cleaning status

---

## Proposed System

### 1. Ingredient Allergen Mapping
Each ingredient in the system can be tagged with allergens. When a run's recipe includes that ingredient, the run inherits those allergens automatically.

**Data model**:
- The `ingredients` table stores an allergen list and whether that mapping was reviewed.
- Tracked vocabulary: egg, soy, milk, wheat, peanuts, tree nuts, fish, shellfish, sesame.
- Reviewed with no selection means none of these nine; missing or unreviewed mappings remain unknown.

**Implementation**:
- Managers and the `qc-manager` role can maintain persistent mappings; `qc-operator` does not receive edit access by default.
- The live run view computes a separate, read-only footprint from effective recipe ingredients, including active day substitutions and selected pepperoni types.
- The footprint names contributing ingredients and marks missing recipe rows, absent catalog identities, or unreviewed mappings as incomplete.
- The existing run `allergen` field remains manually entered and continues to drive sequencing warnings. The footprint does not set or validate it.
- This footprint does not block runs, release QC holds, or make label or food-safety claims. Phase 1 cleaning records are advisory and independently verified.

### 2. Allergen Pre-Run Review (Phase 1 — advisory)

The QC checklist records review of the existing derived run footprint, ingredient mappings that are unknown or incomplete, staged ingredients, and relevant cleaning status. It snapshots what the reviewer saw and who recorded the review. It does not set or validate the manually entered run-allergen field, change sequencing warnings, or block production or shipping.

Unknown or incomplete mappings stay visible in the checklist snapshot; they are never converted into a “clear” result. A reviewed-empty ingredient mapping means none of the nine tracked allergens, while missing or unreviewed mapping remains unknown.

### 3. Cleaning Record and Verification (Phase 1 — advisory)

Cleaning records capture method, start/end time, authenticated cleaner, and server timestamp. An independent authenticated person verifies the record; self-verification is rejected. The checklist may also record the cleaning status relevant to that pre-run review. Neither record blocks a run or shipping.

### 4. Cross-Contact Risk (deferred)
When multiple runs are scheduled:
- Flag if allergen run is followed by non-allergen run without cleaning window
- Suggest reordering (allergen runs at end of day)
- Alert if shared equipment isn't cleaned between allergen types

### 5. Allergen Declaration for Labels (deferred)

No label declaration is generated in Phase 1. Any future declaration wording, cross-contact statement, or label integration requires a separate regulatory and product approval; examples below are discussion-only, not approved claims:
- "Contains: Egg, Soy, Milk"
- "May contain: Peanuts" (if cross-contact risk)
- Feed into label verification system (QC department)

### 6. Daily Allergen Report (deferred)
End-of-day summary of allergen activity:
- Which runs were allergen runs
- Cleaning status between runs
- Any allergen violations or near-misses

---

## Build Order

### Phase 1: Foundation and advisory QC — implemented
1. Persist ingredient mappings with explicit reviewed state.
2. Display a separate incomplete-safe run footprint.
3. Record the advisory pre-run footprint/staged-ingredient/cleaning review.
4. Record cleaning details with a different authenticated verifier.
5. Keep the manual run-allergen field and its sequencing behavior unchanged.

### Phase 2: Later Gates and Reporting — deferred
4. Cross-contact risk review or analytics
5. Allergen declaration and label integration, after a separate regulatory/product decision
6. Daily allergen report
7. Any production or shipping gate requires a separate approval and is explicitly outside Phase 1

---

## Key Code References
| File | Purpose |
|------|---------|
| `lib/allergen/src/index.ts` | Allergen model, normalization, sequence warnings |
| `artifacts/run-calculator/src/types.ts:108` | Run allergen field |
| `lib/db/src/schema/ingredients.ts` | Ingredient table (extend with allergens) |
| `lib/db/src/schema/inventory.ts` | Inventory items (link to ingredients) |
| `artifacts/run-calculator/src/departments/QcDepartment.tsx` | QC department (add allergen checks) |
| `lib/day-summary/src/index.ts` | Summary (extend with allergen stats) |
