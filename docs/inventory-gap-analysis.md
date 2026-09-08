# Inventory System — Gap Analysis

## What Inventory Currently Covers

The `computeRunLines` function in `lib/inventory-math/src/index.ts` computes consumption for these categories at **run-end** only:

| Category | Key Pattern | Unit | Trigger |
|----------|------------|------|---------|
| Dough | `ingredient:Dough:batches` | batches | Run end |
| Sauce | `ingredient:Sauce:batches` or `ingredient:{name}:lbs` | batches/lbs | Run end |
| Applicators (cheese/mixes) | `ingredient:{type}:batches` or `ingredient:{type}:lbs` | batches/lbs | Run end |
| Pepperoni/toppings | `ingredient:{type}:lbs` or `ingredient:{type}:batches` | lbs/batches | Run end |
| Circles | `packaging:circles:{size}` | circles | Run end (cartoned only) |
| Shippers | `packaging:shippers:{type}` | shippers | Run end (cartoned only) |
| Cartons | `packaging:cartons:cases` | cases | Run end (cartoned only) |
| Sauce barrels | Separate endpoint `consume-sauce-barrel` | barrels | Manual per-barrel |

**Key limitation**: Consumption is computed from the **planned** `casesNeeded`, not the **actual** `casesCompleted`. The server reads form values from `dailySyncTable` and derives lines from the planned recipe.

---

## Identified Gaps

### Gap 1: Overproduction Ingredients (Critical)
**Problem**: When actual production exceeds the planned target, extra ingredients are consumed but inventory only reflects the planned amount.
**Impact**: Inventory drifts from reality — more severe for high-overproduction brands/flavors.
**Fix**: When surplus is confirmed, deduct the overproduced ingredients separately (already planned in overproduction surplus plan).

### Gap 2: Mix / Prep Mix Ingredients (Critical)
**Problem**: Mix plan is purely advisory — when prep mixes are made, nothing deducts from inventory.
**Impact**: Mix ingredients (cheese, sauce, veggies, spices) disappear from stock without a record.
**Fix**: When "Already Made" is entered or a new mix-made action fires, deduct component ingredients (already planned in mix plan backlog).

### Gap 3: Waste & Spoilage (Medium)
**Problem**: No tracking of:
- Dough waste (scrap dough at end of shift)
- Sauce waste (leftover in barrel after run)
- Packaging waste (damaged boxes, misprinted labels)
- Ingredient spoilage (went bad before use, separate from lot expiry)
**Impact**: Inventory shows stock that physically doesn't exist anymore.
**Fix**: Add waste/spoilage logging with reason codes and audit trail. Could be manual entry or QC-initiated.

### Gap 4: Stoppages Mid-Run (Medium)
**Problem**: When a run stops mid-production (equipment failure, quality issue), partially-used ingredients may be wasted but inventory doesn't reflect this.
**Impact**: The run may resume with new ingredients, double-charging inventory.
**Fix**: Track ingredient waste at stoppage events. When a stoppage is logged, prompt: "Were any ingredients wasted?" → deduct.

### Gap 5: Ingredient Returns (Low-Medium)
**Problem**: When ingredients are pulled for a run but the run ends early, unused ingredients may not be returned to stock.
**Impact**: Inventory under-reports available stock.
**Fix**: At run-end, compare pulled vs actually used → offer to return excess to inventory.

### Gap 6: Non-Cartoned Packaging (Low)
**Problem**: Packaging consumption only fires for `cartoned = "cartoned" || "yes"`. Runs marked "labeled" or "no" don't consume packaging even though they likely use labels, bags, or boxes.
**Impact**: Packaging inventory over-reports for non-cartoned runs.
**Fix**: Add packaging consumption for labeled runs (labels, bags) and "no" runs (minimal packaging).

### Gap 7: Freezer Pull Not Deducting (Medium)
**Problem**: When warehouse pulls items from the freezer for a run, the pull is tracked in the freezer surplus system but doesn't deduct from the main inventory.
**Impact**: Inventory and freezer surplus show the same stock — double-counted.
**Fix**: Freezer pull should deduct from the freezer location's lot inventory and create a ledger entry.

### Gap 8: Conversion Factor Missing (Low)
**Problem**: If `conversionFactor` is null on an inventory item, the draw-down may use incorrect units (e.g., deducting 40 lbs instead of 2 boxes).
**Impact**: Potential over- or under-deduction.
**Fix**: Require conversion factor before allowing consumption, or default to 1 with a warning.

---

## Root Cause

The core issue is that **inventory consumption is a single-point event** (run-end via `POST /inventory/consume`) rather than a continuous process. The real production flow has many touchpoints where inventory changes:

```
Ingredient arrives (restock ✓)
  → Pulled for prep mix (GAP: no deduction)
  → Prep mix made (GAP: no deduction)
  → Pulled from freezer for run (GAP: no deduction)
  → Run starts (partial consumption OK)
  → Run stops mid-way (GAP: no waste tracking)
  → Run resumes (double-charges?)
  → Run ends (consumption ✓ — but based on PLAN, not ACTUAL)
  → Overproduction (GAP: extra ingredients not deducted)
  → Waste/scrap (GAP: not tracked)
  → Unused returned (GAP: not returned to stock)
```

## Recommended Fix Order

1. **Overproduction inventory deduction** (already planned — highest impact)
2. **Mix/prep mix inventory deduction** (already planned — second highest)
3. **Freezer pull → inventory deduction** (prevents double-counting)
4. **Waste/spoilage logging** (manual but audited)
5. **Use actual cases instead of planned** (cleaner long-term fix)
6. **Stoppages waste tracking** (medium priority)
7. **Ingredient returns at run-end** (nice to have)
8. **Non-cartoned packaging** (low priority)

---

## Key Code References
| File | Purpose |
|------|---------|
| `lib/inventory-math/src/index.ts:278` | `computeRunLines` — consumption line computation |
| `lib/inventory-math/src/index.ts:393` | `computeRunConsumptionLines` — wrapper |
| `artifacts/api-server/src/routes/inventory.ts:1311` | `findExpectedConsumptionForRun` — reads planned values |
| `artifacts/api-server/src/routes/inventory.ts:1560` | `POST /inventory/consume` — run-end deduction |
| `artifacts/api-server/src/routes/inventoryLogic.ts` | `applyRunConsumption` — draw-down engine |
| `lib/db/src/schema/inventory.ts` | All inventory tables |
| `artifacts/run-calculator/src/freezerSurplus.ts` | Freezer surplus logic |
| `lib/freezer-pull/src/surplus.ts` | Surplus math |
