# Inventory Auto-Deduction — Comprehensive Plan (Updated 2026-09-09)

## The Core Problem
Inventory consumption is a **single-point event** at run-end, computed from the **planned** `casesNeeded`. Multiple production activities that consume ingredients or packaging are not reflected in inventory. This causes inventory to drift from reality over time.

---

## A. Overproduction Inventory Deduction (Critical)

**Status**: Not yet built
**Owner**: Replit (working on AI right now)

**What**: When actual production exceeds the planned target, extra ingredients are consumed but not deducted.

**When**: At surplus confirmation moment (end of run, manager confirms extra cases).

**How it works**:
1. Run ends with `casesCompleted` > `casesNeeded`
2. Surplus panel appears: "You have X extra cases. Store in freezer?"
3. Manager confirms surplus
4. Server computes extra ingredient consumption for the overproduced cases:
   ```
   excessQty = actualQty × (casesCompleted - casesNeeded) / casesNeeded
   ```
   (Using the scaled proportion from Feature D — actual vs. planned.)
5. Deducts the extra ingredients from inventory (onsite location lots only)
6. Creates ledger entries: type "consume", note "Overproduction: {X} cases → deducted {qty} {item}"

**Key invariant**: Surplus cases become a **freezer surplus asset** (not re-deducted when reused). The overproduction deduction is the only time those ingredients are charged.

---

## B. Mix / Prep Mix Deduction (Critical)

**Status**: Not yet built

**What**: When prep mixes are made, the component ingredients need to be accounted for. Also, leftover ("Already Made") mix needs to offset future deductions without double-charging.

**Two scenarios**:

### B1. Already Made (pre-made mix from a prior run)

"Already Made" = **offset** to the current run's fresh mix need. It is NOT a deduction trigger.

```
freshMixNeeded = plannedMixNeed - alreadyMade
```

The ingredients for "Already Made" were already deducted at the time the mix was originally made (overproduction of mix in a prior run — see B2). No new ingredient charge.

**UI**: When "Already Made" is entered for a mix slot, the system adjusts the deduction to only cover `freshMixNeeded`. If `alreadyMade > plannedMixNeed`, `freshMixNeeded = 0` (no fresh mix made).

### B2. Overproduction of Mix (made more than needed)

Similar to Feature A but for mixes specifically.

**When**: At run end, if the mixer reports "actual made" > "planned needed".

**UI**: The mix plan has an optional "Actual Made" field per mix slot.
- If left blank: assume actual = planned (no overproduction deduction)
- If entered and > planned: deduct the extra ingredient amounts

**Example**:
- Run 1: need 100 lbs mix, made 120 lbs, 25 lbs leftover
- Run 1 overproduction: 20 lbs extra → deduct ingredient proportions for 20 lbs
- 25 lbs leftover → tracked as surplus mix asset in freezer
- Run 2: "Already Made: 25 lbs" → fresh mix needed = 100 - 25 = 75 lbs → deduct for 75 lbs

**Surplus mix tracking**: When leftover mix exists after a run, store it in the freezer as a surplus asset with a reminder: "You have 25 lbs of {mix name} in the freezer."

---

## C. Freezer Pull → Inventory Sync (Medium)

**Status**: Not yet built

**Problem**: When warehouse pulls items from the freezer for a run, the pull is tracked in the freezer surplus system but doesn't move inventory lots. This causes double-counting — the same stock appears in both inventory and freezer surplus.

**When**: At allocation confirmation in `FreezerSurplusPanel`.

**How it works**:
1. Manager confirms "Use on Next Run" in the freezer surplus panel
2. Server deducts the allocated cases from the **freezer location's** inventory lots (not onsite)
3. Creates ledger entry: type "transfer", note "freezer pull for run {id}"
4. The freezer surplus system tracks the allocation — inventory just moves the lot location

**Key invariant**: This is a **lot movement only**, not an ingredient deduction. The surplus cases were already paid for at overproduction time (Feature A). No ingredient charge happens here.

---

## D. Actual Cases Instead of Planned (Medium)

**Status**: Not yet built

**Problem**: `findExpectedConsumptionForRun` reads the planned `casesNeeded` from form values. When actual production differs, inventory is wrong.

**When**: At run end, during the `POST /inventory/consume` call.

**How it works**:
1. Read `casesCompleted` from the run's stored values
2. If `casesCompleted > 0` AND `casesCompleted ≠ casesNeeded`:
   - Compute scale factor: `scale = casesCompleted / casesNeeded`
   - Apply to ALL consumption lines: `actualQty = plannedQty × scale`
3. If `casesCompleted = 0` or missing: use planned values (backward-compatible)

**Scale applies to**: every ingredient and packaging line — dough, sauce, applicators, pepperoni, circles, shippers, cartons, labels, pallets, etc. No exceptions.

---

## E. Full Packaging Consumption (Medium)

**Status**: Not yet built

**Problem**: Only circles, shippers, and cartons are consumed from inventory. All other packaging items (slip sheets, grip sheets, labels, pallets, tape, glue, ink, shipper labels) are missing.

### E1. New Profile Field: Carton Size

Add `cartonSize` to FormValues and the packaging profile:
- "single" (default) = 1 pizza per carton
- "double" = 2 pizzas per carton
- "triple" = 3 pizzas per carton

**Carton consumption** (revised):
```
cartonsPerSkid = casesPerSkid × cartonSize × cartonsPerCase
casesOfCartons = ceil(totalPizzas / (cartonSize × cartonsPerCase))
```

