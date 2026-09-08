# Allergen Tracking — Plan

## Current State

| Feature | File | What It Does |
|---------|------|-------------|
| Allergen per run | `types.ts:108` | Single `allergen` field per run (none/egg/soy/custom) |
| Allergen normalization | `lib/allergen/src/index.ts` | Normalizes free-form allergen strings, color codes |
| Sequence warnings | `lib/allergen/src/index.ts:169` | Warns if allergen → non-allergen transition needs cleaning |
| Custom allergens | `lib/allergen/src/index.ts:30` | Supports custom allergens from spec sheets (milk, wheat, etc.) |
| Allergen badge | UI components | Visual allergen badge on run cards |

### What's Missing
- No per-ingredient allergen mapping (which ingredients contain which allergens)
- No allergen verification during production (QC doesn't check allergen compliance)
- No allergen declaration on shipping labels
- No allergen cleaning verification after allergen runs
- No cross-contact risk assessment
- No allergen report for a production day

---

## Proposed System

### 1. Ingredient Allergen Mapping
Each ingredient in the system can be tagged with allergens. When a run's recipe includes that ingredient, the run inherits those allergens automatically.

**Data model**:
- Extend `ingredients` table with `allergens` (text array)
- Or new `ingredient_allergens` junction table for cleaner querying
- Pre-populate common allergens: egg, soy, milk, wheat, peanuts, tree nuts, fish, shellfish, sesame

**Implementation**:
- QC or manager tags ingredients with allergens (once, persistent)
- When a run's recipe is set, system auto-computes allergen footprint from ingredients
- Run's `allergen` field becomes derived (or validated) rather than manually entered

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
1. Add `allergens` field to ingredient records
2. Auto-compute run allergen footprint from recipe ingredients
3. Validate/override run allergen field

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
