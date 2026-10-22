# Inventory System — Gap Analysis

**Current status reconciliation: 2026-10-22.** The September analysis below is historical, not a build specification. See [bounded revision-bound evidence](evidence/inventory-accounting-2026-10-22.md) for execution results and remaining business decisions. This is not a production accounting certification.

| Area | Current status | Evidence / remaining work |
|---|---|---|
| Actual-case consumption | **Implemented; existing DB regressions passed** | Below/above plan and absent/initial-zero fallback covered. Explicit saved-zero correction is a different contract. |
| Saved final-total reconciliation | **Implemented; selected sync regressions passed** | Delta-only increases/decreases/zero, packaging edits, baseline merges and rollback/retry already exist. |
| Product mix deduction | **Recorded day-start path implemented** | Existing concurrency, scope, surplus and rollback tests passed; added fresh/carry/date-boundary assertions. |
| Ingredient-linked prep mix | **Implemented; disposable DB regressions passed** | Prep is charged at day start, and an immutable run-to-prepared-stock handoff keeps completion and saved corrections from charging its raw components a second time. Fresh, partial/full carry, date-boundary retries, correction, and ambiguous batch-conversion rollback are covered. |
| Packaging | **Released formulas plus material/mode persistence mapping** | Circles, shippers, cartons, sheets, top/bottom labels, pallets, shipper labels and fixed daily supplies mapped. See exact executed results; current production usage remains unknown. |
| Freezer pull | **Implemented; existing multi-lot parity regressions passed** | Confirm/allocation/retry/replacement/release, over-allocation and scope covered. Not universal reset evidence. |
| Finished-case damage, return and correction | **Implemented, including manager UX and immutable audit** | Existing scoped, authorized, quantity-bounded events and separate manager audit endpoint; do not rebuild this UI. |
| Conversions | **Positive linked factors and legacy factor-one are distinct** | Invalid/missing linked factors are excluded with the existing Warehouse “Conversion needed” soft diagnostic. Conflicting prep batch sizes return a documented 409 and structured warning; no conversion is guessed. Unlinked legacy canonical keys intentionally retain factor one. |
| Dedicated waste/spoilage and mid-run stoppage accounting | **Policy-gated, not implemented by this verification** | Generic manual adjustments and recorded waste pounds are not dedicated physical waste/stoppage events; each needs approved physical accounting rules. |
| Ingredient returns | **Separate policy-gated gap** | Finished-case returns do not establish raw-ingredient return policy. |

Use the dated status above and [inventory auto-deduction plan](inventory-autodeduction-plan.md) for current work. Do not repeat the old planned-case, missing-mix-deduction, or missing-packaging claims below as current facts.

## Historical September snapshot (superseded; not current behavior)

All “current,” “problem,” “fix,” severity and sequencing language below belongs to
the old snapshot. The table above and the linked evidence report supersede it.

## What Inventory Covered in the Historical Snapshot

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
**Historical problem (resolved)**: Day-start previously omitted the run ingredient map, so ingredient-linked prep recipes did not match and their components were not deducted.
**Current behavior**: The scoped day-start event charges fresh prep components and receives prepared pounds. A versioned ledger handoff maps canonical run source lines to prepared stock for completion and saved corrections. Legacy carry is materialized once as an opening prepared-stock lot; it is not charged again.
**Coverage**: Disposable DB tests cover fresh, partial/full carry, yesterday-to-today retries, a completed-run correction decrease/increase/zero/retry, missing unit ambiguity rollback, and raw-stock non-duplication.

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
2. **Mix/prep mix inventory deduction** (implemented and verified at prep, completion, and correction boundaries)
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
