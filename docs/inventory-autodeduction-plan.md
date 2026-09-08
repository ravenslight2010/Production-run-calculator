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

### Gap E1: Labeled Runs Don't Consume Packaging
**Problem**: `computeRunLines` only deducts circles, shippers, and cartons for `cartoned` runs. `labeled` runs are excluded — but they still physically use circles and shippers. The warehouse needs roll-up (`aggregatePackagingNeeds`) shows labels for labeled runs but inventory never deducts them.

**Fix**: Extend `computeRunLines` to handle all three packaging modes:

| Mode | Circles | Shippers | Cartons | Labels |
|------|---------|----------|---------|--------|
| `cartoned` | ✓ deduct | ✓ deduct | ✓ deduct | ✗ (none needed) |
| `labeled` | ✓ deduct | ✓ deduct | ✗ | ✓ deduct (rolls) |
| `n-a` | ✗ | ✗ | ✗ | ✗ |

**Implementation**:
- Move circles/shippers deduction OUTSIDE the `cartoned` gate — they apply to both `cartoned` and `labeled` runs
- Add label roll deduction for `labeled` runs: `packaging:labels:rolls` or `packaging:labels:top` / `packaging:labels:bottom`
- Keep `n-a` as zero-consumption

### Gap E2: Grip Sheets Not Tracked
**Problem**: `gripSheets` is a per-run packaging option ("none", "every other layer", "3rd and 5th") but never appears in consumption lines or inventory.

**Fix**: Add grip sheet consumption to `computeRunLines`:
- If `gripSheets !== "none"` → compute number of grip sheets needed based on skid layers
- Key: `packaging:gripSheets:{type}`, unit: `sheets`
- Requires: `casesPerSkid`, `casesPerLayer` to compute layer count

### Gap E3: Skid Stacking Materials Not Tracked
**Problem**: `skidStacking` ("lucia", "hannaford", "column") is a packaging option but never tracked.

**Fix**: If skid stacking requires specific materials (bands, stretch wrap), add as consumption line:
- Key: `packaging:skidStacking:{type}`, unit: `skids`
- Computed from: `skidsCompleted` or `Math.ceil(casesNeeded / casesPerSkid)`

### Gap E4: Film / Wrap / Tape (Common Supplies)
**Problem**: Stretch wrap, tape, and film are commonly used in packaging but don't exist in the system at all — no form field, no consumption line.

**Fix**: These are typically "supplies" rather than per-run items. Options:
- **Simple**: Add a general "packaging supplies" consumption line per run (e.g., 1 roll of stretch wrap per N skids)
- **Better**: Add `film`, `tape`, `stretchWrap` as configurable packaging options in Setup → Packaging Settings, with per-skid or per-run quantities

### Gap E5: Pallets / Skids
**Problem**: `casesPerSkid` and `skidsCompleted` are tracked but pallets themselves are never consumed from inventory.

**Fix**: If pallets are tracked as inventory items:
- Key: `packaging:pallets:count`
- Computed from: `Math.ceil(casesNeeded / casesPerSkid)` (or `skidsCompleted` for actual)
- Deduct from inventory like other packaging

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
| `artifacts/run-calculator/src/types.ts` | Form values (add grip sheets, film, etc.) |

## New Database Tables
None — all changes extend existing tables and consumption logic.

## API Changes
- `POST /inventory/consume` — extend to accept actual cases
- `POST /api/freezer-surplus/allocate` — add inventory deduction side-effect
- New: `POST /inventory/consume-mix` — deduct mix ingredients
- New: `POST /inventory/consume-overproduction` — deduct overproduction ingredients
