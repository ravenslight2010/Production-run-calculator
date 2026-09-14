# Inventory Auto-Deduction — Comprehensive Plan

## The Core Problem
Inventory consumption is a **single-point event** at run-end, computed from the **planned** `casesNeeded`. Multiple production activities that consume ingredients or packaging are not reflected in inventory. This causes inventory to drift from reality over time.

---

## A. Overproduction Inventory Deduction (Critical)

**Already planned** in `docs/overproduction-surplus-plan.md`.

**What**: When actual production exceeds planned target, extra ingredients are consumed but not deducted.
**Fix**: When surplus is confirmed (store-in-freezer or use-on-next-run), compute extra ingredient consumption for overproduced cases and deduct separately.
**When**: At surplus confirmation moment.
**Audit**: "Overproduction: {excess} cases → deducted {qty} {item} from inventory"

---

## B. Mix / Prep Mix Inventory Deduction (Critical)

**Already planned** in idea backlog entry #1.

**What**: When prep mixes are made, component ingredients are consumed but not deducted.
**Fix**: When "Already Made" is entered or a new mix-made action fires, deduct component ingredients from inventory.
**When**: At mix-made confirmation.
**Audit**: "Prep mix made: {mix name} → deducted {qty} {ingredient} from inventory"

**Mix Surplus / Leftover**: Track remaining mix in freezer. Auto-allocate to next matching run. Reminder: "You have 15 lbs of Bobo's Veggie Mix in the freezer."

---

## C. Freezer Pull — Fix Double-Counting (Medium)

**Problem**: When warehouse pulls items from the freezer for a run, the pull is tracked in the freezer surplus system but doesn't deduct from the main inventory lots. This means the same stock is counted twice — once in inventory and once in the freezer surplus.

**Fix**: When a freezer surplus allocation is confirmed ("Use on Next Run" or manual pull):
1. Deduct the allocated cases from the freezer location's inventory lots
2. Create a ledger entry: type "consume", note "freezer pull for run {id}"
3. The freezer surplus system already tracks the allocation — this just syncs inventory

**When**: At allocation confirmation in `FreezerSurplusPanel`.
**API**: Extend `POST /api/freezer-surplus/allocate` to also call inventory draw-down.

---

## D. Actual Cases Instead of Planned (Medium)

**Problem**: `findExpectedConsumptionForRun` reads the planned `casesNeeded` from form values. When actual production differs, inventory is wrong.

**Fix**: Use `casesCompleted` (actual) when available, fall back to `casesNeeded` (planned).

**Implementation**:
1. When a run ends, the server has access to the run's `endedAt` timestamp and the day-state
2. The day-state stores `runValues` which include the form values at run-end
3. The form values include `casesCompleted` (written by auto-track or manual entry)
4. Change `findExpectedConsumptionForRun` to:
   - Read `casesCompleted` from the run's stored values
   - If `casesCompleted > 0` AND `casesCompleted ≠ casesNeeded`:
     - Scale all ingredient lines proportionally: `actual_qty = planned_qty × (casesCompleted / casesNeeded)`
   - If `casesCompleted = 0` or missing: use planned (current behavior, backward-compatible)
5. This makes run-end consumption match actual production, reducing the overproduction gap

**Key safety**: The ratio scaling preserves ingredient proportions — if you made 10% more cases, you used 10% more of every ingredient.

**Caveat**: If a run stops early and resumes, `casesCompleted` may be incomplete. The server should use the final `casesCompleted` at the time of `POST /inventory/consume`.

---

## E. Non-Ingredient / Packaging Inventory Gaps

### Gap E1-E3: Packaging Consumption Per Mode
**Problem**: Only `cartoned` runs consume circles/shippers/cartons. `labeled` runs consume nothing. Grip sheets, slip sheets, and skid stacking are never tracked.

**Fix**: Extend `computeRunLines` to handle all packaging modes:

| Mode | Circles | Shippers | Cartons | Top/Bottom Labels | Shipper Labels | Slip/Grip Sheets | Pallets | Tape/Glue/Ink |
|------|---------|----------|---------|-------------------|---------------|-----------------|---------|--------------|
| `cartoned` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| `labeled` | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `n-a` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |

**Key insight**: Circles, shippers, grip/slip sheets, pallets, and tape/glue apply to BOTH cartoned and labeled runs — only cartons and labels are mode-specific. `n-a` still uses pallets and grip/slip sheets (physical stacking needs them).

**Implementation**:
- Move circles/shippers OUTSIDE the `cartoned` gate
- Add label roll deduction for `labeled` runs
- Add grip sheets, slip sheets, pallets, tape, glue, ink as universal packaging lines

### Gap E4: Full Packaging Inventory List
**Problem**: The system only tracks 3 packaging items (circles, shippers, cartons). The real factory uses 13+ packaging items, most lot-tracked by QC.

