# QC Department — Comprehensive Plan

## Critical Requirements

### Daily Reset: Archive Yesterday, Show Only Today
The daily reset (midnight day-state clear) is the natural cutoff point. QC data behavior:

- **Active QC Dashboard** — always shows ONLY today's checks (current run, today's weight checks, today's lot entries, today's component checks)
- **Yesterday's data is saved** — QC records from previous days remain in the database, untouched by the daily reset
- **History view** — one tap away from the active dashboard; browse any previous day, filter by date/ingredient/lot/station, export for audits
- **No clutter** — operators see only what matters RIGHT NOW on the active screen; historical data never pollutes the current view
- **The reset doesn't delete QC data** — it only clears day-state (runs, active operational data). QC tables are server-persisted and accumulate indefinitely

**UI pattern**:
```
QC Dashboard
├── Today (active)     ← default view, shows current run checks only
├── History            ← calendar/date picker, browse past days
│   ├── Sep 7 (yesterday) — 12 checks, 2 failures
│   ├── Sep 6 — 18 checks, 0 failures
│   └── ...
└── Audit Export       ← CSV/PDF for compliance
```

The daily reset is invisible to QC — the dashboard just naturally shows today because that's the default filter. Yesterday becomes "history" automatically at midnight.

### QC Data Survives All Wipes
The factory reset (`POST /sync/purge-all`) currently wipes ALL scoped tables including `qualityChecksTable`. QC data must survive both:
- **Daily reset** (day-state clear at midnight) — already safe since QC tables are server-side, not in day-state
- **Factory reset** (full purge-all) — QC tables must be **excluded** from the purge-all scopedTables list in `sync.ts` line ~1200, or moved to a separate audit DB/schema that the purge endpoint doesn't touch

**Implementation**: Add QC tables to a new `auditedTables` group in the purge endpoint that gets `ON DELETE DO NOTHING` or is simply skipped. The purge-all handler at `artifacts/api-server/src/routes/sync.ts:1198` explicitly lists every table — QC tables must NOT appear in that list.

### Full Audit Trail / Traceability / Accountability
Every QC operation must produce an immutable audit record:
- **Who** performed the action (user_id, username, role)
- **What** was checked (ingredient name, lot number, weight value, pass/fail)
- **When** (server-generated timestamp, not client)
- **Where** (station, run_id, line position)
- **Why** (if failed — reason code + free-text notes)
- **Evidence** (photo URL if captured)

QC audit records must be:
- Append-only (no UPDATE/DELETE allowed on audit rows)
- Retained indefinitely (not subject to any cleanup/purge)
- Queryable by any manager/supervisor for compliance review
- Exportable as CSV/PDF for external audits

**Implementation**:
- Each QC table gets `created_at` (server DEFAULT NOW()), `created_by` (user FK), `scope` (factory isolation)
- Add a `qc_audit_log` table that fires on INSERT to any QC table (PostgreSQL trigger or application-level)
- Audit log has its own retention policy: never deleted, ever
- API routes for audit export: `GET /api/qc/audit?from=&to=&type=&ingredient=`

## Current State
### Move All Existing QC Features into the QC Department

Currently QC features are scattered across the app. Everything below moves into the new QC department section:

| Current Location | Feature | Move To |
|-----------------|---------|---------|
| Bottom bar `quality` tab | `QcQualitySurface` (photo quality checks) | QC Department → Quality Checks |
| Bottom bar `incidents` tab | `QcIncidentsSurface` (incident log) | QC Department → Incidents |
| Bottom bar `downtime` tab | `QcDowntimeSurface` (downtime trends) | QC Department → Downtime |
| Inventory tab | AI quality/defect photo check (`inventoryShared.ts` → `QualityCheckRecord`) | QC Department → Quality Checks |
| Inventory tab | Lot number field on inventory batches | QC Department → Lot Tracking (plus keep read-only summary in inventory) |
| Manager menu | Import dialogs (spec, premix, cheese, shipping, guides) | **Shared** — see below |

**Tab placement**: The bottom nav bar gains a `qc` tab (replacing or joining `quality`/`incidents`/`downtime` which currently exist as secondary tabs). The QC tab becomes one of the 6 bottom-bar slots (Run, Dough, Sauce, Frontline, QC, Warehouse) — or the existing quality/incidents/downtime tabs consolidate into a single QC section with internal sub-tabs (QA Checks, Incidents, Downtime, Lot Tracking, Weight Checks). The second option is recommended to avoid nav overcrowding.

### Shared Importers: QC + Everyone Else

