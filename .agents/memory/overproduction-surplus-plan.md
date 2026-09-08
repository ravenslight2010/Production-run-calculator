# Overproduction & Surplus Management Plan

## Current State

### What Exists
| Feature | File | What It Does |
|---------|------|-------------|
| Freezer Surplus Confirm | `FreezerSurplusPanel.tsx` (packaging mode) | After run ends → record excess cases as freezer lot |
| Freezer Surplus Pull | `FreezerSurplusPanel.tsx` (warehouse mode) | Allocate freezer lots to upcoming runs (carry-in) |
| Surplus Ledger | `lib/freezer-pull/src/surplus.ts` | Lot + allocation math (brand/flavor matching, effective production) |
| Freezer Surplus DB | `lib/db/src/schema/freezerSurplus.ts` | Server-side lot/allocation persistence |
| Use First | `UseFirstCard.tsx` | Expiry-first lot prioritization |
| Reorder | `ReorderCard.tsx` | Stock reorder alerts |

### What's Missing

1. **Real-time overproduction detection** — only captured AFTER run ends
2. **Ingredient-level overages** — dough, sauce, cheese tracked separately from finished cases
3. **Decision flow** — no guided "what to do with excess" (store/donate/ship early/discard)
4. **Surplus history** — no trend analysis or pattern detection
5. **Cross-brand surplus** — no aggregate view across all brands/flavors
6. **Packaging waste** — overproduced cases may have wasted packaging
7. **Auto-alerts** — no notification when overproduction happens repeatedly
8. **Surplus targets** — no configurable acceptable overproduction threshold

---

## Proposed System

### 1. Real-Time Overproduction Detection
**Trigger**: During a run, when `casesCompleted` exceeds `casesNeeded` by more than a configurable threshold.

**How it works**:
- Live calc already tracks `calc.casesCompleted` vs `v.casesNeeded`
- Add an overproduction threshold field (default: 0 cases — any excess triggers)
- When threshold is exceeded:
  - Show alert banner on Run tab: "Overproduction detected: X cases over target"
  - Log the event to a new `overproduction_events` table
  - Notify packaging to start a new lot/bin for excess

**Data model**:
```
overproduction_events {
  id, scope, run_id, brand, flavor,
  target_cases, actual_cases, excess_cases,
  excess_type (finished_cases | dough | sauce | cheese | packaging),
  detected_at (server time), detected_by,
  disposition (pending | stored | donated | shipped_early | discarded),
  disposition_at, disposition_by, disposition_notes,
  created_at
}
```

### 2. Ingredient-Level Overage Tracking
**What it tracks**: Overages at each station, not just finished cases.

| Station | What Counts as Over | Where It Goes |
|---------|-------------------|---------------|
| Dough | Extra dough balls/trays produced | Dough waste log or next-run supply |
| Sauce | Extra barrels made | Sauce surplus (use on next run or waste) |
| Cheese/Apps | Extra batches made | Ingredient surplus log |
| Freezer | Cases exceeding target | Existing freezer surplus system |
| Packaging | Extra boxes/labels used | Packaging waste log |

**Implementation**: Extend the existing run-values form with "actual produced" fields per station, compare against "planned needed."

### 3. Disposition Decision Flow
When overproduction is detected, guide the user through a decision:

```
Overproduction detected →
├── Store in Freezer → allocate to freezer surplus lot (existing flow)
├── Ship Early → mark as shippable, add to next shipment
├── Donate → log donation (quantity, recipient, date)
├── Use on Next Run → pre-allocate to next run of same brand/flavor
├── Discard → log waste (quantity, reason, approved by)
└── Other → free-text disposition
```

Each disposition is audit-logged (who, when, why) and feeds into the surplus history.

### 4. Surplus Dashboard
A new view (inside Warehouse tab or QC department) showing:

**Today's Surplus**:
- Total excess cases across all runs today
- Breakdown by brand/flavor
- Disposition status (stored / pending / donated / discarded)

**Surplus History**:
- Calendar view of past surplus events
- Trend chart: overproduction by week/month
- Top overproduced brands/flavors
- Waste % trend (excess / total produced)

**Surplus Alerts**:
- Same brand/flavor overproduced 3+ times in 30 days → flag for review
- Total surplus exceeds X% of daily production → alert
- Freezer capacity approaching limit → alert

### 5. Configurable Thresholds
Manager settings for overproduction tolerance:
- `overproduction_threshold_cases` — alert when excess exceeds this (default: 0)
- `overproduction_alert_frequency` — how often to re-alert (default: once per run)
- `surplus_capacity_limit` — max freezer cases before alert (optional)
- `auto_disposition_rules` — auto-assign disposition based on brand/flavor/quantity

---

## Build Order

### Phase 1: Detection & Logging
1. Add `overproduction_threshold_cases` to run settings/form
2. Add real-time alert banner when threshold exceeded
3. Create `overproduction_events` table (DB schema + API)
4. Log overproduction events (server-side, audit-tracked)
5. Extend existing `FreezerSurplusPanel` to auto-suggest disposition

### Phase 2: Disposition Flow
6. Add disposition form (store/donate/ship/discard/use-next)
7. Audit-log all dispositions
8. Add disposition to overproduction event detail view
9. Wire donation/discard to inventory adjustments

### Phase 3: Dashboard & History
10. Surplus dashboard card (today's surplus + recent history)
11. Trend chart (overproduction over time)
12. Surplus alerts (repeated overproduction, capacity limits)
13. Top overproduced brands/flavors report

### Phase 4: Intelligence
14. Auto-detection patterns (same brand/flavor recurring)
15. Predictive thresholds (adjust based on history)
16. Waste cost calculation (packaging + ingredient cost of excess)
17. Surplus optimization suggestions (reduce target for repeat offenders)

---

## Key Code References
| File | Purpose |
|------|---------|
| `lib/freezer-pull/src/surplus.ts` | Surplus math (extend) |
| `artifacts/run-calculator/src/freezerSurplus.ts` | Client surplus logic (extend) |
| `artifacts/run-calculator/src/components/FreezerSurplusPanel.tsx` | Surplus UI (extend) |
| `artifacts/run-calculator/src/components/UseFirstCard.tsx` | Expiry-first (keep) |
| `artifacts/run-calculator/src/components/ReorderCard.tsx` | Reorder alerts (keep) |
| `lib/db/src/schema/freezerSurplus.ts` | Freezer surplus DB (extend) |
| `lib/live-calc/src/index.ts` | Calc engine (add overproduction detection) |
| `artifacts/run-calculator/src/pages/home.tsx` | Run tab (add overproduction alert) |
| `artifacts/run-calculator/src/types.ts` | Form values (add threshold field) |

## New Database Tables (1)
- `overproduction_events` — immutable log of all overproduction incidents + dispositions

## API Routes to Add (6)
1. `POST /api/overproduction/log` — log an overproduction event
2. `PUT /api/overproduction/:id/dispose` — record disposition
3. `GET /api/overproduction?from=&to=&brand=&flavor=` — query overproduction history
4. `GET /api/overproduction/dashboard` — aggregated surplus stats
5. `GET /api/overproduction/alerts` — active overproduction alerts
6. `GET /api/overproduction/trends` — trend data for charts
