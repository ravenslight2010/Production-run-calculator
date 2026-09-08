# Import System — Comprehensive Plan

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

### What's Missing (from earlier ideas + new insights)

1. **No QC approval gate** — imports apply immediately, no "unverified" state (planned in QC dept)
2. **No rollback/undo** — a bad import is permanent (no undo of last import)
3. **No structured preview diff** — review is inside dialog but no "what will CHANGE" diff view
4. **No batch import** — one file at a time only
5. **No template download** — can't generate a blank Excel to fill by hand
6. **No validation rules pre-check** — data quality issues found mid-parse, not pre-flight
7. **No import scheduling** — can't queue imports for later
8. **No cross-importer linking** — spec/premix/cheese don't inform each other during import
9. **No import → inventory tie-in** — imports define recipes but don't connect to inventory consumption
10. **No data versioning** — re-importing a changed sheet overwrites; no "what changed since last import" view

---

## Proposed System

### 1. QC Approval Gate (from QC department plan)
**Status**: Already planned in `docs/qc-department-plan.md` → "Shared Importers"

**Flow**:
1. Anyone with import capability uploads
2. Parsed data applies BUT flagged `qc_review_status = "pending"`
3. QC sees pending imports in their Import Review queue (diff preview)
4. Approve → fully verified (badge clears) | Reject → rollback offered

**Impact**: Importers remain shared; QC is the quality gate.

### 2. Rollback / Undo (new)
**What**: Undo the last applied import (or any import with a snapshot).

**How**:
- Every import commit already writes a bounded change manifest (`ImportHistorySummary.changes`)
- Before applying, capture an **undo snapshot** of everything the import will touch (profiles, recipes, mixes, packaging settings)
- "Undo last import" → restore from snapshot, log a ledger entry "import rolled back"
- Available from Import History panel: "Rollback" button per import item
- Guard: rollback of an import whose data was later modified by ANOTHER import → show conflict, require manual review (don't blindly overwrite newer edits)

### 3. Structured Preview Diff (new)
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
**What**: Upload multiple files (same type or mixed) in one session.

**Flow**:
- Multi-file picker → each file goes through its own parse → review queue
- User reviews each file's matches/preview in sequence
- "Apply all" or per-file apply
- Each file gets its own import-history record (audit per file)

**Note**: Schedule planner already handles multi-sheet day blocks; extend the pattern to all importers.

### 5. Template Download (new)
**What**: Download a blank, correctly-formatted Excel template for each importer.

**How**:
- Each importer defines its expected columns/sheets (from the shared lib parse shapes)
- A template generator writes headers + one example row
- Templates live server-side (`GET /api/import/templates/{type}`) so they never drift from the parser

### 6. Validation Rules Pre-Check (new)
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
**What**: Queue a file to import at a later time.

**Use cases**: Nightly spec-sheet sync, scheduled customer file drops.
**Status**: Lower priority — requires auth/session handling for async apply. Keep as a "later" idea unless the facility has a recurring file source.

### 8. Cross-Importer Linking (new)
**What**: One import informs another.

**Examples**:
- Spec import defines a product → premix import for the same brand/flavor auto-links
- Cheese import updates a recipe → spec import for a product using that cheese suggests the link
- Reconcile panel already cross-references premix vs spec (MixReconcilePanel) — extend to cheese/shipping

**How**: Reuse the saved-sheet store + reconcilers (`@workspace/spec-reconcile`, `@workspace/mix-reconcile`) into a single "cross-import health" view: which products have spec+premix+cheese+shipping all landed, which are missing pieces.

### 9. Import → Inventory Tie-in (new)
**What**: Recipes set up by imports drive inventory consumption lines automatically.

**Why**: When a spec import defines dough/sauce/cheese/app recipes, `computeRunConsumptionLines` already turns them into inventory keys. The gap: no visibility that "this import means we'll need X lbs of ingredient Y on runs of this product."

**Add**: In the import review step, show a "projected inventory impact" section per product — which inventory items will be consumed, at what rate. Links the import system to the inventory system cleanly.

### 10. Data Versioning / Change Detection (new)
**What**: When a known sheet is re-imported, show what changed vs. the last time.

**How**: Compare new parse vs. the previous snapshot for the same sourceKey:
- New products added
- Products removed/merged
- Recipe weights changed
- Packaging settings changed

**Benefit**: "Re-importing this sheet will change 3 recipes and add 1 new flavor" — no silent overwrites.

---

## Recommended Build Order

### Phase 1: Foundation (highest value)
1. **QC approval gate** (pending → verified, unverified badge, QC review queue)
2. **Rollback / undo** (snapshot + restore + conflict guard)
3. **Structured preview diff** (change-by-change view before apply)

### Phase 2: Usability
4. **Template download** (server-side, per importer)
5. **Validation rules pre-check** (fail fast on file shape)
6. **Cross-importer linking** (unified "import health" view)

### Phase 3: Advanced
7. **Batch import** (multi-file queue)
8. **Data versioning** (re-import diff vs. last time)
9. **Import → inventory impact** (projected consumption on review)

### Phase 4: Deferred
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
- `imports` table: add `qc_review_status` (`pending|verified|rejected`), `qc_reviewed_by`, `qc_reviewed_at`, `qc_review_notes`
- `import_undo_snapshots` table: snapshot_id, entity kind, before-state JSON, imported_by, created_at
- (QC review queue reuses the QC dept tables/API)

## API Routes to Add
- `GET /api/qc/import-reviews` — QC pending queue
- `POST /api/qc/import-reviews/:id/approve` — verify
- `POST /api/qc/import-reviews/:id/reject` — reject + rollback offer
- `POST /api/imports/:id/rollback` — undo an import
- `GET /api/imports/:id/diff` — structured preview diff
- `GET /api/import/templates/{type}` — download blank template
- `POST /api/import/validate` — pre-flight validation