Key: `packaging:cartons:cases` (unchanged key, new quantity)

### E2. Slip Sheets

- When `slipSheets = "yes"`: 1 slip sheet per layer
- `layers = totalCases / casesPerLayer`
- Key: `packaging:slip-sheets:count`
- Unit: count

### E3. Grip Sheets

Per skid, based on `gripSheets` setting:
- "none" = 0
- "every other layer" = `ceil(layersPerSkkid / 2)` per skid
  - `layersPerSkkid = casesPerSkkid / casesPerLayer`
- "3rd and 5th" = exactly 2 per skid
- Total = perSkkid × `ceil(totalCases / casesPerSkkid)`

Key: `packaging:grip-sheets:count`
Unit: count

### E4. Labels

- Depends on `labelPosition` and `labelsPerRoll`
- If `labelPosition = "top"`: 1 label per pizza
- If `labelPosition = "bottom"`: 1 label per pizza
- If `labelPosition = "both"`: 2 labels per pizza (1 top + 1 bottom)
- Rolls consumed = `totalPizzas × labelMultiplier / labelsPerRoll`
  - `labelMultiplier = labelPosition === "both" ? 2 : 1`
- Key: `packaging:labels:{position}` (position = top/bottom/both)
- Unit: rolls

### E5. Pallets

- `pallets = ceil(totalCases / casesPerSkid)`
- Key: `packaging:pallets:count`
- Unit: count

### E6. Shipper Labels

- 1 per case
- `shipperLabels = totalCases`
- Key: `packaging:shipper-labels:count`
- Unit: count

### E7. Daily Reset Supplies (Tape, Glue, Ink)

Deducted at daily reset for that day's production runs (not per-run).

| Item | Rate | Calculation | Key |
|------|------|-------------|-----|
| Tape | 4 per day | 4 | `packaging:tape:count` |
| Glue/glue sticks | ~1 per 3.5 days | 1/3.5 ≈ 0.286 per day | `packaging:glue:count` |
| Ink | ~1 per month | 1/(4.3 × 3) ≈ 0.078 per day | `packaging:ink:count` |

**Trigger**: Daily reset function (`POST /reset-day`) or app load after midnight.
**Scaling**: Rates are per production day. If multiple runs happen, these are consumed once per day (not per run).
**Ink special case**: One pizza is dated without carton — but ink consumption is so small (0.078/day) that the per-day rate covers this without separate tracking.

---

## F. Daily Reset: Yesterday → Today

**Status**: Already partially implemented

**What happens at daily reset**:
1. Yesterday's completed runs are archived (or saved for QC audit trail)
2. Day-state resets for today
3. Tape/glue/ink deducted from inventory for today's production day
4. Surplus mix from yesterday shows as "Available in Freezer" reminder
5. QC-related items preserved for audit (lot tracking, weights, etc.)

---

## Implementation Order

### Phase 1: Core Consumption Fixes (A + D)
1. Extend `findExpectedConsumptionForRun` to use actual cases (D)
2. Add overproduction ingredient deduction at surplus confirmation (A)

### Phase 2: Mix Deduction (B)
3. Add "Already Made" offset logic to mix consumption
4. Add optional "actual made" field to mix plan
5. Track surplus mix in freezer with reminder

### Phase 3: Freezer Pull Sync (C)
6. Extend freezer surplus allocation to deduct from freezer location inventory
7. Validate no double-counting with overproduction deduction

### Phase 4: Packaging Completion (E)
8. Add `cartonSize` field to FormValues and profiles
9. Add slip sheets, grip sheets, labels, pallets, shipper labels to `computeRunLines`
10. Add tape/glue/ink daily reset deductions
11. Update warehouse needs roll-up to show all packaging items

---

## Key Code References

| File | Change |
|------|--------|
| `lib/inventory-math/src/index.ts:278` | `computeRunLines` — extend for full packaging |
| `lib/inventory-math/src/index.ts:88` | `RunLinesInput` — add cartonSize, slipSheets, gripSheets, etc. |
| `artifacts/api-server/src/routes/inventory.ts:1311` | `findExpectedConsumptionForRun` — use actual cases |
| `artifacts/api-server/src/routes/inventory.ts:1560` | `POST /inventory/consume` — extend for full packaging |
| `artifacts/api-server/src/routes/inventoryLogic.ts` | `applyRunConsumption` — draw-down engine (reuse) |
| `artifacts/run-calculator/src/types.ts` | FormValues — add cartonSize, slipSheets, gripSheets fields |
| `artifacts/run-calculator/src/freezerSurplus.ts` | Freezer surplus logic — extend for inventory sync |
| `lib/freezer-pull/src/surplus.ts` | Surplus math — extend for inventory sync |
| `artifacts/run-calculator/src/components/FreezerSurplusPanel.tsx` | Surplus UI — add inventory deduction |
| `artifacts/run-calculator/src/warehouseGrouping.ts` | Warehouse needs — show all packaging items |
| `artifacts/api-server/src/routes/reset-day.ts` | Daily reset — add tape/glue/ink deduction |

## New Database Fields
- `cartonSize` in FormValues (single/double/triple) — schema-free (JSON payload in form values)

## API Changes
- `POST /inventory/consume` — accept actual cases, scale all lines proportionally
- `POST /inventory/consume-overproduction` — deduct extra ingredients at surplus confirm
- `POST /api/freezer-surplus/allocate` — add lot movement (not ingredient deduction)
- Daily reset endpoint — deduct tape/glue/ink for the production day