The importers stay available to both QC and management, but with roles:

- **Who can import**: Managers, supervisors, and QC staff (existing capability gates stay)
- **Who must verify/approve**: QC staff — every import lands in a **pending review** state
- **Import flow**:
  1. Anyone with import capability uploads a file (spec sheet, shipping guide, premix, cheese, etc.)
  2. The parsed data lands in the normal pipeline BUT with `qc_review_status = "pending"`
  3. Database changes are applied but flagged as **unverified** (visible to all, marked "awaiting QC verification")
  4. QC staff see pending imports in their QC queue → review → **approve** (verified) or **reject** (rollback pending)
  5. On approval, the import becomes fully verified; on rejection, a rollback plan is offered
- **Where it shows**:
  - **QC Department** → "Import Review" queue (pending/approved/rejected, with diff preview)
  - **Company-wide** → imported data still shows everywhere (profiles, recipes, mixes) but with a small "unverified" badge until QC approves
- **Why shared works**: QC is the *primary* source but not the *only* source — managers can import in an emergency, but QC verification is the enforced quality gate

**Implementation notes**:
- Extend import metadata with `qc_review_status` enum: `pending | verified | rejected`
- Add `qc_reviewed_by`, `qc_reviewed_at`, `qc_review_notes` to import records
- API: `GET /api/qc/import-reviews` (queue), `POST /api/qc/import-reviews/:id/approve`, `POST /api/qc/import-reviews/:id/reject`
- Existing import capability gates (`canImportSpec`, `canImportProfileGuide`, etc.) remain unchanged for who can *trigger* an import
- Import commit / rollback needs to stay reversible until QC approves (see existing import lifecycle audit in docs/)


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

All QC tables share these audit columns:
- `id` (uuid, PK)
- `scope` (text, factory isolation — but **excluded from purge-all**)
- `created_by` (text, username of who performed the check)
- `created_at` (timestamptz, server DEFAULT NOW(), immutable)
- `run_id` (uuid, FK to production_runs — nullable for planning tables)

| # | Table | Purpose | Survives Reset |
|---|-------|---------|---------------|
| 1 | `run_lots` | Per-run, per-station ingredient lot logging | Yes |
| 2 | `weight_checks` | Pre-run + periodic weight verification | Yes |
| 3 | `component_checks` | Once-per-run component verification | Yes |
| 4 | `label_checks` | Shipper label verification | Yes |
| 5 | `date_checks` | Pizza/carton date code verification | Yes |
| 6 | `qc_checklists` | Computed checklist state per run | Yes |
| 7 | `qc_audit_log` | Immutable append-only audit trail for all QC ops | Yes, never deleted |
| 8 | `qc_recipes` | QC-owned recipe versions (approval history) | Yes |
| 9 | `qc_future_plans` | Upcoming brand/flavor planning entries | Yes |

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

### CRUD (per check type)
1. `POST /api/qc/run-lots` — log a lot for a run (server sets created_by, created_at)
2. `GET /api/qc/run-lots?runId=X` — get lots for a run
3. `POST /api/qc/weight-checks` — record a weight check
4. `GET /api/qc/weight-checks?runId=X` — get weight checks for a run
5. `POST /api/qc/component-checks` — record component check
6. `GET /api/qc/component-checks?runId=X` — get component checks
7. `POST /api/qc/label-checks` — record label check
8. `GET /api/qc/label-checks?runId=X` — get label checks
9. `POST /api/qc/date-checks` — record date check
10. `GET /api/qc/date-checks?runId=X` — get date checks

### Dashboard & Aggregation
11. `GET /api/qc/dashboard?runId=X` — aggregated QC status for current run
12. `GET /api/qc/dashboard/summary?from=&to=` — shift/day summary

### Audit & Compliance (immutable, never purged)
13. `GET /api/qc/audit?from=&to=&type=&ingredient=` — audit log query
14. `GET /api/qc/audit/export?format=csv|pdf` — export for external audits
15. `GET /api/qc/traceability?lot=X` — full chain: lot → run → checks → customer

### Import & Recipe Approval
16. `PUT /api/qc/import-approval/:id` — approve/reject import (audit logged)
17. `POST /api/qc/recipe-approval` — approve/reject recipe change
18. `GET /api/qc/future-plans` — upcoming brand/flavor plans
19. `POST /api/qc/future-plans` — add a future plan entry

### Protected (never purge-all'd)
All routes under `/api/qc/*` are **excluded from the purge-all handler** in `sync.ts`. The QC tables are added to a separate `auditedTables` group that the purge endpoint skips.
