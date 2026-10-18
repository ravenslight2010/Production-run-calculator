# Import System — Comprehensive Plan

**Status:** Partial — history, source-versus-landed reporting, deterministic-first supported workbook parsing, and transactional apply/guarded undo for spec/premix/cheese are implemented
**Updated:** 2026-10-08
**Related:** [Idea backlog](idea-backlog.md#15-import-system-improvements), [additional domain synthesis](../research/additional-domain-research-synthesis-2026-09-19.md)

Spec, premix, and cheese now apply server-owned master-data changes through one operation identity and transaction. The server retains bounded before/after snapshots, returns a canonical result for idempotent retries, and permits undo only while affected rows still match that result. Saved review snapshots remain source-review artifacts, not rollback snapshots. Local-only shipping, sauce-guide, dough-guide, and schedule projections retain their existing sync boundaries.

## Current State

### The 7 Importer Types
| Type | Source | What It Sets Up |
|------|--------|-----------------|
| **Spec sheets** | Excel/photo | Product (brand/flavor), recipes, allergens, packaging |
| **Premix sheets** | Excel | Mix formulas, freezer pulls |
| **Cheese mix specs** | Excel | Cheese recipes, recipe links |
| **Shipping guides** | Excel | Packaging profile patches |
| **Sauce guides** | Excel | Sauce assignments for saved profiles |
| **Dough guides** | Excel | Dough assignments for saved profiles |
| **Schedules** | Excel | Production-day runs (planner) |

### What Exists Today
- **AI-assisted matching** — auto-suggests brand/flavor matches; fuzzy (Levenshtein) fallback
- **Review stages** — each dialog has a review step before applying (user edits matches)
- **Second-pass AI review** — `ReviewBadge` verdicts on AI suggestions
- **Learned aliases** — confirmed matches from past imports auto-apply next time
- **Import history** — browse/filter past imports, show source vs. landed counts, reopen saved snapshots, retry failed
- **Snapshots** — saved review state for spec/premix/cheese (reopen without re-parsing)
- **Audit recovery** — pending audit records retried when they fail to save
- **Import access gates** — capability-based (canImportSpec, canImportProfileGuide, etc.)
- **Atomic apply and guarded undo** — spec, premix, and cheese commit server-owned changes and history together; retries reuse the same operation
- **Source-versus-landed report** — importer history reports source/landed counts and keeps non-comparable source-only or landed-only values explicit
- **Deterministic-first supported workbook parsing** — supported layouts parse deterministically; unsupported/ambiguous sources remain explicit review/fallback cases

### Remaining work (reconciled 2026-10-08)

1. **QC approval gate — gated** — owned by the QC department; do not build before QC Phase 1 prerequisites are resolved.
2. **Atomic undo — complete for spec/premix/cheese only** — local-only guide and schedule projections retain separate recovery boundaries.
3. **Universal structured preview diff — partial** — importer review and operation history exist; a consistent before/after factory-data diff across importers remains.
4. **Batch import — partial** — spec multi-file parsing exists; mixed/all-importer batch application remains.
5. **Template download — open** — no maintained template-download workflow for every importer.
6. **Shared validation pre-check — partial** — individual guards exist; comprehensive importer preflight is not established.
7. **Import scheduling — deferred** — revisit only if a recurring source and approved workflow exist.
8. **Cross-import health — partial** — spec/mix reconciliation exists; a unified health view across all importer types remains.
9. **Import → inventory impact — open** — preview projected demand from reviewed recipe changes; do not mutate stock.
10. **Re-import version diff — open** — source-keyed prior-versus-current changes are not shown.

---

## Proposed System

### 1. QC Approval Gate (moved to QC department)
**Status**: **DEPENDS ON QC DEPARTMENT** — moves to `docs/qc-department-plan.md` (Shared Importers section). Build only after the QC section exists.

**Flow** (from QC plan):
1. Anyone with import capability uploads
2. Parsed data applies BUT flagged `qc_review_status = "pending"`
3. QC sees pending imports in their Import Review queue (diff preview)
4. Approve → fully verified (badge clears) | Reject → rollback offered

**Impact**: Importers remain shared; QC is the quality gate. The import system only needs to expose the `qc_review_status` field + the review queue API contract; the QC UI lives in the QC department.

**Dependency note**: This item is NOT in the import plan's build order. It is owned by the QC department plan (Phase 3: Import approval queue). The import plan's Phases are standalone and can proceed before QC exists.

### 2. Rollback / Undo (implemented for atomic multi-entity imports)
**What**: Undo an applied spec, premix, or cheese import while its affected rows remain unchanged.

**How**:
- The apply transaction captures bounded before/after snapshots of affected rows and writes import history under the same operation identity
- "Undo guarded import" compares current affected rows with the committed result, then restores the before snapshot in one transaction
- Available from the Import History panel for atomic import records
- Guard: later edits to affected rows return a conflict and require manual review; unrelated edits do not block undo

### 3. Structured Preview Diff (new)
**Status (2026-10-08): Partial.** Review steps, persisted source/landed reports, and scoped operation snapshots exist; one consistent before/after factory-data diff across importer types remains open.
**What**: Before applying, show exactly what will change in the factory data.

**View** (per change):
```
CREATE  Brand "Bobo's" + flavor "Deluxe"  (new profile)
UPDATE  Recipe "Deluxe Sauce" → sauce recipe rows (2 added, 1 changed)
LINK    Frontline "Deluxe" → cheese recipe "4-Cheese" (was unlinked)
```

**How**: Compare the "current factory state" vs. "post-import state" for each entity kind the importer touches. Reuse `savedSpecSheets`/profile snapshots + the change manifest.

**Benefit**: QC review becomes a real diff review, not a "trust the parse" review.

### 4. Batch Import (new)
**Status (2026-10-08): Partial.** Spec multi-file parsing exists; a mixed/all-importer batch review and apply workflow does not.
**What**: Extend current multi-file support to consistent batch review and apply across importer types.

**Flow**:
- Multi-file picker → each file goes through its own parse → review queue
- User reviews each file's matches/preview in sequence
- "Apply all" or per-file apply
- Each file gets its own import-history record (audit per file)

**Note**: Schedule planner already handles multi-sheet day blocks; extend the pattern to all importers.

### 5. Template Download (new)
**Status:** Open.
**What**: Download a blank, correctly-formatted Excel template for each importer.

**How**:
- Each importer defines its expected columns/sheets (from the shared lib parse shapes)
- A template generator writes headers + one example row
- Templates live server-side (`GET /api/import/templates/{type}`) so they never drift from the parser

### 6. Validation Rules Pre-Check (new)
**Status:** Partial — importer-specific guards exist; shared preflight across supported files is not established.
**What**: Pre-flight validation before the AI parse even runs.

**Examples**:
- Blank file / no sheets
- Missing required columns
- Unknown brand/flavor with no create permission
- Inconsistent units (oz vs lbs mixups)
- Overlapping product definitions (same brand/flavor defined twice in one file)
- Allergen field typos (warn, don't fail)

**Benefit**: Fail fast on file-shape errors; the AI parse only runs on structurally valid files (saves AI cost).

### 7. Import Scheduling (deferrable)
**Status:** Deferred unless a recurring source and owner-approved workflow are established.
**What**: Queue a file to import at a later time.

**Use cases**: Nightly spec-sheet sync, scheduled customer file drops.
**Status**: Lower priority — requires auth/session handling for async apply. Keep as a "later" idea unless the facility has a recurring file source.

### 8. Cross-Importer Linking (new)
**Status:** Partial — spec/mix reconciliation and name-link paths exist; a unified health view across all importer types remains.
**What**: One import informs another.

**Examples**:
- Spec import defines a product → premix import for the same brand/flavor auto-links
- Cheese import updates a recipe → spec import for a product using that cheese suggests the link
- Reconcile panel already cross-references premix vs spec (MixReconcilePanel) — extend to cheese/shipping

**How**: Reuse the saved-sheet store + reconcilers (`@workspace/spec-reconcile`, `@workspace/mix-reconcile`) into a single "cross-import health" view: which products have spec+premix+cheese+shipping all landed, which are missing pieces.

### 9. Import → Inventory Tie-in (new)
**Status:** Implemented for the currently selected run. The review compares before/after demand with a read-only stock snapshot; no stock mutation.
**What**: Recipes set up by imports drive inventory consumption lines automatically.

**Why**: When a spec import defines dough/sauce/cheese/app recipes, `computeRunConsumptionLines` already turns them into inventory keys. The gap: no visibility that "this import means we'll need X lbs of ingredient Y on runs of this product."

**Current scope**: In step 2 of the spec import review, show changed ingredient and packaging demand for the selected run's planned cases, plus shortages, untracked items, or unavailable stock. Other products in a multi-profile workbook are not projected. Missing run quantities or inventory data are identified rather than guessed. The preview does not reserve stock or write inventory/consumption records.

### 10. Data Versioning / Change Detection (new)
**Status:** Open — no source-keyed prior-versus-current change report is established.
**What**: When a known sheet is re-imported, show what changed vs. the last time.

**How**: Compare new parse vs. the previous snapshot for the same sourceKey:
- New products added
- Products removed/merged
- Recipe weights changed
- Packaging settings changed

**Benefit**: "Re-importing this sheet will change 3 recipes and add 1 new flavor" — no silent overwrites.

---

## Recommended Build Order

### Phase 1: Foundation (standalone — no QC dependency)
1. Complete cell-source provenance tracked by active task #2854.
2. **Import → inventory impact preview** using reviewed changes and existing inventory math; no stock mutation (implemented for the selected run).
3. **Unified cross-import health** beyond current spec/mix reconciliation.

### Phase 2: Safety & Quality
4. **Structured before/after preview diff** across supported importer types.
5. **Shared validation pre-check** (fail fast on file shape and supported data rules).
6. **Template download** where a canonical format can be maintained.

### Phase 3: Advanced
7. **Batch import** beyond current spec multi-file parsing.
8. **Data versioning** (re-import diff vs. last time).

### Phase 4: QC Integration (after QC department is built)
9. **QC approval gate** — owned by QC dept plan (Shared Importers). Import system exposes `qc_review_status` + review queue API; QC UI lives in QC department.

### Phase 5: Deferred
10. **Import scheduling** — only if a recurring file source exists

---

## Key Code References

| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/components/SpecImportDialog.tsx` | Spec importer (2017 lines) |
| `artifacts/run-calculator/src/components/PremixImportDialog.tsx` | Premix importer |
| `artifacts/run-calculator/src/components/CheeseImportDialog.tsx` | Cheese importer |
| `artifacts/run-calculator/src/components/ShippingImportDialog.tsx` | Shipping importer |
| `artifacts/run-calculator/src/components/ExcelImportDialog.tsx` | Schedule importer |
| `artifacts/run-calculator/src/components/RecipeGuideImportDialog.tsx` | Sauce/dough guides |
| `artifacts/run-calculator/src/components/ImportHistoryPanel.tsx` | History browse/reopen/retry |
| `artifacts/run-calculator/src/importHistory.ts` | History model, snapshots, audit |
| `artifacts/run-calculator/src/specImport.ts` | Spec parse/prepare/review |
| `lib/spec-import/src/index.ts` | Spec parser (shared) |
| `lib/premix-import/src/index.ts` | Premix parser (shared) |
| `lib/cheese-import/src/index.ts` | Cheese parser (shared) |
| `lib/shipping-import/src/index.ts` | Shipping parser (shared) |
| `lib/spec-reconcile/src/index.ts` | Spec reconcile (cross-import health) |
| `lib/mix-reconcile/src/index.ts` | Mix reconcile (cross-import health) |
| `artifacts/run-calculator/src/importAccess.ts` | Import capability gates |
| `lib/db/src/schema/` | Import/audit tables (extend) |

## New Database Tables / Fields
**Historical design sketch only:** scoped import operation/history storage already exists for spec, premix, and cheese. Do not add these proposed tables/fields without checking current schema and an approved scope.
- `imports` table: add `qc_review_status` (`pending|verified|rejected`), `qc_reviewed_by`, `qc_reviewed_at`, `qc_review_notes`
- `import_undo_snapshots` table: snapshot_id, entity kind, before-state JSON, imported_by, created_at
- (QC review queue reuses the QC dept tables/API)

## API Routes to Add
- `GET /api/qc/import-reviews` — QC pending queue
- `POST /api/qc/import-reviews/:id/approve` — verify
- `POST /api/qc/import-reviews/:id/reject` — reject + rollback offer
- Generic rollback is **not** an open feature for spec/premix/cheese; their guarded undo is implemented. Local-only guides and schedules retain separate recovery boundaries.
- `GET /api/imports/:id/diff` — structured preview diff
- `GET /api/import/templates/{type}` — download blank template
- `POST /api/import/validate` — pre-flight validation
