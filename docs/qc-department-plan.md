# QC Department — Comprehensive Plan

**Status:** Planning; existing quality, incident, downtime, substitution, and basic lot surfaces are inputs, not proof that the durable QC system is built
**Updated:** 2026-10-05
**Related:** [Idea backlog](idea-backlog.md#2-qc-department-comprehensive), [import plan](import-system-plan.md), [allergen plan](allergen-tracking-plan.md), [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md)

QC is a durable follow-on product track, not a sync-protocol prerequisite. New QC actions require explicit capabilities, server-generated audit identity, reset/purge survival, and stable ingredient identity for lot and allergen rollups.

## QC Phase 1 — Owner Decision Note

**Status:** Owner accepted this as the current scope proposal on 2026-10-05. This is not approval to begin schema, API, or UI work. Resolve the open decisions before implementation.

### Proposed minimum

- Keep **Lots** and **Weights** on separate pages.
- Record ingredient lots against a production run, including ingredient identity, lot number, station, authenticated recorder, and server timestamp.
- Record weight checks before the run and every 30 minutes while it is running, for ingredients with a defined target weight. Capture the target and unit, actual value and unit, check time/type, recorder, and outcome; record a reason or note for an out-of-tolerance result.
- Include crust weight targets. The target must be captured through spec imports; verify the needed spec-import field and mapping before implementation. Do not assume the current importer already supplies it.
- Keep the existing manager-reviewed photo quality history as a separate record surface; Phase 1 does not replace or expand that workflow.

**Still to define before implementation:** the source and allowed tolerance for each target weight, what constitutes a check failure, and how to handle an ingredient with no target. Do not invent a tolerance or infer one from incomplete spec data.

### Roles and hold policy

- **Recording:** QC staff may record lot and weight checks.
- **Sign-off:** a designated QC lead or manager signs off. The exact role/capability mapping and whether sign-off is per check or per run remain open.
- **Hold direction for later work:** a QC hold blocks shipping, not production-run completion. A designated QC lead or manager may clear it. Hold enforcement is explicitly deferred from Phase 1; who may place a hold, release criteria, and any exception process remain open.

### Retention, audit, history, and export

- **Retention direction:** retain QC records indefinitely, subject to a separately approved privacy/redaction policy. That policy is a prerequisite to implementation, not something this note decides.
- Future QC records and their audit evidence must remain outside daily-reset day-state and factory-purge deletion. The audit trail must be append-only, use authenticated actor identity and server-generated timestamps, and represent corrections as new events rather than edits or deletions.
- Provide filtered historical access and CSV export. Proposed filters are date, run, ingredient, lot, and station. The roles allowed to view/export history and the exact CSV columns remain open.
- Historical evidence must be scope-isolated and capability-gated; facility scope must come from the authenticated request, not a client-selected query parameter. Any audit write required for a QC action must succeed atomically with that action or fail explicitly.

### Deferred from Phase 1

Component, label, and date-code checks; import or recipe approval; trend/analytics and lot-to-customer traceability; line clearance, finished-lot identification, mock recall, and HACCP evidence. The shipping hold/release policy above is reserved for later work and does not add hold enforcement to Phase 1.

### Existing quality and purge behavior

The existing `quality_checks` records are reviewed photo-quality checks, separate from proposed run-lot and weight records. The factory purge already retains this history, and the daily reset clears day-state rather than this server-side history. This prerequisite is complete; do not redo it as part of QC Phase 1. Any future QC tables or audit records must receive equivalent reset/purge protection before release.

## Critical Requirements

### Daily Reset: Archive Yesterday, Show Only Today
The daily reset (midnight day-state clear) is the natural cutoff point. QC data behavior:

- **Active QC pages** — Lots and Weights remain separate; each defaults to current-run/today records
- **History view** — browse prior records, filter by date/ingredient/lot/station, and export CSV as scoped in the owner decision note
- **Yesterday's data is saved** — historical QC records are not removed by the daily reset; retention follows the approved privacy/redaction policy
- **No clutter** — operators see only what matters RIGHT NOW on the active screen; historical data never pollutes the current view
- **The reset doesn't delete QC data** — it clears day-state (runs and active operational data), not server-persisted QC history

**Illustrative view pattern (not an implementation spec)**:
```
QC
├── Lots               ← separate page; current run by default
├── Weights            ← separate page; current run by default
└── History / CSV      ← filter historical checks for authorized review
```

The daily reset is invisible to QC pages: each defaults to current records, while older entries remain available in history subject to the approved retention policy.

### QC Data Survives All Wipes
The existing `quality_checks` history is already protected from the daily reset and factory purge. Integration coverage verifies that both live and sandbox quality history survive the purge while scoped operational data is removed.

For future QC records, the purge boundary remains a release requirement: never add QC evidence to day-state reset data or the factory-purge deletion list. Keep new records append-only and verify reset/purge survival for each new record type. This protection is already implemented for current quality history; do not repeat that work.

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
- Retained indefinitely, subject to the separately approved privacy/redaction policy required by the owner decision note
- Queryable only by authorized roles; the Phase 1 roles allowed to browse or export history remain unresolved
- Exportable as CSV in the proposed Phase 1 scope; PDF is not included in that minimum

**Candidate implementation constraints (not approval to build)**:
- Each QC table gets `created_at` (server DEFAULT NOW()), `created_by` (user FK), `scope` (factory isolation)
- Add a `qc_audit_log` table that fires on INSERT to any QC table (PostgreSQL trigger or application-level)
- Apply the owner-directed indefinite retention only after the privacy/redaction policy is approved
- Keep the final route and export contract open until the decision note's unresolved access and CSV-field choices are settled

**Privacy and authorization guardrails before implementation**:
- Derive facility scope from the authenticated request and enforce the live-scope fence; a query parameter must never choose the authorization scope
- Store stable user IDs and server timestamps; do not default to raw usernames, IP addresses, user agents, request bodies, or unrestricted JSON
- Define an allowlisted, size-bounded event schema for each QC action
- Resolve the relationship between indefinite compliance retention and privacy/redaction requirements before creating tables
- Paginate and capability-gate every read/export path
- If an operation requires an audit record for compliance, persist both atomically or fail explicitly rather than swallowing the audit failure
- Follow the retained [operational audit design boundaries](idea-backlog.md#17-residual-observability--resilience-ideas)

The remainder of this document contains broader candidate designs. Where they conflict with the owner decision note above, that note governs Phase 1. Details not explicitly decided there are not approved requirements.

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
| Inventory tab | Substitutions Manager (temporary ingredient subs) | QC Department → Substitutions |
| Inventory tab | Substitution Log (today's sub actions) | QC Department → Substitution Log |
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

### Phase 1: Owner-proposed lot and weight checks
1. **Lot page** — run-level ingredient and station lot records
2. **Weight page** — pre-run and 30-minute checks for ingredients with defined target weights, including crust targets sourced from spec imports
3. **Filtered history and CSV export** — subject to the unresolved viewer-role and CSV-column decisions

The exact QC capability/role mapping, check sign-off granularity, and target tolerances must be resolved before implementation. A combined dashboard is not part of the minimum established in the owner decision note; whether to add one remains open.

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
