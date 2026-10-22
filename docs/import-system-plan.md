# Import System — Comprehensive Plan

**Status:** Audited safety implementation integrated across seven importers. See [support, verification and explicit coverage limits](evidence/audited-import-safety.md). Batch Apply, templates, scheduling and QC remain separate work.
**Updated:** 2026-10-22
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

### Support and remaining work (reconciled 2026-10-22)

1. **QC approval gate — gated** — owned by the QC department; do not build before QC Phase 1 prerequisites are resolved.
2. **Atomic undo — complete for spec/premix/cheese only** — local-only guide and schedule projections retain separate recovery boundaries.
3. **Structured preview diff — implemented with bounded authority** — all seven paths share the final review. Atomic, local profile and per-day sync guarantees remain distinct.
4. **Batch import — partial** — spec multi-file parsing exists; mixed/all-importer batch application remains.
5. **Template download — open** — no maintained template-download workflow for every importer.
6. **Shared validation pre-check — implemented for bounded supported inputs** — recognized-table rules validate canonical headers/types; unfamiliar layouts retain format-specific parsing/review/fallback.
7. **Import scheduling — deferred** — revisit only if a recurring source and approved workflow exist.
8. **Cross-import health — implemented, bounded and read-only** — existing profile/master/source findings plus seven-source history coverage and review navigation; missing evidence is not a confirmed defect.
9. **Import → inventory impact — existing read-only support** — unchanged by this work; no stock writer or multi-profile projection is introduced here.
10. **Re-import version diff — implemented with evidence limits** — successful applied business facts are compared separately from factory changes; missing legacy receipts and source-only facts are not guessed.

### Importer support / recovery matrix

| Importer | Current-state comparison | Successful source baseline | Apply / recovery authority |
|---|---|---|---|
| Spec | Normalized reviewed multi-entity write set; server affected-state hash | Same scoped type/source, latest retained successful non-undone operation | Transaction / original-ID retry / guarded Undo |
| Premix | Same final review after inclusion/matching/prune choices | Same operation resolver | Transaction / original-ID retry / guarded Undo |
| Cheese | Same final review after inclusion/matching choices | Same operation resolver | Transaction / original-ID retry / guarded Undo |
| Shipping | Exact selected brand/flavor patches; device raw-profile/flavor-map recheck | New locally verified applied-value receipt; legacy unavailable | Existing local writes/queue/sync; no atomic Undo or remote-delivery assertion |
| Sauce | Only commit-eligible rows and actual assignment/oz patches | New locally verified applied-value receipt; legacy unavailable | Same local-only boundary |
| Dough | Only commit-eligible rows and actual dough-name patches | New locally verified applied-value receipt; legacy unavailable | Same local-only boundary |
| Schedule | Appended/replaced run IDs, protected retained runs, explicit tombstones; editor-only identified | Acknowledged successful history, date-scoped applied values; legacy unavailable | Each day separately fenced; editor changes require Save; no atomic batch Undo |

Source identity is the existing normalized filename-set key, scoped by facility and import type; renaming a source creates a different identity. New guide/schedule history retains only allowlisted applied business fields (500 rows / 100 KB), not workbook bytes, raw source cells, formulas, citations or full profiles. Local receipts are not atomic or remote-delivery proof. The newest successful legacy record is never silently replaced by an older comparable record. Source absence means “not included in this candidate,” not factory deletion.

Bounds: 25 MB/file, 100 worksheets, 20,000 rows/sheet, 300 columns/sheet and 500,000 cells/workbook; spec multi-file sets additionally cap 100 files / 50 MB total. Sauce DOCX bounds expanded document text at 5 MB. Unknown layouts, blank values and unsupported packaging strings retain explicit review rather than a guessed canonical interpretation.

The manager Data health workspace uses existing bounded reconcilers and adds up to 200 recent history records of source coverage. Valid shared recipes and direct ingredient slots do not require their own source workbook. Unreferenced recipe findings indicate missing reference evidence, not automatic deletion/repair authority.

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
**Status (2026-10-22): Implemented.** The final shared review follows the original per-importer choices. Atomic proposals use the same normalization as Apply; local/sync reviews show their lower guarantees. Only actual delete instructions produce factory removals; repeated component rows retain identity and unknowns remain explicit.
**What**: Before applying, show exactly what will change in the factory data.

**View** (per change):
```
CREATE  Brand "Bobo's" + flavor "Deluxe"  (new profile)
UPDATE  Recipe "Deluxe Sauce" → sauce recipe rows (2 added, 1 changed)
LINK    Sauce recipe "Deluxe" → "Shared Sauce" (was unlinked)
```

**How**: Compare the "current factory state" vs. "post-import state" for each entity kind the importer touches. Reuse `savedSpecSheets`/profile snapshots + the change manifest.

