# QC Department — Comprehensive Plan

## Current State
- **Existing tabs**: Quality (photo checks), Incidents, Downtime Trends
- **Inventory lot tracking**: Basic — lot number field on inventory items, no workflow enforcement
- **No**: weight checks, component checks, shipper label verification, date verification, lot traceability per station, QC-specific dashboards

---

## QC Department Structure

### 1. Lot Tracking (Enhanced)
**What exists**: Simple lot number text field on inventory batches
**What's needed**:
- Per-station lot logging (every ingredient used gets its lot recorded against the current run)
- Lot → run traceability (which lot was used on which run, which brand/flavor)
- Lot → ingredient → recipe chain (full backward traceability)
- Lot expiry alerts (cross-reference with inventory expiration dates)
- One-tap lot scan input (barcode-ready text field)

**Data model additions**:
- `run_lots` table: run_id, ingredient_name, lot_number, station (dough/sauce/frontline/warehouse), recorded_by, recorded_at
- Links to existing `inventory_batches` table

### 2. Weight Checks
**What exists**: Nothing — manual clipboard process
**What's needed**:
- Pre-run weight verification (before run starts, QC records expected vs actual weights for key ingredients)
- Periodic weight checks (every 30 min during run, QC records current weights)
- Auto-calculated tolerance bands (flag if weight drifts beyond ±X% of expected)
- Dashboard showing weight trend over time (visual graph)
- One-tap check-in (quick form: ingredient, expected weight, actual weight, pass/fail)

**Data model additions**:
- `weight_checks` table: run_id, ingredient_name, expected_weight, actual_weight, unit, tolerance_pct, pass_fail, checked_by, checked_at, check_number (0=pre-run, 1=30min, 2=60min, etc.)

### 3. Component Checks
**What exists**: Nothing
**What's needed**:
- Once-per-run verification of all components (dough, sauce, cheese, apps, pepperoni)
- Checklist per component (visual pass/fail with photo option)
- Linked to current run
-历史 history view (what was checked, when, any failures)

**Data model additions**:
- `component_checks` table: run_id, component_type (dough/sauce/cheese/app1-4/pep1-2), check_item (weight/color/smell/texture/label), status (pass/fail/na), notes, photo_url, checked_by, checked_at

### 4. Import Source Management
**What exists**: Import system (spec, premix, cheese, shipping) — QC is described as "primary source"
**What's needed**:
- QC-owned import queue (pending imports awaiting QC verification)
- QC sign-off on imported data (approve/reject with comments)
- Import audit trail (who imported, when, QC approved/rejected)
- QC-specific import view (filtered to items needing attention)

**No new tables needed** — extend existing import metadata with QC approval status

### 5. Shipper Label Verification
**What exists**: Nothing
**What's needed**:
- Label check workflow (QC scans/enters shipper label info)
- Compare label against expected (brand, flavor, lot, date, weight)
- Pass/fail with reason codes
- Photo capture of label
- History of label checks per run

**Data model additions**:
- `label_checks` table: run_id, shipper_id, label_field (brand/flavor/lot/date/weight/ingredients), expected_value, actual_value, status (pass/fail), photo_url, checked_by, checked_at

### 6. Date Verification
**What exists**: Nothing specific
**What's needed**:
- Pizza/carton date code verification (production date, best-by date)
- Compare printed dates against expected dates
- Flag date mismatches
- One-tap check per carton/batch

**Data model additions**:
- `date_checks` table: run_id, product_type (pizza/carton), batch_id, expected_prod_date, expected_bestby_date, actual_prod_date, actual_bestby_date, status, checked_by, checked_at

### 7. Recipe & Future Planning
**What exists**: Setup tab has recipe editors (dough, sauce, frontline), brand/flavor management
**What's needed**:
- QC-owned recipe approval workflow (new recipes require QC sign-off)
- Future brand/flavor planning view (upcoming brands, planned flavors, ingredient requirements)
- Recipe change tracking (what changed, when, who approved)
- Ingredient requirement calculator for planned recipes

**This overlaps heavily with existing Setup tab** — may be better as a sub-section rather than separate UI

### 8. QC Dashboard
**What exists**: QualityHistoryTab (photo checks only)
**What's needed**:
- At-a-glance QC status for current run (all checks pending/passed/failed)
- Checklist completion tracker (lot tracking ✓, weight checks 2/5, component checks 0/8, etc.)
- Alert panel (overdue checks, failed checks, expiring lots)
- Shift summary (what was checked, what failed, what's pending)

---

## Recommended Build Order

### Phase 1: Foundation (highest impact)
1. **QC role/permissions** — add "qc" role to StaffRolesCard, gate QC features behind it
2. **Lot tracking per run** — `run_lots` table + per-station lot input UI
3. **Weight checks** — `weight_checks` table + pre-run/periodic check forms
4. **QC dashboard** — single screen showing all QC status for current run

### Phase 2: Verification Workflows
5. **Component checks** — checklist form per run
6. **Label verification** — shipper label check form
7. **Date verification** — date code check form

### Phase 3: Integration & Planning
8. **Import approval queue** — QC sign-off on imports
9. **Recipe approval** — QC gate on recipe changes
10. **Future planning view** — upcoming brands/flavors calendar

### Phase 4: Intelligence
11. **Weight trend graphs** — chart weight drift over time
12. **Lot traceability report** — full chain from lot → run → customer
13. **QC analytics** — pass/fail rates, common failures, trends

---

## Key Code References
| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/departments/QcDepartment.tsx` | QC department boundary (exists, thin) |
| `artifacts/run-calculator/src/components/QualityHistoryTab.tsx` | Photo quality checks (exists) |
| `artifacts/run-calculator/src/components/InventoryTab.tsx` | Lot tracking (basic, exists) |
| `artifacts/run-calculator/src/components/StaffRolesCard.tsx` | Role management (needs "qc" role) |
| `artifacts/run-calculator/src/departments/DepartmentBoundary.tsx` | Department routing |
| `artifacts/run-calculator/src/hooks/useHomeNavigation.ts` | Tab definitions |
| `lib/db/src/schema/inventory.ts` | Inventory schema (has lot field) |
| `artifacts/run-calculator/src/pages/home.tsx` | Main app (tab rendering) |

## Database Tables to Add
1. `run_lots` — per-run, per-station ingredient lot logging
2. `weight_checks` — pre-run and periodic weight verification
3. `component_checks` — once-per-run component verification
4. `label_checks` — shipper label verification
5. `date_checks` — pizza/carton date code verification
6. `qc_checklists` — overall checklist state per run (computed from above)

## UI Components to Create
1. `QcDashboard.tsx` — main QC status screen
2. `LotTrackingForm.tsx` — quick lot entry per station
3. `WeightCheckForm.tsx` — weight check entry
4. `ComponentCheckForm.tsx` — component checklist
5. `LabelCheckForm.tsx` — shipper label verification
6. `DateCheckForm.tsx` — date code verification
7. `QcHistoryView.tsx` — historical QC data (extends existing QualityHistoryTab)
8. `FuturePlanningView.tsx` — upcoming brands/flavors/recipes

## API Routes to Add
1. `POST /api/run-lots` — log a lot for a run
2. `GET /api/run-lots?runId=X` — get lots for a run
3. `POST /api/weight-checks` — record a weight check
4. `GET /api/weight-checks?runId=X` — get weight checks for a run
5. `POST /api/component-checks` — record component check
6. `POST /api/label-checks` — record label check
7. `POST /api/date-checks` — record date check
8. `GET /api/qc/dashboard?runId=X` — aggregated QC status
9. `PUT /api/import-approval/:id` — approve/reject import
