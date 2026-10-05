# Allergen Tracking — Plan

**Status:** Ingredient mappings and an incomplete-safe, read-only run footprint are implemented; QC verification, cleaning gates, declarations, and reporting remain planned
**Updated:** 2026-10-05
**Dependencies:** stable ingredient identity and durable QC ownership must precede automatic rollups or production-blocking cleaning controls. See the [QC plan](qc-department-plan.md) and [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md).

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

### What's Missing
- No allergen verification during production (QC doesn't check allergen compliance)
- No reviewer identity or change history for mapping edits
- No allergen declaration on shipping labels
- No allergen cleaning verification after allergen runs
- No cross-contact risk assessment
- No allergen report for a production day

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
- This foundation does not block runs, verify cleaning, release QC holds, or make label or food-safety claims.

### 2. Allergen Verification (QC)
Before an allergen run starts, QC verifies:
- Line was properly cleaned after previous allergen run
- Correct ingredients are staged (no cross-contact)
- Allergen badge matches what's actually on the line

**Checklist**:
- [ ] Previous run allergen status: ___
- [ ] Cleaning completed: Yes / No
- [ ] Cleaning verified by: ___
- [ ] Current run allergens confirmed: ___
- [ ] Staged ingredients match recipe: ___

### 3. Cleaning Verification
After an allergen run ends, before the next non-allergen run starts:
- Log cleaning start/end time
- Log who performed cleaning
- Log cleaning method (standard / deep / chemical)
- Log verification (visual inspection, swab test, etc.)
- System blocks non-allergen run start until cleaning is logged

### 4. Cross-Contact Risk
When multiple runs are scheduled:
- Flag if allergen run is followed by non-allergen run without cleaning window
- Suggest reordering (allergen runs at end of day)
- Alert if shared equipment isn't cleaned between allergen types

### 5. Allergen Declaration for Labels
Auto-generate allergen statement from run's ingredient allergen mapping:
- "Contains: Egg, Soy, Milk"
- "May contain: Peanuts" (if cross-contact risk)
- Feed into label verification system (QC department)

### 6. Daily Allergen Report
End-of-day summary of allergen activity:
- Which runs were allergen runs
- Cleaning status between runs
- Any allergen violations or near-misses

---

## Build Order

### Phase 1: Foundation
1. Add persisted ingredient mappings and explicit reviewed state — **implemented**
2. Display a separate incomplete-safe run footprint — **implemented**
3. Derive or override the manual run allergen field — **deferred; requires a separate owner decision**

### Phase 2: QC Verification
4. Allergen pre-run checklist (QC)
5. Cleaning verification form
6. System block on non-allergen run start without cleaning

### Phase 3: Labeling & Reporting
7. Auto-generate allergen declaration for labels
8. Daily allergen report
9. Cross-contact risk alerts

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