**Boundary**: This is human import review, not implementation or approval of the separately owned QC queue.

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
**Status:** Implemented as optional client-generated downloads; see
[`import-template-downloads.md`](import-template-downloads.md) for the seven
formats, native units, compatibility boundaries and deterministic fixtures.
**What**: Download a blank, correctly-formatted Excel template for each importer.

**How**:
- Each importer defines its expected columns/sheets (from the shared lib parse shapes)
- A template generator writes headers + one example row
- Templates reuse shared export builders and preflight locally; no additional API
  or source retention. The sauce mapping guide additionally accepts `.xlsx`
  sentences through its existing deterministic parser; Word guides remain supported.

### 6. Validation Rules Pre-Check (new)
**Status:** Implemented with conservative format recognition and shared bounds, plus existing importer-specific rules. Unknown layouts do not inherit assumed canonical columns; blank amounts remain review-required unknowns, not inferred zero.
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
**Status:** Implemented in the existing manager Data health workspace: seven-source coverage, bounded existing profile/master/source findings, and navigation to review. Reads never repair records, learn aliases or write stock.
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
**Status:** Implemented with explicit evidence/authority limits; see the support matrix.
**What**: When a known sheet is re-imported, show what changed vs. the last time.

**How**: Compare reviewed candidate business values against the last successful Apply for the same scoped type/sourceKey, separately from current factory-state changes:
- New products added
- Previously included products absent from this candidate (source coverage change, not factory deletion)
- Recipe weights changed
- Packaging settings changed

**Boundary**: Failed/undone atomic operations cannot become baselines. Review-only snapshots and counts cannot establish successful Apply facts. Missing legacy/over-limit baselines and local-versus-remote guarantees are visible.

---

## Historical build order and separate remaining ownership

The audited implementation order was final structured proposal, shared preflight, unified health, then successful source comparison. The earlier phases below are retained as a roadmap, not a claim that their formerly open items remain unimplemented. Gold Lab capture/scoring is owned by #3406 and its approval/browser follow-ups by #3492/#3493; advisory Import QC Review Queue belongs to #3468. Learned-name cross-manager propagation belongs to #3439. No lifecycle or completion claim for those separate tasks is made here.

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
| `artifacts/run-calculator/src/components/SpecImportDialog.tsx` | Spec importer |
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
| `lib/db/src/schema/` | Existing import/audit storage; no schema addition for this work |
| `lib/spec-import/src/importChanges.ts` | Pure structured current/source comparisons |
| `lib/spec-import/src/importPreflight.ts` | Shared bounded format-aware preflight |
| `lib/spec-import/src/importAppliedValues.ts` | Allowlisted applied business receipts; excludes source evidence |
| `artifacts/run-calculator/src/components/ImportSafetyReviewHost.tsx` | Shared searchable final review |
| `artifacts/run-calculator/src/importProfileReview.ts` | Exact local targets and stale/verification checks |
| `artifacts/run-calculator/src/importScheduleReview.ts` | Per-day proposals and source comparison |
| `artifacts/api-server/src/routes/importOperations.ts` | Read-only preview; existing transactional Apply/Undo |
| `artifacts/api-server/src/routes/profileDataHealth.ts` | Existing scoped health workspace plus source coverage |

## New Database Tables / Fields
**Historical design sketch only:** scoped import operation/history storage already exists for spec, premix, and cheese. Do not add these proposed tables/fields without checking current schema and an approved scope.
- `imports` table: add `qc_review_status` (`pending|verified|rejected`), `qc_reviewed_by`, `qc_reviewed_at`, `qc_review_notes`
- `import_undo_snapshots` table: snapshot_id, entity kind, before-state JSON, imported_by, created_at
- (QC review queue reuses the QC dept tables/API)

## Existing safety APIs and separately proposed routes
- `POST /api/import-operations/preview` — normalized bounded proposal and scoped successful baseline; read-only.
- `POST /api/import-operations/:operationId/apply` — existing atomic commit with reviewed affected-state hash.
- `GET /api/profile-data/health-workspace` — existing manager-only read-only health workspace with source coverage.
- `GET /api/import-history?type=...&sourceKey=...&status=complete` — bounded scoped source history.

The remaining endpoints below are historical proposals, not implemented contracts of this task:
- `GET /api/qc/import-reviews` — QC pending queue
- `POST /api/qc/import-reviews/:id/approve` — verify
- `POST /api/qc/import-reviews/:id/reject` — reject + rollback offer
- Generic rollback is **not** an open feature for spec/premix/cheese; their guarded undo is implemented. Local-only guides and schedules retain separate recovery boundaries.
- Structured preview uses the existing operation boundary above rather than a separate generic diff endpoint.
- `GET /api/import/templates/{type}` — historical proposal, replaced by local
  downloads using existing workbook utilities
- Shared file preflight runs locally before expensive parser/provider work; no unnecessary validation-upload endpoint was added.
