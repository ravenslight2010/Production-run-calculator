# Inventory Auto-Deduction — Comprehensive Plan

**Status:** Core physical-event accounting is implemented; remaining work is bounded verification, final-total reconciliation, and approved waste/return flows
**Updated:** 2026-10-08
**Related:** [Idea backlog](idea-backlog.md#4-inventory-system-gap-fixes), [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md)

**Authority rule:** each physical inventory event uses one server-authoritative, idempotent transaction. Do not add an independent client-side stock mutation path.

## Authority decisions

- **Completed cases:** the server-persisted run register's `actualCases` is the production quantity used for final run consumption. When it is absent or zero, planned cases remain the backward-compatible basis. The run-level claim freezes the first accepted deduction.
- **Eligible production stock:** automatic ingredient and packaging consumption draws only from the scope's location marked `isOnsite`; legacy lots with no location are treated as onsite. Offsite and freezer stock are excluded.
- **Confirmed finished-case surplus:** run consumption already charges all ingredients and packaging for `actualCases`, including excess cases. Surplus confirmation creates the freezer finished-case asset only; it never charges ingredients again.
- **Freezer reuse:** allocation reduces or moves the finished-case freezer asset. It does not consume the underlying ingredients a second time.
- **Prep mix and already-made mix:** the day-start event charges components for fresh mix actually made. `amountAlreadyMade` reduces fresh production and therefore does not trigger a second component charge.
- **Packaging:** packaging lines are part of the same completed-run consumption event and use the same actual-case scale and onsite drawdown.

## Current reconciliation (2026-10-08)

The status and priorities below supersede the implementation-status snapshot in the older proposal sections that follow.

| Area | Current status | Evidence / remaining work |
|---|---|---|
| Actual-case run consumption | **Implemented in source; verification partial** | Server uses persisted `actualCases` when positive, with planned-value fallback; focused integration coverage for the scaled quantity was not located. |
| Mix/prep-mix and surplus | **Implemented for recorded day-start events** | `inventory.integration.test.ts` covers idempotent drawdown, rollback/retry, and surplus creation; broader reconciliation remains. |
| Freezer pull | **Core path implemented; parity coverage partial** | Server allocation updates the dated surplus and finished-case inventory. Existing tests cover allocation idempotency and generic location transfers; add combined balance/stock assertions. |
| Packaging | **Formula paths implemented; verification partial** | `computeRunLines` covers package lines and `computeDailySupplyConsumptionLines` covers daily supplies; focused tests do not assert every item/mode combination. |
| Waste, stoppage loss, returns, accepted final total | **Open** | Define the physical event, accepted quantity, correction, and audit rules before adding stock mutations. |
| QC packaging lots | **Gated** | Depends on approved QC lot/check scope. |

In particular, surplus confirmation creates a finished-case asset and does **not** trigger a second ingredient deduction. Use this reconciliation and the current source/tests—not the older proposal wording below—as the implementation guide.

## Idempotent physical events

| Physical event | Stable identity | Server effect |
|---|---|---|
| Completed run, including confirmed excess production | Run ID | Scale all run ingredient and packaging lines to authoritative actual cases, lock onsite lots, append stock ledger rows |
| Day-start prep/fresh mix and daily supplies | Production date | Lock mix rows and onsite lots, update mix carry/surplus, append stock ledger rows |
| Already-made mix reuse | Existing mix surplus allocation/carry | Reduce fresh mix need only; no new component charge |
| Finished-case surplus confirmation | Surplus lot ID | Create the dated freezer asset and matching freezer inventory lot; no ingredient charge |
| Finished-case freezer allocation | Run and surplus lot identity | Reduce freezer finished-case stock only; no ingredient charge |
| Sauce auto-track consumption | Run and sauce event identity | Lock onsite lots and append stock ledger rows atomically with accepted progress |

The idempotency claim, stock locks, quantity updates, surplus/carry updates, and ledger rows commit or roll back together. A failed attempt leaves no claim, so a retry can safely apply the event once.

## Historical problem statement (superseded by 2026-10-08 reconciliation)
Inventory consumption is a **single-point event** at run-end, computed from the **planned** `casesNeeded`. Multiple production activities that consume ingredients or packaging are not reflected in inventory. This causes inventory to drift from reality over time.

---

## A. Historical overproduction proposal (superseded by actual-case run consumption)

**Current status**: Actual-case run consumption and freezer surplus asset paths exist; see the current reconciliation above. The steps below are a superseded proposal.
**Historical problem (resolved)**: Earlier, excess-case ingredients were not deducted when actual production exceeded the planned target.

**Historical proposal trigger**: Surplus confirmation at run end. Current deduction happens during run consumption using persisted `actualCases`, not at surplus confirmation.

**Original proposal steps (superseded)**:
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

**Current invariant**: Ingredients and packaging are charged once in the run-consumption event. Surplus confirmation and later allocation create/update finished-case assets and do not charge ingredients again.

---

## B. Mix / Prep Mix Deduction (current day-start path; historical run-end proposal follows)

**Status**: Built for recorded day-start events; see the current reconciliation above.

**What**: When prep mixes are made, the component ingredients need to be accounted for. Also, leftover ("Already Made") mix needs to offset future deductions without double-charging.

**Two scenarios**:

### B1. Already Made (pre-made mix from a prior run)

"Already Made" = **offset** to the current run's fresh mix need. It is NOT a deduction trigger.

```
freshMixNeeded = plannedMixNeed - alreadyMade
```

The ingredients for "Already Made" were already deducted when the mix was originally made. No new ingredient charge.

**UI**: When "Already Made" is entered for a mix slot, the system adjusts the deduction to only cover `freshMixNeeded`. If `alreadyMade > plannedMixNeed`, `freshMixNeeded = 0` (no fresh mix made).

### B2. Historical run-end overproduction proposal (not current implementation guidance)

Current reconciliation evidence covers recorded day-start mix production and surplus. Do not assume the per-run "Actual Made" field and run-end deduction steps below are implemented.

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

**Status**: Core server path built; direct parity-test coverage is partial.

**Current behavior**: Allocation updates the dated freezer surplus lot/allocation and the finished-case inventory stock. Replacing or releasing an allocation restores the prior quantity before applying the new selection.

**Key invariant**: This changes finished-case stock/allocation only; it does not deduct the underlying ingredients again. Existing API tests cover allocation idempotency and over-allocation. Add assertions that surplus balance and finished-case inventory remain in parity through confirm, replacement, and release.

---

## D. Actual cases instead of planned (source path implemented; verification partial)

**Status**: Source implementation exists; direct actual-case scaling coverage was not located.

**Current behavior**: At `POST /inventory/consume`, the server reads the run's persisted `actualCases`. When it is positive and differs from `casesNeeded`, all consumption lines are scaled by `actualCases / casesNeeded`. If `actualCases` is absent or zero, planned cases remain the backward-compatible basis.

**Evidence gap**: Existing integration tests cover server-authoritative finalization and idempotency, but do not directly assert the scaled quantity for `actualCases`. Add that focused regression before marking this behavior fully verified.

---

## E. Full packaging consumption (formula paths exist; tests partial)

**Status**: Formula paths exist; direct test coverage is partial.

**Evidence gap**: The formula paths include circles, shippers, cartons, slip/grip sheets, labels, pallets, shipper labels, and daily supplies. Focused tests do not yet assert every item and supported packaging mode.

### E1. Carton Size

`cartonSize` is already part of the form/profile input used by the packaging calculation:
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

## Historical implementation order (superseded by 2026-10-08 reconciliation)

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
