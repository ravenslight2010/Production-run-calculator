# Multi-Day Lookahead Dashboard — Plan

## Current State

| Feature | File | What It Does |
|---------|------|-------------|
| Production schedule | `WarehouseTabContent.tsx` | Upcoming scheduled days with run counts |
| Freezer pull plan | `WarehouseTabContent.tsx` | What to pull per upcoming run (days-early) |
| Mix plan | `MixesTabContent.tsx` | What mixes to make for make-day |
| Reorder alerts | `ReorderCard.tsx` | Items below threshold after upcoming demand |
| Use-first | `UseFirstCard.tsx` | Expiring lots to use first |

### What's Missing
- No unified "next N days" view — warehouse, mixes, freezer, inventory are separate tabs
- No visual timeline of upcoming production
- No capacity/resource conflict detection (too many runs, not enough freezer space)
- No lookahead for ingredient availability (will we have enough dough/sauce/cheese for Thursday?)
- No lookahead for packaging availability
- No lookahead for staff coverage
- No "what to prep today" consolidated checklist for multiple days ahead

---

## Proposed System

### 1. Unified Lookahead Timeline
A single view showing the next 7 days:

```
MON       TUE       WED       THU       FRI
Run A     Run B     Run C     Run D     Run E         ← runs
120 cases 200 cases 95 cases  150 cases 180 cases    ← target
▶ Dough   ▶ Mix     ▶ Sauce   ▶ Dough   ▶ Packaging  ← prep needed
```

Each day card shows:
- Scheduled runs (brand, flavor, target cases)
- Ingredients prepping needed today for that run (days-early window)
- Mixes to make
- Freezer pulls
- Packaging needs

### 2. Conflict Detection
Cross-day warnings:
- **Freezer capacity**: sum of freezer-surplus lots + upcoming pull needs vs. capacity
- **Mix overload**: more mix demand in one make-day than feasible
- **Ingredient shortfall**: available inventory vs. upcoming run demand (already partly in ReorderCard, extend to multi-day)
- **Packaging shortfall**: same for packaging items
- **Staff overload**: if staff hours tracked, flag days with too many runs per staff

### 3. Ingredient Availability Lookahead
For each upcoming run, show ingredient availability status:
- ✅ Enough on hand for that run
- ⚠️ Will need restock before run date
- ❌ Not enough on hand — needs purchase

Run through the same `computeRunConsumptionLines` for future runs to project demand, subtract from current inventory.

### 4. Prepping Checklist (Consolidated)
A single "What to prep today" list combining:
- Warehouse staging items (for each run being staged today)
- Mixes to make today
- Freezer pulls due today
- Packaging staging

Instead of checking 4 separate tabs, one consolidated checklist with checkboxes.

### 5. Packaging Availability Lookahead
For each upcoming run, show packaging availability:
- Circles, shippers, cartons, labels, pallets, etc. (from full 13-item list)
- % of needed vs. on hand
- Restock alert if below threshold for the run date

### 6. Capacity Planning View
Filter by day to see:
- Total target cases per day (vs. line capacity)
- Expected runtime per day (from line speed)
- Available freezer space (surplus lots + capacity)
- Bottleneck identification (which day is most loaded)

---

## Build Order

### Phase 1: Unified Timeline
1. Next 7 days view (runs + target cases + prep needs per day)
2. Click into a day to see its detail
3. Consolidate existing warehouse/mixes/freezer into day cards

### Phase 2: Conflict Detection & Availability
4. Ingredient availability for upcoming runs
5. Packaging availability for upcoming runs
6. Freezer capacity warning

### Phase 3: Checklist & Planning
7. Consolidated "what to prep today" checklist
8. Capacity planning view
9. Staff coverage (if staff tracking added)

---

## Key Code References
| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/components/WarehouseTabContent.tsx` | Schedule + freezer pull (extend) |
| `artifacts/run-calculator/src/components/MixesTabContent.tsx` | Mix plan (extend) |
| `artifacts/run-calculator/src/components/ReorderCard.tsx` | Inventory reorder (extend to lookahead) |
| `artifacts/run-calculator/src/components/UseFirstCard.tsx` | Expiry prioritization (extend) |
| `lib/inventory-math/src/index.ts:393` | `computeRunConsumptionLines` (project future demand) |
| `artifacts/run-calculator/src/pages/home.tsx` | Tab routing |
| `artifacts/run-calculator/src/warehouseGrouping.ts` | Warehouse need grouping |