**Complete packaging list** (what the factory actually uses):

| Item | Unit | How Computed | Currently Tracked |
|------|------|-------------|-------------------|
| **Circles** | circles | totalPizzas × circle size | ✓ cartoned only |
| **Shippers** | shippers | totalCases × shipper type | ✓ cartoned only |
| **Cartons** | cases | totalPizzas / cartonsPerCase | ✓ cartoned only |
| **Slip sheets** | sheets | per skid layer | ✗ |
| **Grip sheets** | sheets | per skid layer (based on gripSheets setting) | ✗ |
| **Top labels** | rolls | totalPizzas / labelsPerRoll (top position) | ✗ |
| **Bottom labels** | rolls | totalPizzas / labelsPerRoll (bottom position) | ✗ |
| **Shipper labels** | rolls | totalCases / labelsPerShipper | ✗ |
| **Pallets** | pallets | Math.ceil(casesNeeded / casesPerSkid) | ✗ |
| **Tape** | rolls | per N skids or per run | ✗ |
| **Glue** | lbs/oz | per run (labeling) | ✗ |
| **Glue sticks** | sticks | per run (labeling) | ✗ |
| **Ink** | cartridges | per run (labeling) | ✗ |

**Fix**: Add all 13 items to `computeRunLines` with proper computation logic. Each gets a consumption key, category "packaging", and deducts from inventory at run-end.

**QC lot tracking tie-in**: Most of these packaging items get lot-tracked by QC. The lot tracking system (from QC department plan) connects here — when packaging is consumed from inventory, the lot number should be recorded. This creates the full chain: **QC lot entry → inventory deduction → run consumption → audit trail**.

### Gap E5: Pallets / Skids
**Problem**: `casesPerSkid` and `skidsCompleted` are tracked but pallets themselves are never consumed from inventory.

**Fix**: 
- Key: `packaging:pallets:count`
- Computed from: `Math.ceil(casesNeeded / casesPerSkid)` (or `skidsCompleted` for actual)
- Deduct from inventory like other packaging
- Lot-tracked by QC when pallets are staged

---

## Implementation Order

### Phase 1: Fix Core Consumption (A + B + D)
1. Use actual cases instead of planned in `findExpectedConsumptionForRun`
2. Overproduction inventory deduction at surplus confirm
3. Mix/prep mix inventory deduction at mix-made confirm

### Phase 2: Fix Double-Counting (C)
4. Freezer pull → inventory deduction

### Phase 3: Fix Packaging Gaps (E)
5. Labeled runs: deduct circles, shippers, labels
6. Grip sheets consumption
7. Skid stacking materials
8. Film/wrap/tape (configurable supplies)
9. Pallets consumption

### Phase 4: Waste & Returns (from gap analysis)
10. Waste/spoilage logging
11. Stoppages mid-run waste
12. Ingredient returns at run-end

---

## Key Code References

| File | Change |
|------|--------|
| `lib/inventory-math/src/index.ts:278` | `computeRunLines` — extend for packaging modes |
| `lib/inventory-math/src/index.ts:393` | `computeRunConsumptionLines` — wrapper |
| `artifacts/api-server/src/routes/inventory.ts:1311` | `findExpectedConsumptionForRun` — use actual cases |
| `artifacts/api-server/src/routes/inventory.ts:1560` | `POST /inventory/consume` — already has the draw-down |
| `artifacts/api-server/src/routes/inventoryLogic.ts` | `applyRunConsumption` — draw-down engine (reuse) |
| `artifacts/run-calculator/src/freezerSurplus.ts` | Freezer surplus logic (extend for inventory sync) |
| `lib/freezer-pull/src/surplus.ts` | Surplus math (extend) |
| `artifacts/run-calculator/src/components/FreezerSurplusPanel.tsx` | Surplus UI (add inventory deduction) |
| `artifacts/run-calculator/src/components/MixAlreadyMadeInput.tsx` | Already-made input (add inventory deduction) |
| `artifacts/run-calculator/src/types.ts` | Form values (add slip sheets, tape, glue, ink, shipper labels) |
| `artifacts/run-calculator/src/pages/home.tsx:1055` | `aggregatePackagingNeeds` — extend for full packaging list |
| `artifacts/run-calculator/src/departments/QcDepartment.tsx` | QC lot tracking ties to packaging consumption |

## New Database Tables
None — all changes extend existing tables and consumption logic.

## API Changes
- `POST /inventory/consume` — extend to accept actual cases + full packaging list
- `POST /api/freezer-surplus/allocate` — add inventory deduction side-effect
- New: `POST /inventory/consume-mix` — deduct mix ingredients
- New: `POST /inventory/consume-overproduction` — deduct overproduction ingredients
- Lot tracking integration: packaging deductions carry lot numbers from QC entries
