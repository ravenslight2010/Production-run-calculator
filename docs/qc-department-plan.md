# QC Department — Comprehensive Plan

**Status:** Approved Phase 1 implemented; advisory Brix master-program Slice 0 and component identity/presence Slice 1 implemented and verified; later gates remain deferred
**Updated:** 2026-10-22
**Related:** [Idea backlog](idea-backlog.md#2-qc-department-comprehensive), [import plan](import-system-plan.md), [allergen plan](allergen-tracking-plan.md), [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md)

QC is a durable follow-on product track, not a sync-protocol prerequisite. New QC actions require explicit capabilities, server-generated audit identity, reset/purge survival, and stable ingredient identity for lot and allergen rollups.

## Approved Master-Program Slice 0 — Advisory Brix

**Status:** Implemented and verified with synthetic fixtures; the authenticated Brix matrix passed 8/8. The broader E2E syntax gate remains blocked by unrelated malformed specs (see the retained evidence map). This is an advisory QC workflow, not a production or regulatory approval.

- Brix readings are recorded from the Brix view alongside Lots and Weights, linked to the selected run, station, and active ingredient, with pre-run or interval timing and optional instrument/note.
- Managers configure Brix targets and tolerances separately from weight targets. Both values require an explicit reviewed setting; there is no inherited weight tolerance or default ±0.5 °Bx. Missing configuration stays not evaluated.
- The server validates readings in the canonical `brix` unit (0–100 °Bx), resolves the saved configuration, snapshots its version and applicable target/tolerance, and computes the outcome. Clients cannot submit authoritative targets or outcomes.
- Brix events appear in scoped history and manager CSV. Corrections and redactions append evidence; later run-linked events reopen sign-off. The shared QC event ledger preserves Brix evidence through daily reset and factory purge.
- The focused server, UI, database-retention, and authenticated browser checks use synthetic readings only. No real facility target values were supplied or inferred; reviewed operational configuration is still required before staff use.

This slice does not change weight behavior or add workbook target extraction, cadence alerts, device integrations, holds, run/shipping gates, or regulatory claims. Slice 8 enforcement remains deferred pending explicit owner policy; it is neither shipped nor formally declined. Slice 9 allergen expansion is not adopted by this request. See the retained [Slice 0 coverage map and failure ledger](../.local/tasks/evidence/qc-slice-0-brix/coverage-check-map.md).

## Approved Master-Program Slice 1 — Component Identity and Presence

**Status:** Implemented and verified with synthetic fixtures. This is advisory identity/presence evidence, not a sensory, food-safety, or production-release approval.

- The checklist uses server-resolved effective components from canonical run settings and substitutions. Completed runs retain their immutable component snapshot.
- Missing or ambiguous expected settings remain not evaluated with actionable explanations. The client records observations but cannot supply or override the expected component list or server-evaluated outcome.
- QC managers can sign off the exact reviewed event high-water mark. A later component record or correction reopens review; corrections and redactions append events without changing original evidence.
- Scoped history, manager CSV, and QC ledger reset/purge retention remain in place.
- No weight, sensory, color, smell, texture, photo, label/date-code, cross-contact, hold/release, or regulatory criteria are included.

Verification: resolver tests 13/13; checklist UI tests 14/14; focused PostgreSQL API role/high-water/correction test 1/1; QC purge-retention tests 3/3; authenticated Chromium and WebKit journeys 2/2, with four responsive viewport checks in each browser; workspace typecheck passed. Physical Android Chrome and iOS Safari/PWA were not run. See the retained [Slice 1 coverage map and failure ledger](../.local/tasks/evidence/qc-slice-1-component-completion/coverage-check-map.md).

Slice 8 enforcement remains deferred pending explicit owner policy; it is neither shipped nor formally declined. Slice 9 allergen expansion is not adopted by this request.

## QC Phase 1 — Approved and Implemented

### Lots and weights

- Lots and Weights are distinct QC views. Each lot is an append-only record linked to the current run, stable ingredient identity, station, authenticated recorder, and server timestamp. Repeated lots remain separate records.
- Weight checks support pre-run and 30-minute check types. Each records the target snapshot, target unit, actual value/unit, check type, authenticated recorder, server time, and evaluated result. Out-of-tolerance readings require a note.
- Targets resolve only from unambiguous imported portion fields or a manager-reviewed QC override. Imported sauce, applicator, and pepperoni portions are ounces per pizza; the doughball target is ounces. Recipe-linked cheese/mix applicators use their linked recipe name. Only an exact name match to one active ingredient is used. Incomplete, conflicting, unmatched, or missing targets return “not evaluated.”
- The spec-import contract has no explicit crust target field. Crust targets are therefore not inferred or evaluated unless a future approved importer contract adds an explicit value.
- Default tolerance is ±0.1 in the target unit. A reviewed QC override may supply another non-negative tolerance; a blank override tolerance uses the default. An explicit approved spec limit takes precedence if one becomes available.
- QC managers and app managers can change or clear reviewed targets. Each settings change records its authenticated actor, timestamp, and reason.

### Allergen and cleaning records

- The pre-run checklist snapshots the current derived run footprint, unknown/missing mappings, the per-run Warehouse ingredient-stage rows and their checked state, staged-ingredient review, and relevant cleaning status. The derived footprint remains visibility-only and separate from the manually entered run-allergen field.
- A cleaning record captures method, start/end times, authenticated cleaner, and server timestamp. A different authenticated person must verify it; self-verification is rejected.
- An authorized QC manager or app manager can sign off once for the current run evidence set. Any later QC record reopens that review.
- QC work never blocks production or shipping. Unknown or incomplete allergen data remains visible and is not presented as clear.

### Roles, history, audit, and retention

- QC operators can record QC work and view facility-scoped history. QC managers and app managers can edit targets, sign off runs, and export full filtered history as CSV.
- Facility scope comes from the authenticated request. History queries are bounded and paginated; CSV export is manager-only.
- QC events are append-only, server-timestamped, and attributed to authenticated actor IDs. Corrections and privacy redactions are new auditable events, never edits or deletes. Retention is indefinite.
- The new QC event ledger is outside day-state reset and factory-purge deletion. The existing photo-quality records remain a separate surface with their existing behavior.

### Deferred from Phase 1

Shipping holds or release enforcement; regulatory or food-label declarations; shipper-label and date-code checks; import or recipe approval; trend/analytics; cross-contact analytics; lot-to-customer traceability; line clearance; finished-lot identification; mock recall; and HACCP evidence.

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
Phase 1 QC events and the existing photo-quality records are separate from day-state and factory-purge data. Integration coverage verifies that live and sandbox QC events survive both `/sync/reset` and `/sync/purge-all`, while scoped operational state is reset or purged.

### Audit, Access, and Retention — Phase 1 Contract
- Each QC event is facility-scoped from the authenticated request, attributed to the authenticated actor ID, and timestamped by the server.
- The QC event ledger rejects UPDATE and DELETE. Corrections and privacy redactions append events that preserve the original history while changing the reviewed presentation.
- Operators with `record-qc` can record QC work and read scoped history. `manage-qc` and app managers can change targets, sign off runs, and export full filtered history as CSV.
- History reads are bounded and paginated; export is manager-only. No IP address, user agent, or unrestricted request body is stored.
- Retention is indefinite. Privacy requests use the audited redaction path rather than deleting QC evidence.
- Required audit and record writes are atomic. If a required event cannot be saved, the operation fails instead of silently succeeding.

These are implemented Phase 1 boundaries, not open design questions. The retained [operational audit design boundaries](idea-backlog.md#17-residual-observability--resilience-ideas) still apply.

The remainder of this document separates implemented Phase 1 behavior from deferred candidates. Deferred proposals are not approved requirements.

## Existing Surfaces and Phase 1 Placement

Phase 1 adds run QC workflows inside the existing QC department without replacing photo history or moving unrelated import, inventory, substitution, incident, or downtime workflows:

| Current Location | Feature | Move To |
|-----------------|---------|---------|
| QC department | Append-only Lots and Weights workflows | QC workflows |
| QC department | Derived allergen footprint, staged review, cleaning record and independent verification | QC workflows |
| QC department | Existing photo-quality history | Separate photo-quality section; behavior unchanged |
| QC department | Incident log and downtime trends | Existing separate surfaces |
| Inventory tab | Inventory lot number field and temporary substitutions | Remain in Inventory |
| Manager menu | Import dialogs (spec, premix, cheese, shipping, guides) | **Shared** — see below |

QC workflows are available from the department menu to authorized QC staff; the primary station navigation is unchanged.

### Shared Importers: QC + Everyone Else (approval workflow deferred)

The existing importers stay available under their current permissions. Phase 1 does not add QC import approval or change importer behavior. The following proposal is deferred:

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

**Deferred implementation notes**:
- Extend import metadata with `qc_review_status` enum: `pending | verified | rejected`
- Add `qc_reviewed_by`, `qc_reviewed_at`, `qc_review_notes` to import records
- API: `GET /api/qc/import-reviews` (queue), `POST /api/qc/import-reviews/:id/approve`, `POST /api/qc/import-reviews/:id/reject`
- Existing import capability gates (`canImportSpec`, `canImportProfileGuide`, etc.) remain unchanged for who can *trigger* an import
- Import commit / rollback needs to stay reversible until QC approves (see existing import lifecycle audit in docs/)


- **Existing tabs**: Quality (photo checks), Incidents, Downtime Trends
- **Inventory lot tracking**: Basic lot number field on inventory items; separate from Phase 1 run-level QC lots
- **Phase 1 adds**: weight checks and per-run, per-station QC lot records
- **Deferred**: shipper labels, date verification, full lot traceability, and QC analytics dashboards

---

## QC Department Structure and Deferred Candidates

### 1. Lot Tracking (Enhanced)
**What exists**: Simple lot number text field on inventory batches
**Implemented in Phase 1**:
- Per-station lot logging (every ingredient used gets its lot recorded against the current run)
- Stable ingredient ID, run, station, authenticated recorder, and server timestamp are included in the immutable event.
- Repeated lots for one run/ingredient remain separate records.

**Deferred**: lot-to-customer traceability, recipe-chain rollups, expiry alerts, barcode scanning, and inventory-batch linking.

### 2. Weight Checks
**What exists**: Nothing — manual clipboard process
**Implemented in Phase 1**: pre-run and 30-minute checks, explicit target snapshots, actual value/unit, default ±0.1 target-unit tolerance, reason-required deviations, authenticated recorder, server time, and “not evaluated” when a valid target is unavailable.

**Deferred**: trend graphs, analytics, and any inferred target or tolerance.

### 3. Component Checks
**Status:** Approved master-program Slice 1 is implemented and verified for identity and presence only. See the Slice 1 acceptance and evidence map above.

The server resolves expected effective components from canonical run settings and substitutions, preserves completed-run expectations, and leaves incomplete or ambiguous settings not evaluated. Observations and outcomes are recorded in the existing append-only QC event ledger. Manager sign-off is tied to an exact event high-water mark; later run-linked component evidence and corrections reopen review.

**Out of scope:** Weight, sensory, color, smell, texture, photos, labels/date codes, cross-contact, safety conclusions, and production or shipping enforcement.

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
- Checklist completion tracker for the applicable lot, weight, and component identity/presence workflows
- Alert panel (overdue checks, failed checks, expiring lots)
- Shift summary (what was checked, what failed, what's pending)

---

## Recommended Build Order

### Phase 1: QC and allergen foundation — implemented
1. Separate append-only lot and weight records tied to a run and stable ingredient.
2. Explicit importer-backed targets, reviewed overrides, target-unit tolerance, and not-evaluated behavior.
3. Advisory allergen pre-run checklist and independently verified cleaning records.
4. Per-run QC manager sign-off, scoped history, manager CSV export, audited correction/redaction, and reset/purge retention.
5. Existing photo-quality history stays separate.

### Phase 2: Verification Workflows
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

## Phase 1 Persistence

Phase 1 uses one facility-scoped append-only `qc_workflow_events` ledger for lots, weight checks, allergen reviews, cleaning and verification, target settings, sign-offs, corrections, and redactions. Each event has an authenticated actor ID and server-generated timestamp. The ledger is outside day-state and factory-purge deletion.

## Phase 1 UI Surfaces

The QC department presents distinct Lots and Weights views, an allergen/staging review, cleaning record and independent verification, manager target settings, per-run sign-off, scoped event history, and manager CSV export. Corrections and privacy redactions are available to QC managers. The existing `QualityHistoryTab` remains a separate photo-quality section.

## Phase 1 API

- `GET/POST /api/qc/targets`
- `POST /api/qc/lots` and `/api/qc/weight-checks`
- `GET /api/qc/runs/:runId`
- `POST /api/qc/allergen-reviews`
- `POST /api/qc/cleaning-records` and `/api/qc/cleaning-records/:recordId/verification`
- `POST /api/qc/run-signoffs`
- `GET /api/qc/history` and manager-only `GET /api/qc/history.csv`
- Manager-only `POST /api/qc/events/:eventId/corrections` and `/redactions`

Every path is capability-gated and derives facility scope from the authenticated request. History queries are paginated and bounded; CSV export streams bounded database pages. QC ledger records are excluded from daily reset and factory purge.

## Deferred API and Workflow Gates

Shipper labels, date codes, import/recipe approval, dashboards, trend/analytics, PDF export, lot-to-customer traceability, holds, release enforcement, and label/regulatory claims remain deferred.
